use super::*;
use crate::chatstore::{compact, files::Attachments};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const SEQ_LIMIT: u32 = u32::MAX - (1 << 24);

/// The caller holds the chat actor's mutation admission until the actual transaction result, not a
/// request timeout. Other devices' paths and native session identifiers never enter this projection.
pub(crate) fn publish(
    conn: &Connection,
    context: &SyncContext,
    files: &Attachments,
    chat: &str,
    floor: u32,
) -> Result<Option<Imported>> {
    if !uuid(chat) || floor > SEQ_LIMIT {
        return Err(SyncError::Invalid);
    }
    let idle:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM chats WHERE id=?1 AND deleted=0) AND NOT EXISTS(SELECT 1 FROM turns WHERE chat_id=?1 AND status='running') AND NOT EXISTS(SELECT 1 FROM queued_prompts WHERE chat_id=?1)",[chat],|r|r.get(0))?;
    if !idle {
        return Ok(None);
    }
    let ids=conn.prepare("SELECT turn_id FROM sync_turns WHERE chat_id=?1 AND state='staged' ORDER BY attempt,turn_id LIMIT 32")?.query_map([chat],|r|r.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        conn.execute(
            "UPDATE sync_turns SET attempt=attempt+1 WHERE turn_id=?1",
            [&id],
        )?;
        let record = head(conn, "chat_chunks", &id)?.ok_or(SyncError::Invalid)?;
        let header = decode(context, &record)?;
        if let Some(parent) = &header.parent_turn_id {
            let present: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND chat_id=?2)",
                params![parent, chat],
                |r| r.get(0),
            )?;
            if !present {
                continue;
            }
        }
        return import_one(conn, context, files, &header, floor).map(Some);
    }
    Ok(None)
}

