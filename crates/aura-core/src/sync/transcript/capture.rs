use super::*;
use crate::chatstore::files::Attachments;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(tag = "stage", rename_all = "snake_case", deny_unknown_fields)]
enum Cursor {
    #[default]
    Metadata,
    Events {
        after: i64,
    },
    Steering {
        after: i64,
    },
    Files,
    Fragment,
    Done,
}

pub(crate) fn install(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TEMP TRIGGER IF NOT EXISTS aura_sync_turn AFTER UPDATE OF compacted_at ON main.turns WHEN NEW.compacted_at IS NOT NULL AND NEW.status<>'running' BEGIN INSERT OR IGNORE INTO sync_turns(turn_id,chat_id,state,cursor_json) VALUES(NEW.id,NEW.chat_id,'capture','{\"stage\":\"metadata\"}'); END;")?;
    Ok(())
}

/// At most one piece is built per request. The cursor, ciphertext and links commit together; a
/// cancelled network cycle never leaves a published turn pointing to uncommitted data.
pub(crate) fn capture_one(
    conn: &Connection,
    context: &SyncContext,
    attachments: &Attachments,
) -> Result<bool> {
    conn.execute("INSERT OR IGNORE INTO sync_turns(turn_id,chat_id,state,cursor_json) SELECT id,chat_id,'capture','{\"stage\":\"metadata\"}' FROM turns t WHERE status<>'running' AND compacted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sync_turns s WHERE s.turn_id=t.id) ORDER BY chat_id,seq LIMIT 32", [])?;
    let job: Option<(String,String,Option<String>,u32)> = conn.query_row("SELECT turn_id,cursor_json,tail_blob,part_count FROM sync_turns s WHERE state='capture' AND NOT EXISTS(SELECT 1 FROM steering_inputs i WHERE i.turn_id=s.turn_id AND i.state='pending') ORDER BY attempt,turn_id LIMIT 1", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let Some((turn_id, json, previous, index)) = job else {
        return Ok(false);
    };
    if index >= MAX_PARTS {
        return Err(SyncError::Invalid);
    }
    let mut cursor: Cursor = serde_json::from_str(&json).map_err(|_| SyncError::Invalid)?;
    let mut entries = Vec::new();
    let mut bytes = 1024;
    while entries.len() < 128 {
        let next = cursor.clone();
        let Some((entry, advance)) = next_entry(conn, attachments, &turn_id, next)? else {
            cursor = Cursor::Done;
            break;
        };
        validate_entry(&entry, &turn_id)?;
        let encoded = Zeroizing::new(serde_json::to_vec(&entry).map_err(|_| SyncError::Invalid)?);
        if encoded.len() > MAX_ENTRY_BYTES {
            return Err(SyncError::Invalid);
        }
        if encoded.len() + 1024 > PIECE_BYTES {
            if !entries.is_empty() {
                break;
            }
            references(conn, attachments, &turn_id, &entry)?;
            conn.execute(
                "INSERT INTO sync_turn_fragments(turn_id,bytes,next_cursor) VALUES(?1,?2,?3)",
                params![
                    turn_id,
                    encoded.as_slice(),
                    serde_json::to_string(&advance).map_err(|_| SyncError::Invalid)?
                ],
            )?;
            cursor = Cursor::Fragment;
            continue;
        }
        if bytes + encoded.len() > PIECE_BYTES {
            break;
        }
        bytes += encoded.len();
        references(conn, attachments, &turn_id, &entry)?;
        match &entry {
            Entry::File(file) => {
                let next = file.offset + crypto::decode(&file.bytes, 192 * 1024)?.len() as u64;
                conn.execute("UPDATE sync_turn_files SET captured=?3,complete=?4 WHERE turn_id=?1 AND hash=?2",params![turn_id,file.hash,next as i64,next==file.total])?;
            }
            Entry::MissingFile { hash } => {
                conn.execute(
                    "UPDATE sync_turn_files SET complete=1 WHERE turn_id=?1 AND hash=?2",
                    params![turn_id, hash],
                )?;
            }
            Entry::Fragment {
                offset,
                total,
                bytes,
            } => {
                let next = *offset + crypto::decode(bytes, 192 * 1024)?.len() as u32;
                if next == *total {
                    conn.execute(
                        "DELETE FROM sync_turn_fragments WHERE turn_id=?1",
                        [&turn_id],
                    )?;
                } else {
                    conn.execute(
                        "UPDATE sync_turn_fragments SET captured=?2 WHERE turn_id=?1",
                        params![turn_id, next],
                    )?;
                }
            }
            _ => {}
        }
        cursor = advance;
        entries.push(entry);
    }
    let tail = if entries.is_empty() {
        previous
    } else {
        let piece = Piece {
            schema_version: 1,
            turn_id: turn_id.clone(),
            index,
            previous,
            entries,
        };
        let plain = Zeroizing::new(serde_json::to_vec(&piece).map_err(|_| SyncError::Invalid)?);
        if plain.len() > PIECE_BYTES {
            return Err(SyncError::Invalid);
        }
        let id = crate::ids::new_id();
        let sealed = crypto::seal_blob(
            &context.key,
            &context.identity.account,
            &id,
            context.identity.key_version,
            &plain,
        )?;
        conn.execute("INSERT INTO sync_blobs(id,key_version,nonce,ciphertext,uploaded) VALUES(?1,?2,?3,?4,0)",params![id,context.identity.key_version,sealed.nonce,sealed.ciphertext])?;
        conn.execute(
            "INSERT INTO sync_turn_parts(turn_id,part_index,blob_id) VALUES(?1,?2,?3)",
            params![turn_id, index, id],
        )?;
        Some(id)
    };
    let parts: u32 = conn.query_row(
        "SELECT count(*) FROM sync_turn_parts WHERE turn_id=?1",
        [&turn_id],
        |r| r.get(0),
    )?;
    conn.execute("UPDATE sync_turns SET cursor_json=?2,tail_blob=?3,part_count=?4,attempt=attempt+1 WHERE turn_id=?1",params![turn_id,serde_json::to_string(&cursor).map_err(|_|SyncError::Invalid)?,tail,parts])?;
    if matches!(cursor, Cursor::Done) {
        finish(
            conn,
            context,
            &turn_id,
            tail.ok_or(SyncError::Invalid)?,
            parts,
        )?;
    }
    Ok(true)
}

fn references(
    conn: &Connection,
    attachments: &Attachments,
    turn_id: &str,
    entry: &Entry,
) -> Result<()> {
    let mut hashes = referenced(entry);
    let mut images = inline_images(entry);
    if let Entry::File(file) = entry
        && image_reference_text(&file.mime)
        && file.offset + crypto::decode(&file.bytes, 192 * 1024)?.len() as u64 == file.total
    {
        // Discover nested refs only when their containing file is complete. The receiver must
        // receive and verify that blob before it can authorize any following image file.
        let scanned: i64 = conn.query_row(
            "SELECT COALESCE(SUM(a.size),0) FROM sync_turn_files f JOIN attachments a ON a.sha256=f.hash WHERE f.turn_id=?1 AND f.complete=1 AND (a.mime LIKE 'text/%' OR a.mime='application/json')",
            [turn_id], |row| row.get(0),
        )?;
        let limit = (IMAGE_SCAN_BYTES as u64)
            .saturating_sub(scanned.max(0) as u64)
            .min(file.total);
        let mut bytes = Zeroizing::new(Vec::new());
        while (bytes.len() as u64) < limit {
            let (total, page) = attachments
                .sync_range(&file.hash, bytes.len() as u64)
                .map_err(|_| SyncError::Database)?;
            if total != file.total || page.is_empty() {
                return Err(SyncError::Invalid);
            }
            let take = page.len().min(limit as usize - bytes.len());
            bytes.extend_from_slice(&page[..take]);
        }
        images.extend(images_in_bytes(&bytes, file.total));
    }
    for hash in images {
        let owned: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM composer_attachments WHERE chat_id=(SELECT chat_id FROM turns WHERE id=?1) AND sha256=?2 AND mime LIKE 'image/%')",
            params![turn_id, hash], |row| row.get(0),
        )?;
        if owned {
            hashes.push(hash);
        }
    }
    for hash in hashes {
        if !crate::chatstore::blobs::is_sha256(&hash) {
            return Err(SyncError::Invalid);
        }
        conn.execute(
            "INSERT OR IGNORE INTO sync_turn_files(turn_id,hash) VALUES(?1,?2)",
            params![turn_id, hash],
        )?;
    }
    Ok(())
}

