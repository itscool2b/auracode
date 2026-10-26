//! Bounded encrypted transfer work. Calls run through the one profile writer; HTTP never holds a
//! database transaction. Acknowledgements bind the exact bytes sent before releasing a head.
use super::*;
use aura_sync::wire::Blob;

#[derive(Clone)]
pub struct Upload {
    pub id: String,
    pub key_version: u32,
    pub sealed: SealedPayload,
}
#[derive(Clone)]
pub struct Download {
    pub id: String,
    record: EncryptedRecord,
}
pub struct Pending {
    pub cursor: u64,
    pub records: Vec<EncryptedRecord>,
    pub upload: Option<Upload>,
    pub downloads: Vec<Download>,
    pub changes: u32,
}
pub enum Command {
    Pending,
    Pull(Pull),
    Heads {
        sent: Vec<EncryptedRecord>,
        heads: Vec<Change>,
    },
    Uploaded {
        sent: Upload,
        etag: String,
    },
    Downloaded {
        request: Download,
        blob: Blob,
    },
}
pub enum Reply {
    Pending(Pending),
    Saved,
}
impl Command {
    pub(crate) fn bytes(&self) -> usize {
        fn size(record: &EncryptedRecord) -> usize {
            1024 + record.ciphertext.len() + record.nonce.len()
        }
        1024 + match self {
            Self::Pending => 0,
            Self::Pull(page) => page.records.iter().map(|record| size(&record.record)).sum(),
            Self::Heads { sent, heads } => {
                sent.iter().map(size).sum::<usize>()
                    + heads
                        .iter()
                        .map(|record| size(&record.record))
                        .sum::<usize>()
            }
            Self::Uploaded { sent, etag } => sent.sealed.ciphertext.len() + etag.len(),
            Self::Downloaded { request, blob } => {
                size(&request.record) + blob.ciphertext.len() + blob.etag.len()
            }
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.bytes() > 16 * 1024 * 1024 {
            return Err(SyncError::Invalid);
        }
        if matches!(self, Self::Pull(page) if page.records.len() > 32)
            || matches!(self, Self::Heads { sent, heads } if sent.len() > 32 || heads.len() > 32)
        {
            return Err(SyncError::Invalid);
        }
        Ok(())
    }
}

pub(crate) fn execute(store: &mut Store, context: &SyncContext, command: Command) -> Result<Reply> {
    command.validate()?;
    let now = crate::time::now_millis().max(0) as u64;
    match command {
        Command::Pull(page) => SyncLedger::new(store, context.identity.clone(), &context.key)?
            .accept_workspace_pull(&page, now)?,
        Command::Heads { sent, heads } => {
            SyncLedger::new(store, context.identity.clone(), &context.key)?
                .accept_workspace_heads(&sent, &heads, now)?
        }
        command => {
            if !store.is_encrypted() {
                return Err(SyncError::Identity);
            }
            let tx = store
                .conn_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let result = match command {
                Command::Pending => Reply::Pending(pending(&tx, context)?),
                Command::Uploaded { sent, etag } => {
                    uploaded(&tx, context, &sent, &etag)?;
                    Reply::Saved
                }
                Command::Downloaded { request, blob } => {
                    downloaded(&tx, context, &request, &blob)?;
                    Reply::Saved
                }
                _ => unreachable!(),
            };
            tx.commit()?;
            return Ok(result);
        }
    }
    Ok(Reply::Saved)
}

fn pending(conn: &Connection, context: &SyncContext) -> Result<Pending> {
    let upload = conn.query_row("SELECT b.id,b.key_version,b.nonce,b.ciphertext FROM sync_blobs b WHERE b.uploaded=0 AND EXISTS(SELECT 1 FROM sync_blob_refs r WHERE r.blob_id=b.id) ORDER BY b.id LIMIT 1", [], |r| Ok(Upload { id: r.get(0)?, key_version: r.get(1)?, sealed: SealedPayload { nonce: r.get(2)?, ciphertext: r.get(3)? } })).optional()?;
    if let Some(upload) = &upload {
        if upload.key_version != context.identity.key_version {
            return Err(SyncError::Identity);
        }
        crypto::open_blob(
            &context.key,
            &context.identity.account,
            &upload.id,
            upload.key_version,
            &upload.sealed,
        )?;
    }
    let mut downloads = Vec::new();
    let records = conn.prepare("SELECT h.record_json FROM sync_blob_refs r JOIN sync_heads h ON h.collection=r.collection AND h.id=r.id WHERE r.collection='config' AND NOT EXISTS(SELECT 1 FROM sync_blobs b WHERE b.id=r.blob_id) ORDER BY r.id LIMIT 4")?
        .query_map([], |r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for json in records {
        let record = decode_record(&json)?;
        let payload = config::decode(context, &record).map_err(|_| SyncError::Invalid)?;
        downloads.push(Download {
            id: payload.head.blob_id,
            record,
        });
    }
    let records = outgoing(conn)?;
    let changes: u32 = conn.query_row("SELECT (SELECT count(*) FROM sync_outbox)+(SELECT count(*) FROM sync_projection)+(SELECT count(*) FROM sync_blob_refs r WHERE NOT EXISTS(SELECT 1 FROM sync_blobs b WHERE b.id=r.blob_id))", [], |r|r.get(0))?;
    Ok(Pending {
        cursor: cursor(conn)?,
        records,
        upload,
        downloads,
        changes,
    })
}
fn etag(value: &str) -> Result<()> {
    if crypto::decode(value, 32)?.len() != 32 {
        return Err(SyncError::Invalid);
    }
    Ok(())
}
fn uploaded(conn: &Connection, context: &SyncContext, sent: &Upload, value: &str) -> Result<()> {
    etag(value)?;
    if sent.key_version != context.identity.key_version {
        return Err(SyncError::Identity);
    }
    let changed = conn.execute("UPDATE sync_blobs SET uploaded=1,etag=?5 WHERE id=?1 AND key_version=?2 AND nonce=?3 AND ciphertext=?4",params![sent.id,sent.key_version,sent.sealed.nonce,sent.sealed.ciphertext,value])?;
    if changed != 1 {
        return Err(SyncError::Invalid);
    }
    Ok(())
}
fn downloaded(
    conn: &Connection,
    context: &SyncContext,
    request: &Download,
    blob: &Blob,
) -> Result<()> {
    etag(&blob.etag)?;
    let payload = config::decode(context, &request.record).map_err(|_| SyncError::Invalid)?;
    if payload.head.blob_id != request.id
        || blob.key_version != context.identity.key_version
        || crypto::decode(&blob.ciphertext, 4 * 1024 * 1024)?.len() as u64 != blob.size_bytes
    {
        return Err(SyncError::Invalid);
    }
    let sealed = SealedPayload {
        nonce: blob.nonce.clone(),
        ciphertext: blob.ciphertext.clone(),
    };
    let bytes = crypto::open_blob(
        &context.key,
        &context.identity.account,
        &request.id,
        blob.key_version,
        &sealed,
    )?;
    config::validate_blob(&payload.id, &payload.head, &bytes).map_err(|_| SyncError::Invalid)?;
    let previous: Option<(u32, String, String)> = conn
        .query_row(
            "SELECT key_version,nonce,ciphertext FROM sync_blobs WHERE id=?1",
            [&request.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if let Some((version, nonce, ciphertext)) = previous {
        if version != blob.key_version || nonce != blob.nonce || ciphertext != blob.ciphertext {
            return Err(SyncError::Invalid);
        }
        return Ok(());
    }
    conn.execute("INSERT INTO sync_blobs(id,key_version,nonce,ciphertext,etag,uploaded) VALUES(?1,?2,?3,?4,?5,1)",params![request.id,blob.key_version,blob.nonce,blob.ciphertext,blob.etag])?;
    Ok(())
}

#[cfg(test)]
mod tests;