struct FileAssembly {
    hash: String,
    mime: String,
    name: Option<String>,
    total: u64,
    bytes: Zeroizing<Vec<u8>>,
}
struct Import<'a> {
    conn: &'a Connection,
    files: &'a Attachments,
    header: &'a Head,
    device: &'a str,
    ordinal: u32,
    floor: u32,
    base: u32,
    first_source: Option<u32>,
    last_source: Option<u32>,
    last_seq: Option<u32>,
    phase: u8,
    metadata: bool,
    ended: bool,
    started: bool,
    required: BTreeSet<String>,
    file: Option<FileAssembly>,
    fragment: Zeroizing<Vec<u8>>,
    fragment_total: Option<u32>,
}
fn import_one(
    conn: &Connection,
    context: &SyncContext,
    files: &Attachments,
    head: &Head,
    floor: u32,
) -> Result<Imported> {
    let maximum: u32 = conn.query_row(
        "SELECT COALESCE(MAX(seq)+1,0) FROM events WHERE chat_id=?1",
        [&head.chat_id],
        |r| r.get(0),
    )?;
    let floor = floor.max(maximum);
    let ordinal: u32 = conn.query_row(
        "SELECT COALESCE(MAX(seq)+1,1) FROM turns WHERE chat_id=?1",
        [&head.chat_id],
        |r| r.get(0),
    )?;
    if ordinal >= SEQ_LIMIT || floor >= SEQ_LIMIT {
        return Err(SyncError::Invalid);
    }
    let branched: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE chat_id=?1 AND parent_turn_id IS ?2)",
        params![head.chat_id, head.parent_turn_id],
        |r| r.get(0),
    )?;
    let record =
        super::super::head(conn, "chat_chunks", &head.turn_id)?.ok_or(SyncError::Invalid)?;
    let clock: Hlc = record.hlc.parse()?;
    let mut import = Import {
        conn,
        files,
        header: head,
        device: clock.device(),
        ordinal,
        floor,
        base: floor + u32::from(branched),
        first_source: None,
        last_source: None,
        last_seq: None,
        phase: 0,
        metadata: false,
        ended: false,
        started: false,
        required: BTreeSet::new(),
        file: None,
        fragment: Zeroizing::new(Vec::new()),
        fragment_total: None,
    };
    let mut previous = None;
    for index in 0..head.parts {
        let (id,version,nonce,ciphertext):(String,u32,String,String)=conn.query_row("SELECT b.id,b.key_version,b.nonce,b.ciphertext FROM sync_turn_parts p JOIN sync_blobs b ON b.id=p.blob_id WHERE p.turn_id=?1 AND p.part_index=?2",params![head.turn_id,index],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
        if version != context.identity.key_version {
            return Err(SyncError::Identity);
        }
        let plain = crypto::open_blob(
            &context.key,
            &context.identity.account,
            &id,
            version,
            &SealedPayload { nonce, ciphertext },
        )?;
        let piece = piece(&plain, &head.turn_id, index)?;
        if piece.previous != previous {
            return Err(SyncError::Invalid);
        }
        previous = Some(id);
        for entry in piece.entries {
            import.entry(entry)?;
        }
    }
    if previous.as_deref() != Some(&head.tail)
        || !import.metadata
        || !import.started
        || !import.ended
        || import.fragment_total.is_some()
        || import.file.is_some()
        || !import.required.is_empty()
    {
        return Err(SyncError::Invalid);
    }
    let last = import.last_seq.ok_or(SyncError::Invalid)?;
    if branched {
        let event=AuraEvent::Notice{level:aura_protocol::NoticeLevel::Info,message:"Another device continued from the same earlier turn. Both conversation branches are retained.".into()};
        conn.execute("INSERT INTO events(id,chat_id,turn_id,seq,kind,payload,created_at,device_id) SELECT ?1,chat_id,id,?2,'notice',?3,started_at,?4 FROM turns WHERE id=?5",params![crate::ids::new_id(),floor,serde_json::to_string(&event).map_err(|_|SyncError::Invalid)?,clock.device(),head.turn_id])?;
    }
    conn.execute(
        "UPDATE turns SET last_event_seq=?2 WHERE id=?1",
        params![head.turn_id, last],
    )?;
    compact::apply(
        conn,
        &head.chat_id,
        &head.turn_id,
        clock.device(),
        &compact::CompactLimits::STANDARD,
        crate::time::now_millis(),
    )?;
    conn.execute(
        "UPDATE sync_turns SET state='imported' WHERE turn_id=?1",
        [&head.turn_id],
    )?;
    // A previously reviewed local handoff cannot authorize dispatch against newly received history.
    conn.execute(
        "DELETE FROM chat_continuations WHERE chat_id=?1",
        [&head.chat_id],
    )?;
    Ok(Imported {
        chat_id: head.chat_id.clone(),
        turn_id: head.turn_id.clone(),
        next_seq: last + 1,
        next_turn_ordinal: ordinal + 1,
    })
}
impl Import<'_> {
    fn entry(&mut self, entry: Entry) -> Result<()> {
        if let Entry::Fragment {
            offset,
            total,
            bytes,
        } = entry
        {
            if offset as usize != self.fragment.len()
                || self
                    .fragment_total
                    .is_some_and(|expected| expected != total)
            {
                return Err(SyncError::Invalid);
            }
            self.fragment_total = Some(total);
            self.fragment
                .extend_from_slice(&crypto::decode(&bytes, 192 * 1024)?);
            if self.fragment.len() == total as usize {
                let value: Entry =
                    serde_json::from_slice(&self.fragment).map_err(|_| SyncError::Invalid)?;
                self.fragment.clear();
                self.fragment_total = None;
                if matches!(value, Entry::Fragment { .. }) {
                    return Err(SyncError::Invalid);
                }
                validate_entry(&value, &self.header.turn_id)?;
                self.entry(value)?;
            }
            return Ok(());
        }
        if self.fragment_total.is_some() {
            return Err(SyncError::Invalid);
        }
        for hash in referenced(&entry) {
            if !crate::chatstore::blobs::is_sha256(&hash) {
                return Err(SyncError::Invalid);
            }
            self.required.insert(hash);
        }
        if self.required.len() > 8192 {
            return Err(SyncError::Invalid);
        }
        match entry {
            Entry::Turn(turn) => {
                if self.phase != 0
                    || self.metadata
                    || turn.chat_id != self.header.chat_id
                    || turn.parent_turn_id != self.header.parent_turn_id
                {
                    return Err(SyncError::Invalid);
                }
                self.conn.execute("INSERT INTO turns(id,chat_id,seq,status,stop_reason,started_at,ended_at,device_id,prompt_id,first_event_seq,prompt_parts_json,continuation_prefix,parent_turn_id,source_agent) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![turn.turn_id,turn.chat_id,self.ordinal,turn.status,turn.stop_reason,turn.started_at,turn.ended_at,self.device,turn.prompt_id,self.floor,serde_json::to_string(&turn.parts).map_err(|_|SyncError::Invalid)?,turn.continuation_prefix,turn.parent_turn_id,turn.agent])?;
                self.metadata = true;
                self.phase = 1;
            }
            Entry::Event(event) => {
                if self.phase != 1 || self.last_source.is_some_and(|last| event.seq <= last) {
                    return Err(SyncError::Invalid);
                }
                if let Ok(known) = serde_json::from_str::<AuraEvent>(&event.payload) {
                    if !known.is_stored(true) || known.kind() != event.kind {
                        return Err(SyncError::Invalid);
                    }
                    match known {
                        AuraEvent::TurnStarted { turn_id, .. } => {
                            if self.started
                                || self.last_source.is_some()
                                || turn_id != self.header.turn_id
                            {
                                return Err(SyncError::Invalid);
                            }
                            self.started = true;
                        }
                        AuraEvent::TurnEnded { turn_id, .. } => {
                            if self.ended || turn_id != self.header.turn_id {
                                return Err(SyncError::Invalid);
                            }
                            self.ended = true;
                        }
                        _ => {}
                    }
                }
                let first = *self.first_source.get_or_insert(event.seq);
                let seq = self
                    .base
                    .checked_add(event.seq - first)
                    .filter(|seq| *seq < SEQ_LIMIT)
                    .ok_or(SyncError::Invalid)?;
                self.conn.execute("INSERT INTO events(id,chat_id,turn_id,seq,kind,payload,created_at,device_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![crate::ids::new_id(),self.header.chat_id,self.header.turn_id,seq,event.kind,event.payload,event.created_at,self.device])?;
                self.last_source = Some(event.seq);
                self.last_seq = Some(seq);
            }
            Entry::Steering(steer) => {
                if !(1..=2).contains(&self.phase) || !self.ended {
                    return Err(SyncError::Invalid);
                }
                self.phase = 2;
                let first = self.first_source.ok_or(SyncError::Invalid)?;
                if steer.seq < first || self.last_source.is_none_or(|last| steer.seq > last) {
                    return Err(SyncError::Invalid);
                }
                let seq = self
                    .base
                    .checked_add(steer.seq - first)
                    .ok_or(SyncError::Invalid)?;
                self.conn.execute("INSERT INTO steering_inputs(message_id,chat_id,turn_id,seq,parts_json,state,detail,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![steer.message_id,self.header.chat_id,self.header.turn_id,seq,serde_json::to_string(&steer.parts).map_err(|_|SyncError::Invalid)?,steer.state,steer.detail,steer.created_at,steer.updated_at])?;
            }
            Entry::File(file) => self.file(file)?,
            Entry::MissingFile { hash } => {
                if !(1..=3).contains(&self.phase)
                    || !self.ended
                    || self.file.is_some()
                    || !self.required.remove(&hash)
                {
                    return Err(SyncError::Invalid);
                }
                self.phase = 3;
            }
            Entry::Fragment { .. } => unreachable!(),
        }
        Ok(())
    }
    fn file(&mut self, file: File) -> Result<()> {
        if !(1..=3).contains(&self.phase) || !self.ended || !self.required.contains(&file.hash) {
            return Err(SyncError::Invalid);
        }
        self.phase = 3;
        if self.file.is_none() {
            if file.offset != 0 {
                return Err(SyncError::Invalid);
            }
            self.file = Some(FileAssembly {
                hash: file.hash.clone(),
                mime: file.mime.clone(),
                name: file.display_name.clone(),
                total: file.total,
                bytes: Zeroizing::new(Vec::new()),
            });
        }
        let current = self.file.as_mut().ok_or(SyncError::Invalid)?;
        if current.hash != file.hash
            || current.mime != file.mime
            || current.name != file.display_name
            || current.total != file.total
            || current.bytes.len() as u64 != file.offset
        {
            return Err(SyncError::Invalid);
        }
        current
            .bytes
            .extend_from_slice(&crypto::decode(&file.bytes, 192 * 1024)?);
        if current.bytes.len() as u64 == file.total {
            if format!("{:x}", Sha256::digest(&current.bytes)) != file.hash {
                return Err(SyncError::Invalid);
            }
            self.files
                .write(&file.hash, &current.bytes)
                .map_err(|_| SyncError::Database)?;
            self.conn.execute("INSERT INTO attachments(sha256,mime,size,created_at) VALUES(?1,?2,?3,?4) ON CONFLICT(sha256) DO NOTHING",params![file.hash,file.mime,file.total as i64,crate::time::now_millis()])?;
            if let Some(name) = file.display_name {
                self.conn.execute("INSERT INTO composer_attachments(id,chat_id,sha256,display_name,mime,byte_length,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(chat_id,sha256,display_name) DO NOTHING",params![crate::ids::new_id(),self.header.chat_id,file.hash,name,file.mime,file.total as i64,crate::time::now_millis()])?;
            }
            self.required.remove(&file.hash);
            self.file = None;
        }
        Ok(())
    }
}
