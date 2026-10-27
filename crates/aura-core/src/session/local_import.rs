use super::*;
use crate::profile::Profile;
use aura_protocol::local_import::{LocalImportPreview, LocalImportResult, LocalImportSelection};

impl SessionManager {
    pub async fn local_import_preview(
        &self,
        source: Profile,
    ) -> Result<LocalImportPreview, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        self.deps()
            .store
            .local_import_preview(source)
            .await
            .map_err(import_error)
    }
    /// This owned task retains admission through the actual writer result, even if IPC disappears.
    pub async fn local_import_apply(
        &self,
        source: Profile,
        selected: Vec<LocalImportSelection>,
    ) -> Result<LocalImportResult, SessionError> {
        crate::local_import::selection(&selected).map_err(import_error)?;
        let manager = self.clone();
        self.deps().rt.spawn(async move {
            let _organization=manager.shared().organization.lock().await;
            let _idle=manager.try_quiesce_when_idle().ok_or_else(||SessionError::Organization("Stop running agents and wait for folder work to finish before importing Local projects.".into()))?;
            manager.deps().store.local_import_apply(source,selected).await.map_err(import_error)
        }).await.map_err(|_|SessionError::Internal("The Local import task could not finish.".into()))?
    }
}
fn import_error(error: crate::local_import::ImportError) -> SessionError {
    SessionError::Organization(error.to_string())
}
