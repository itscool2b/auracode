use super::*;
use crate::sync::{
    exchange::{Command, Reply},
    transcript::Imported,
};

impl ChatActor {
    pub(super) fn import_sync(&mut self, reply: oneshot::Sender<Result<bool, SessionError>>) {
        if self.organizing
            || self.steering_pending
            || self.driver.is_some()
            || self.preparing.is_some()
            || !self.retiring.is_empty()
            || self.checkpointing.is_some()
            || self.turn.is_some()
            || !self.queue.is_empty()
            || self.pending_start.is_some()
            || self.native_identity_pending.is_some()
            || self.quitting
            || self.shared.is_shutting_down()
            || !self.in_flight.is_empty()
        {
            let _ = reply.send(Ok(false));
            return;
        }
        if self.store.is_paused() {
            let _ = reply.send(Err(SessionError::StorageUnavailable(
                "Wait for saving to resume before receiving remote history.".into(),
            )));
            return;
        }
        self.flush();
        let minimum_seq = self.batcher.next_seq();
        self.organizing = true;
        self.sync_importing = true;
        let (saved, barrier) = oneshot::channel();
        self.queue_op(Op::Barrier(saved));
        let store = self.store.clone();
        let chat_id = self.chat_id.clone();
        let rt = self.shared.deps.rt.clone();
        self.in_flight.push(
            async move {
                let result = async {
                    await_reply(&rt, barrier, Duration::from_secs(5))
                        .await
                        .map_err(|_| {
                            SessionError::StorageUnavailable(
                                "Earlier transcript changes are still saving.".into(),
                            )
                        })?;
                    let reply = store
                        .sync_exchange(Command::Import {
                            chat_id,
                            minimum_seq,
                        })
                        .await
                        .map_err(|error| SessionError::StorageUnavailable(error.to_string()))?;
                    let Reply::Imported(result) = reply else {
                        return Err(SessionError::Internal(
                            "The remote history response was invalid.".into(),
                        ));
                    };
                    Ok(result)
                }
                .await;
                Done::SyncImported { result, reply }
            }
            .boxed(),
        );
    }
    pub(super) fn sync_imported(
        &mut self,
        result: Result<Option<Imported>, SessionError>,
        reply: oneshot::Sender<Result<bool, SessionError>>,
    ) {
        self.organizing = false;
        self.sync_importing = false;
        let result = result.map(|imported| {
            let Some(imported) = imported else {
                return false;
            };
            self.batcher = FrameBatcher::new(self.chat_id.clone()).starting_at(imported.next_seq);
            self.ordinal = imported.next_turn_ordinal.saturating_sub(1);
            self.remote_history = true;
            self.continuation = None;
            self.replay_check = None;
            self.needs_attention = true;
            // The durable rows deliberately skip the old stream cursor. Existing views use the
            // established gap->detach->attach protocol to reload a consistent history snapshot.
            self.set_status(
                SessionStatus::Stopped,
                Some("New history arrived from another device. Review Continue here before sending to an agent.".into()),
            );
            self.info_dirty = true;
            self.flush();
            true
        });
        let _ = reply.send(result);
    }
}
