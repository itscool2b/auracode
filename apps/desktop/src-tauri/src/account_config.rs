//! Rust-only services for a confirmed-key Account profile. Callers retain their ProfileLease and
//! filesystem mutation guard through owned tasks; neither encryption authority nor tokens reach IPC.
use std::sync::Arc;

use aura_config::sync::managed::ConfigManagedStore;
use aura_config::sync::{ConfigApplyJournal, ConfigSyncPort};
use aura_core::sync::managed_config::AccountManagedConfig;
use aura_core::{chatstore::ChatStore, sync::journal::AccountConfigJournal};

pub struct AccountConfigServices {
    pub port: Arc<dyn ConfigSyncPort>,
    pub journal: Arc<dyn ConfigApplyJournal>,
    pub managed: Arc<dyn ConfigManagedStore>,
    owned_journal: Arc<AccountConfigJournal>,
    owned_managed: Arc<AccountManagedConfig>,
}

impl AccountConfigServices {
    pub(crate) fn new(
        store: &Arc<ChatStore>,
        journal: AccountConfigJournal,
        managed: AccountManagedConfig,
    ) -> Self {
        let owned_journal = Arc::new(journal);
        let owned_managed = Arc::new(managed);
        Self {
            port: store.config_sync_port(),
            journal: owned_journal.clone(),
            managed: owned_managed.clone(),
            owned_journal,
            owned_managed,
        }
    }
    pub(crate) fn close(&self) {
        self.owned_journal.close();
        self.owned_managed.close();
    }
}
