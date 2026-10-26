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
        let record: EncryptedRecord =
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
        let next = clock.observe(&prior, now)?;
        if collection == "config" {
            config::decode(
                &SyncContext {
                    identity: identity.clone(),
                    key: key.clone(),
                },
                &record,
            )
            .map_err(|_| SyncError::Deferred)?;
        }
        let record = reseal(identity, key, &record, &next)?;
        save_head(conn, &record)?;
        enqueue(conn, &record)?;
    }
    Ok(())
}
/// Sender recovery and authoritative-head convergence do not create a new content edit. Preserve
/// the authenticated inner payload, including config revision and immutable blob identity.
pub(super) fn reseal(
    identity: &SyncIdentity,
    key: &AccountKey,
    record: &EncryptedRecord,
    next: &Hlc,
) -> Result<EncryptedRecord> {
    if record.key_version != identity.key_version || next.device() != identity.device {
        return Err(SyncError::Identity);
    }
    let plain = crypto::open_record(
        key,
        &context(identity, record),
        &SealedPayload {
            nonce: record.nonce.clone(),
            ciphertext: record.ciphertext.clone(),
        },
    )?;
    let mut record = record.clone();
    record.hlc = next.to_string();
    let sealed = crypto::seal_record(key, &context(identity, &record), &plain)?;
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    Ok(record)
}
