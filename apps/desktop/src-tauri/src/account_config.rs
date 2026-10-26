//! Rust-only services for a confirmed-key Account profile. Callers retain their ProfileLease and
//! filesystem mutation guard through owned tasks; neither encryption authority nor tokens reach IPC.
use std::sync::Arc;

use aura_config::sync::{ConfigApplyJournal, ConfigSyncPort};
use aura_core::{chatstore::ChatStore, sync::journal::AccountConfigJournal};

pub struct AccountConfigServices {
    pub port: Arc<dyn ConfigSyncPort>,
    pub journal: Arc<dyn ConfigApplyJournal>,
    owned_journal: Arc<AccountConfigJournal>,
}

impl AccountConfigServices {
    pub(crate) fn new(store: &Arc<ChatStore>, journal: AccountConfigJournal) -> Self {
        let owned_journal = Arc::new(journal);
        Self {
            port: store.config_sync_port(),
            journal: owned_journal.clone(),
            owned_journal,
        }
    }
    pub(crate) fn close(&self) {
        self.owned_journal.close();
    }
}
