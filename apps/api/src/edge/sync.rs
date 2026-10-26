use super::{Api, Identity, body, json_response, unavailable};
use crate::{
    crypto,
    policy::{self, ApiError, Result},
    sql,
    types::{Push, PutBlob},
};
use serde_json::{Value, json};
use worker::{Request, Response};

impl Api {
    pub(super) async fn push(
        &self,
        request: &mut Request,
        identity: &Identity,
    ) -> Result<Response> {
        let device = self.approved(identity).await?;
        self.rate("sync-push", &identity.session.user_id, 60, 60)
            .await?;
        let input: Push = body(request).await?;
        if input.records.is_empty() || input.records.len() > policy::MAX_BATCH {
            return Err(ApiError::InvalidRequest);
        }
        let mut seen = std::collections::HashSet::new();
        let mut batch = Vec::new();
        for record in &input.records {
            if !seen.insert((&record.collection, &record.id)) {
                return Err(ApiError::InvalidRequest);
            }
            let size = record.validate(&device, self.now * 1000)?
                + record.id.len()
                + record.hlc.len()
                + 256;
            batch.push((
                sql::PUSH_RECORD,
                vec![
                    json!(identity.hash),
                    json!(self.now),
                    json!(record.collection),
                    json!(record.id),
                    json!(record.hlc),
                    json!(record.deleted),
                    json!(record.nonce),
                    json!(record.ciphertext),
                    json!(record.key_version),
                    json!(size),
                ],
            ));
        }
        self.db.batch(batch).await?;
        self.approved(identity).await?;
        // Return each authoritative head. Older clocks and immutable chunk conflicts are visible,
        // never represented as successful overwrites or silently merged by the server.
        let mut heads = Vec::<Value>::new();
        for record in input.records {
            let head:Option<Value>=self.db.first("SELECT c.server_seq,c.collection,c.id,c.hlc,c.deleted,c.nonce,c.ciphertext,c.key_version,c.device_id FROM sync_heads h JOIN sync_changes c ON c.server_seq=h.server_seq WHERE h.user_id=?1 AND h.collection=?2 AND h.id=?3",vec![json!(identity.session.user_id),json!(record.collection),json!(record.id)]).await?;
            heads.push(crate::types::wire_change(head.ok_or(ApiError::Conflict)?)?);
        }
        json_response(json!({"heads":heads}))
    }
    pub(super) async fn pull(&self, request: &Request, identity: &Identity) -> Result<Response> {
        self.approved(identity).await?;
        self.rate("sync-pull", &identity.session.user_id, 60, 120)
            .await?;
        let url = request.url().map_err(unavailable)?;
        let mut after = 0i64;
        let mut found = false;
        for (name, value) in url.query_pairs() {
            if name != "after" || found {
                return Err(ApiError::InvalidRequest);
            }
            after = value.parse().map_err(|_| ApiError::InvalidRequest)?;
            found = true;
        }
        if !(0..=9_007_199_254_740_991).contains(&after) {
            return Err(ApiError::InvalidRequest);
        }
        let records: Vec<Value> = self
            .db
            .all(
                sql::PULL,
                vec![
                    json!(identity.hash),
                    json!(self.now),
                    json!(after),
                    json!(policy::MAX_BATCH),
                ],
            )
            .await?;
        let records = records
            .into_iter()
            .map(crate::types::wire_change)
            .collect::<Result<Vec<_>>>()?;
        let next = records
            .last()
            .and_then(|row| row["server_seq"].as_i64())
            .unwrap_or(after);
        json_response(
            json!({"records":records,"next_cursor":next,"has_more":records.len()==policy::MAX_BATCH}),
        )
    }
    pub(super) async fn put_blob(
        &self,
        request: &mut Request,
        identity: &Identity,
        id: &str,
    ) -> Result<Response> {
        policy::identifier(id)?;
        self.approved(identity).await?;
        self.rate("blob-put", &identity.session.user_id, 3600, 60)
            .await?;
        let input: PutBlob = body(request).await?;
        let bytes = crypto::decode(&input.ciphertext, 16, policy::MAX_BLOB)?;
        crypto::decode(&input.nonce, 24, 24)?;
        if input.key_version < 1 {
            return Err(ApiError::InvalidRequest);
        }
        if let Some(expected) = &input.expected_etag {
            crypto::decode(expected, 32, 32)?;
        }
        let object_key = format!("{}/{}", identity.session.user_id, crypto::random_token()?);
        let reserved: Option<Value> = self
            .db
            .first(
                sql::RESERVE_BLOB,
                vec![
                    json!(identity.hash),
                    json!(self.now),
                    json!(object_key),
                    json!(bytes.len() + 256),
                    json!(input.key_version),
                ],
            )
            .await?;
        if reserved.is_none() {
            return Err(ApiError::Quota);
        }
        let bucket = self.env.bucket("BLOBS").map_err(unavailable)?;
        bucket
            .put(&object_key, bytes.clone())
            .execute()
            .await
            .map_err(unavailable)?
            .ok_or(ApiError::Unavailable)?;
        let etag = crypto::hash(&format!(
            "{}:{}:{}",
            input.key_version, input.nonce, input.ciphertext
        ));
        let changed = self
            .db
            .first::<Value>(
                sql::COMMIT_BLOB,
                vec![
                    json!(identity.hash),
                    json!(self.now),
                    json!(id),
                    json!(object_key),
                    json!(etag),
                    json!(input.nonce),
                    json!(input.key_version),
                    json!(bytes.len()),
                    json!(input.expected_etag),
                ],
            )
            .await;
        match changed {
            Ok(Some(_)) => json_response(json!({"etag":etag})),
            other => {
                // The object lease remains until deletion succeeds, so a failed R2 delete is retried.
                if bucket.delete(&object_key).await.is_ok() {
                    let _ = self
                        .db
                        .run(
                            "DELETE FROM blob_objects WHERE object_key=?1",
                            vec![json!(object_key)],
                        )
                        .await;
                }
                match other {
                    Err(error) => Err(error),
                    _ => Err(ApiError::Conflict),
                }
            }
        }
    }
    pub(super) async fn get_blob(&self, identity: &Identity, id: &str) -> Result<Response> {
        policy::identifier(id)?;
        self.approved(identity).await?;
        self.rate("blob-get", &identity.session.user_id, 60, 120)
            .await?;
        let mut row:Value=self.db.first("SELECT object_key,etag,nonce,key_version,size_bytes FROM blobs WHERE user_id=?1 AND id=?2",vec![json!(identity.session.user_id),json!(id)]).await?.ok_or(ApiError::NotFound)?;
        let object_key = row["object_key"].as_str().ok_or(ApiError::Unavailable)?;
        let object = self
            .env
            .bucket("BLOBS")
            .map_err(unavailable)?
            .get(object_key)
            .execute()
            .await
            .map_err(unavailable)?
            .ok_or(ApiError::Unavailable)?;
        if object.size() > policy::MAX_BLOB as u64 {
            return Err(ApiError::Unavailable);
        }
        let bytes = object
            .body()
            .ok_or(ApiError::Unavailable)?
            .bytes()
            .await
            .map_err(unavailable)?;
        self.approved(identity).await?;
        row.as_object_mut()
            .ok_or(ApiError::Unavailable)?
            .remove("object_key");
        row["ciphertext"] = json!(crypto::encode(&bytes));
        json_response(row)
    }
}
