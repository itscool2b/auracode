use super::*;
use crate::sync::SyncContext;
#[cfg(test)]
mod tests;

impl ChatStore {
    /// Attach before publishing an Account runtime. This verifies the pinned identity and seeds
    /// portable metadata in bounded transactions; Local and mismatched keyed stores are refused.
    pub async fn configure_sync(&self, context: SyncContext) -> Result<(), StoreError> {
        let (reply, answer) = oneshot::channel();
        let permits = tokio::time::timeout(REQUEST_TIMEOUT, self.permits(256))
            .await
            .map_err(|_| self.timed_out())?
            .ok_or(StoreError::Closed)?;
        self.shared.push(
            Work::Request(Request::ConfigureSync { context, reply }),
            Some(permits),
        );
        answer.await.map_err(|_| StoreError::Closed)?
    }
}
