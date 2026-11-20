use super::*;
use o7_protocol::activity::LineEdits;

impl SessionManager {
    /// The Dashboard's line edits since `since` (Unix milliseconds): every agent's, by quarter hour,
    /// counting the turns that ended since the last call first.
    pub async fn line_edits(&self, since: Millis) -> Result<LineEdits, SessionError> {
        self.deps()
            .store
            .line_edits(since)
            .await
            .map_err(|error| storage_error(&error))
    }
}
