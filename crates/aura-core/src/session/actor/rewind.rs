//! A sent message's Rewind through the agent's own file checkpoints (Claude's `rewind_files`).
//! auracode's checkpoints come first where a turn has one; this serves turns without one.
use super::*;
use aura_drivers::driver::FileRewindResult;
use aura_protocol::changes::NativeRewind;

type Reply = oneshot::Sender<Result<NativeRewind, SessionError>>;

pub(super) struct Completion {
    generation: u64,
    reply: Reply,
    result: Result<
        Result<Result<FileRewindResult, DriverError>, oneshot::error::RecvError>,
        tokio::time::error::Elapsed,
    >,
}

fn count(value: Option<u64>) -> Option<u32> {
    value.map(|value| u32::try_from(value).unwrap_or(u32::MAX))
}

impl ChatActor {
    /// Only an idle session whose agent advertised rewind takes one; the agent itself refuses a
    /// message it holds no checkpoint for.
    pub(super) fn rewind_files(&mut self, turn_id: String, dry_run: bool, reply: Reply) {
        if !self.capabilities.as_ref().is_some_and(|caps| caps.rewind) {
            let _ = reply.send(Err(SessionError::OptionInvalid(
                "This session cannot restore files from the agent's own checkpoints.".into(),
            )));
            return;
        }
        if !self.controls_idle() {
            let _ = reply.send(Err(SessionError::OptionInvalid(
                "Wait until the agent is idle, clear queued messages and answer pending requests before restoring files.".into(),
            )));
            return;
        }
        let (answer, receiver) = oneshot::channel();
        let generation = self.generation;
        self.rewind_pending = true;
        self.send_command(DriverCommand::RewindFiles {
            user_message_id: turn_id,
            dry_run,
            reply: answer,
        });
        self.in_flight.push(
            async move {
                Done::Rewind(Box::new(Completion {
                    generation,
                    reply,
                    result: tokio::time::timeout(OPTION_REPLY_TIMEOUT, receiver).await,
                }))
            }
            .boxed(),
        );
    }

    pub(super) fn rewind_done(&mut self, completion: Completion) {
        let Completion {
            generation,
            reply,
            result,
        } = completion;
        if generation != self.generation {
            let _ = reply.send(Err(SessionError::SessionNotReady));
            return;
        }
        self.rewind_pending = false;
        let result = match result {
            Ok(Ok(Ok(result))) => Ok(NativeRewind {
                files: result.files_changed,
                insertions: count(result.insertions),
                deletions: count(result.deletions),
                skipped_links: count(result.skipped_links),
            }),
            Ok(Ok(Err(error))) => Err(SessionError::OptionInvalid(error.message)),
            _ => Err(SessionError::OptionInvalid(
                "The agent did not confirm the file restore. Check the files before continuing."
                    .into(),
            )),
        };
        let _ = reply.send(result);
        self.dispatch_next();
    }
}
