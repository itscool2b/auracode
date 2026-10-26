use super::*;
use crate::account_preservation::{Command, PreservationError, Reply};

impl ChatStore {
    pub(crate) async fn preserve_account(
        &self,
        command: Command,
    ) -> crate::account_preservation::Result<Reply> {
        let (reply, answer) = oneshot::channel();
        let permits = tokio::time::timeout(REQUEST_TIMEOUT, self.permits(64 * 1024))
            .await
            .map_err(|_| PreservationError::Storage)?
            .ok_or(PreservationError::Storage)?;
        self.shared.push(
            Work::Request(Request::PreserveAccount { command, reply }),
            Some(permits),
        );
        // The owner retains profile/admission guards until the writer has finished, even after IPC cancellation.
        answer.await.map_err(|_| PreservationError::Storage)?
    }
}
