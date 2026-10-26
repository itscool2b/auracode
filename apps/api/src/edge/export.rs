//! Streaming ciphertext archive. At most one record page or one bounded blob is resident.
use super::{Api, Identity, db::Db, unavailable};
use crate::{
    crypto,
    policy::{self, ApiError, Result},
    sql, types,
};
use futures_util::{
    future::{Either, select},
    stream,
};
use serde_json::{Value, json};
use worker::{Delay, Env, Response};

struct Export {
    env: Env,
    db: Db,
    hash: String,
    user: String,
    started: i64,
    sequence: i64,
    ceiling: i64,
    blob: String,
    stage: u8,
}
impl Export {
    async fn next(&mut self) -> Result<Option<Vec<u8>>> {
        let now = (js_sys::Date::now() / 1000.0) as i64;
        if now - self.started > 600 {
            return Err(ApiError::Unavailable);
        }
        let session: Option<Value> = self
            .db
            .first(sql::AUTHENTICATE, vec![json!(self.hash), json!(now)])
            .await?;
        if session.is_none() {
            return Err(ApiError::Unauthorized);
        }
        let mut lines = Vec::new();
        match self.stage {
            0 => {
                let account: Option<Value> = self
                    .db
                    .first(
                        "SELECT id,email,created_at FROM users WHERE id=?1",
                        vec![json!(self.user)],
                    )
                    .await?;
                let devices:Vec<Value>=self.db.all("SELECT id,name,platform,public_key,created_at,last_seen,approved_at,revoked_at,key_version,wrapped_key FROM devices WHERE user_id=?1 ORDER BY id",vec![json!(self.user)]).await?;
                let keys:Option<Value>=self.db.first("SELECT key_version,recovery_envelope,created_at FROM user_keys WHERE user_id=?1",vec![json!(self.user)]).await?;
                lines.push(json!({"type":"account","format":"auracode-encrypted-export-v1","exported_at":self.started,"through_sequence":self.ceiling,"account":account,"devices":devices,"keys":keys}));
                self.stage = 1;
            }
            1 => {
                let rows:Vec<Value>=self.db.all("SELECT server_seq,collection,id,hlc,device_id,deleted,nonce,ciphertext,key_version FROM sync_changes WHERE user_id=?1 AND server_seq>?2 AND server_seq<=?3 ORDER BY server_seq LIMIT 32",vec![json!(self.user),json!(self.sequence),json!(self.ceiling)]).await?;
                if rows.len() < 32 {
                    self.stage = 2;
                }
                for row in rows {
                    self.sequence = row["server_seq"].as_i64().ok_or(ApiError::Unavailable)?;
                    lines.push(json!({"type":"record","record":types::wire_change(row)?}));
                }
            }
            2 => {
                let row:Option<Value>=self.db.first("SELECT id,object_key,etag,nonce,key_version,size_bytes FROM blobs WHERE user_id=?1 AND id>?2 ORDER BY id LIMIT 1",vec![json!(self.user),json!(self.blob)]).await?;
                if let Some(mut row) = row {
                    self.blob = row["id"].as_str().ok_or(ApiError::Unavailable)?.into();
                    let bucket = self.env.bucket("BLOBS").map_err(unavailable)?;
                    let object = bucket
                        .get(row["object_key"].as_str().ok_or(ApiError::Unavailable)?)
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
                    row.as_object_mut()
                        .ok_or(ApiError::Unavailable)?
                        .remove("object_key");
                    row["ciphertext"] = json!(crypto::encode(&bytes));
                    lines.push(json!({"type":"blob","blob":row}));
                } else {
                    self.stage = 3;
                    lines.push(json!({"type":"complete"}));
                }
            }
            _ => return Ok(None),
        }
        let mut bytes = Vec::new();
        for line in lines {
            serde_json::to_writer(&mut bytes, &line).map_err(unavailable)?;
            bytes.push(b'\n');
        }
        Ok(Some(bytes))
    }
}
impl Api {
    pub(super) async fn export(&self, identity: &Identity) -> Result<Response> {
        self.rate("export", &identity.session.user_id, 3600, 5)
            .await?;
        let ceiling: Value = self
            .db
            .first(
                "SELECT COALESCE(MAX(server_seq),0) AS seq FROM sync_changes WHERE user_id=?1",
                vec![json!(identity.session.user_id)],
            )
            .await?
            .ok_or(ApiError::Unavailable)?;
        let state = Export {
            env: self.env.clone(),
            db: Db(self.env.d1("DB").map_err(unavailable)?),
            hash: identity.hash.clone(),
            user: identity.session.user_id.clone(),
            started: self.now,
            sequence: 0,
            ceiling: ceiling["seq"].as_i64().ok_or(ApiError::Unavailable)?,
            blob: String::new(),
            stage: 0,
        };
        let stream = stream::try_unfold(state, |mut state| async move {
            let result = match select(
                Box::pin(state.next()),
                Box::pin(Delay::from(std::time::Duration::from_secs(30))),
            )
            .await
            {
                Either::Left((result, _)) => result,
                Either::Right(_) => Err(ApiError::Unavailable),
            };
            match result {
                Ok(Some(bytes)) => Ok(Some((bytes, state))),
                Ok(None) => Ok(None),
                // No provider details leave the service. A failed stream never has a complete marker.
                Err(_) => Err(worker::Error::RustError(
                    "Encrypted export interrupted; retry after reconnecting".into(),
                )),
            }
        });
        let mut response = Response::from_stream(stream).map_err(unavailable)?;
        response
            .headers_mut()
            .set("Content-Type", "application/x-ndjson")
            .map_err(unavailable)?;
        response
            .headers_mut()
            .set(
                "Content-Disposition",
                "attachment; filename=auracode-encrypted-export.jsonl",
            )
            .map_err(unavailable)?;
        Ok(response)
    }
}
