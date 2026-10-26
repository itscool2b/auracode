//! Reissue unsent envelopes after explicit local device recovery. Field clocks and transcript
//! contents retain their source identity; the authenticated outer HLC names the current sender.
use super::*;

pub(crate) fn outgoing_for_device(
    conn: &Connection,
    identity: &SyncIdentity,
    key: &std::sync::Arc<AccountKey>,
    clock: &mut Clock,
    now: u64,
) -> Result<()> {
    let keys = conn
        .prepare("SELECT collection,id FROM sync_outbox ORDER BY hlc,collection,id LIMIT 8193")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if keys.len() > 8192 {
        return Err(SyncError::Deferred);
    }
    for (collection, id) in keys {
        let json: String = conn.query_row(
            "SELECT record_json FROM sync_outbox WHERE collection=?1 AND id=?2",
            params![collection, id],
            |row| row.get(0),
        )?;
        if json.len() > 400_000 {
            return Err(SyncError::Invalid);
        }
        let mut record: EncryptedRecord =
            serde_json::from_str(&json).map_err(|_| SyncError::Invalid)?;
        if record.collection != collection
            || record.id != id
            || record.key_version != identity.key_version
        {
            return Err(SyncError::Identity);
        }
        if head(conn, &collection, &id)?.as_ref() != Some(&record) {
            return Err(SyncError::Identity);
        }
        let prior: Hlc = record.hlc.parse()?;
        let next = clock.observe(&prior, now)?.to_string();
        let plain = if collection == "config" {
            config_payload(conn, identity, key, &record, &next)?
        } else {
            crypto::open_record(
                key,
                &context(identity, &record),
                &SealedPayload {
                    nonce: record.nonce.clone(),
                    ciphertext: record.ciphertext.clone(),
                },
            )?
        };
        record.hlc = next;
        let sealed = crypto::seal_record(key, &context(identity, &record), &plain)?;
        record.nonce = sealed.nonce;
        record.ciphertext = sealed.ciphertext;
        save_head(conn, &record)?;
        enqueue(conn, &record)?;
    }
    Ok(())
}
fn config_payload(
    conn: &Connection,
    identity: &SyncIdentity,
    key: &std::sync::Arc<AccountKey>,
    record: &EncryptedRecord,
    revision: &str,
) -> Result<zeroize::Zeroizing<Vec<u8>>> {
    let config_context = SyncContext {
        identity: identity.clone(),
        key: key.clone(),
    };
    let mut payload = config::decode(&config_context, record).map_err(|_| SyncError::Deferred)?;
    let (version, nonce, ciphertext): (u32, String, String) = conn.query_row(
        "SELECT key_version,nonce,ciphertext FROM sync_blobs WHERE id=?1",
        [&payload.head.blob_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if version != identity.key_version {
        return Err(SyncError::Identity);
    }
    let original = crypto::open_blob(
        key,
        &identity.account,
        &payload.head.blob_id,
        version,
        &SealedPayload { nonce, ciphertext },
    )?;
    let snapshot = config::validate_blob(&payload.id, &payload.head, &original)
        .map_err(|_| SyncError::Invalid)?;
    payload.head.revision = revision.into();
    payload.head.blob_id = crate::ids::new_id();
    let header =
        zeroize::Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| SyncError::Invalid)?);
    let mut bytes = zeroize::Zeroizing::new(Vec::with_capacity(4 + header.len() + snapshot.len()));
    bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(&snapshot);
    let sealed = crypto::seal_blob(
        key,
        &identity.account,
        &payload.head.blob_id,
        version,
        &bytes,
    )?;
    conn.execute(
        "INSERT INTO sync_blobs(id,key_version,nonce,ciphertext) VALUES(?1,?2,?3,?4)",
        params![
            payload.head.blob_id,
            version,
            sealed.nonce,
            sealed.ciphertext
        ],
    )?;
    conn.execute(
        "UPDATE sync_blob_refs SET blob_id=?3 WHERE collection=?1 AND id=?2",
        params![record.collection, record.id, payload.head.blob_id],
    )?;
    // Preserve the old blob for outstanding encrypted reviews and device merge bases. It has its
    // own immutable identity and is never overwritten with the new header.
    Ok(header)
}