fn next_entry(
    conn: &Connection,
    attachments: &Attachments,
    id: &str,
    mut cursor: Cursor,
) -> Result<Option<(Entry, Cursor)>> {
    loop {
        match cursor {
            Cursor::Metadata => {
                let turn=conn.query_row("SELECT t.chat_id,t.parent_turn_id,COALESCE(t.source_agent,s.agent_id,c.active_agent,''),t.status,t.stop_reason,t.started_at,t.ended_at,t.prompt_id,t.prompt_parts_json,t.continuation_prefix FROM turns t JOIN chats c ON c.id=t.chat_id LEFT JOIN agent_sessions s ON s.id=t.agent_session_id WHERE t.id=?1 AND t.compacted_at IS NOT NULL AND t.status<>'running'",[id],|r| {
                    let parts:String=r.get(8)?;
                    Ok(Turn{chat_id:r.get(0)?,turn_id:id.into(),parent_turn_id:r.get(1)?,agent:r.get(2)?,status:r.get(3)?,stop_reason:r.get(4)?,started_at:r.get(5)?,ended_at:r.get(6)?,prompt_id:r.get(7)?,parts:serde_json::from_str(&parts).map_err(|e|rusqlite::Error::FromSqlConversionFailure(8,rusqlite::types::Type::Text,Box::new(e)))?,continuation_prefix:r.get(9)?})
                })?;
                return Ok(Some((Entry::Turn(turn), Cursor::Events { after: -1 })));
            }
            Cursor::Events { after } => {
                let row=conn.query_row("SELECT seq,kind,CASE WHEN octet_length(payload)<=16777216 THEN payload ELSE NULL END,created_at FROM events WHERE turn_id=?1 AND seq>?2 ORDER BY seq LIMIT 1",params![id,after],|r|Ok(Event{seq:r.get(0)?,kind:r.get(1)?,payload:r.get(2)?,created_at:r.get(3)?})).optional()?;
                if let Some(event) = row {
                    let seq = event.seq;
                    return Ok(Some((
                        Entry::Event(event),
                        Cursor::Events {
                            after: i64::from(seq),
                        },
                    )));
                }
                cursor = Cursor::Steering { after: -1 };
            }
            Cursor::Steering { after } => {
                let row=conn.query_row("SELECT message_id,seq,parts_json,CASE state WHEN 'pending' THEN 'unconfirmed' ELSE state END,detail,created_at,updated_at FROM steering_inputs WHERE turn_id=?1 AND seq>?2 ORDER BY seq LIMIT 1",params![id,after],|r| {
                    let parts:String=r.get(2)?;
                    Ok(Steering{message_id:r.get(0)?,seq:r.get(1)?,parts:serde_json::from_str(&parts).map_err(|e|rusqlite::Error::FromSqlConversionFailure(2,rusqlite::types::Type::Text,Box::new(e)))?,state:r.get(3)?,detail:r.get(4)?,created_at:r.get(5)?,updated_at:r.get(6)?})
                }).optional()?;
                if let Some(steer) = row {
                    let seq = steer.seq;
                    return Ok(Some((
                        Entry::Steering(steer),
                        Cursor::Steering {
                            after: i64::from(seq),
                        },
                    )));
                }
                cursor = Cursor::Files;
            }
            Cursor::Files => {
                let file:Option<(String,u32)>=conn.query_row("SELECT hash,captured FROM sync_turn_files WHERE turn_id=?1 AND complete=0 ORDER BY hash LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
                let Some((hash, offset)) = file else {
                    return Ok(None);
                };
                let offset = u64::from(offset);
                let (total, bytes) = match attachments.sync_range(&hash, offset) {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound && offset == 0 => {
                        return Ok(Some((Entry::MissingFile { hash }, Cursor::Files)));
                    }
                    Err(_) => return Err(SyncError::Database),
                };
                let mime: Option<String> = conn
                    .query_row(
                        "SELECT mime FROM attachments WHERE sha256=?1",
                        [&hash],
                        |r| r.get(0),
                    )
                    .optional()?;
                let name:Option<String>=conn.query_row("SELECT display_name FROM composer_attachments WHERE chat_id=(SELECT chat_id FROM sync_turns WHERE turn_id=?1) AND sha256=?2 ORDER BY id LIMIT 1",params![id,hash],|r|r.get(0)).optional()?;
                return Ok(Some((
                    Entry::File(File {
                        hash,
                        mime: mime.unwrap_or_else(|| "application/octet-stream".into()),
                        total,
                        offset,
                        bytes: URL_SAFE_NO_PAD.encode(bytes.as_slice()),
                        display_name: name,
                    }),
                    Cursor::Files,
                )));
            }
            Cursor::Fragment => {
                let (offset,total,bytes,next):(u32,u32,Vec<u8>,String)=conn.query_row("SELECT captured,length(bytes),substr(bytes,captured+1,196608),next_cursor FROM sync_turn_fragments WHERE turn_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
                let bytes = Zeroizing::new(bytes);
                let last = u64::from(offset) + bytes.len() as u64 == u64::from(total);
                let next = if last {
                    serde_json::from_str(&next).map_err(|_| SyncError::Invalid)?
                } else {
                    Cursor::Fragment
                };
                return Ok(Some((
                    Entry::Fragment {
                        offset,
                        total,
                        bytes: URL_SAFE_NO_PAD.encode(bytes.as_slice()),
                    },
                    next,
                )));
            }
            Cursor::Done => return Ok(None),
        }
    }
}
fn finish(
    conn: &Connection,
    context: &SyncContext,
    id: &str,
    tail: String,
    parts: u32,
) -> Result<()> {
    let (chat_id, parent_turn_id): (String, Option<String>) = conn.query_row(
        "SELECT chat_id,parent_turn_id FROM turns WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let head = Head {
        schema_version: 1,
        chat_id,
        turn_id: id.into(),
        parent_turn_id,
        tail,
        parts,
    };
    let mut clock = load_clock(conn, &context.identity)?;
    let now = (crate::time::now_millis().max(0) as u64).max(clock.last().physical_ms());
    let next = clock.tick(now)?;
    let mut record = EncryptedRecord {
        collection: "chat_chunks".into(),
        id: id.into(),
        hlc: next.to_string(),
        deleted: false,
        nonce: String::new(),
        ciphertext: String::new(),
        key_version: context.identity.key_version,
    };
    let plain = Zeroizing::new(serde_json::to_vec(&head).map_err(|_| SyncError::Invalid)?);
    let sealed = crypto::seal_record(
        &context.key,
        &super::super::context(&context.identity, &record),
        &plain,
    )?;
    record.nonce = sealed.nonce;
    record.ciphertext = sealed.ciphertext;
    decode(context, &record)?;
    save_head(conn, &record)?;
    enqueue(conn, &record)?;
    save_clock(conn, &clock)?;
    conn.execute(
        "UPDATE sync_turns SET state='ready',cursor_json=NULL WHERE turn_id=?1",
        [id],
    )?;
    Ok(())
}
