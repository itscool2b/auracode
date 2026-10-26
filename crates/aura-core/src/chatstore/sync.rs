use super::*;
use crate::sync::SyncContext;
use crate::sync::config::{Command, Reply};
use aura_config::sync::*;
use zeroize::Zeroizing;
#[cfg(test)]
mod tests;

impl ChatStore {
    /// Encrypted transfer requests have the same FIFO ownership and profile binding as local edits.
    /// Once queued, their transaction finishes even if a network task stops waiting for its reply.
    pub async fn sync_exchange(
        &self,
        command: crate::sync::exchange::Command,
    ) -> crate::sync::Result<crate::sync::exchange::Reply> {
        use crate::sync::SyncError;
        command.validate()?;
        let (reply, answer) = oneshot::channel();
        let permits = tokio::time::timeout(REQUEST_TIMEOUT, self.permits(command.bytes()))
            .await
            .map_err(|_| SyncError::Unavailable)?
            .ok_or(SyncError::Unavailable)?;
        self.shared.push(
            Work::Request(Request::SyncExchange { command, reply }),
            Some(permits),
        );
        answer.await.map_err(|_| SyncError::Unavailable)?
    }
    /// Bound to this writer for its lifetime. Closing the profile invalidates every retained port;
    /// a new profile can never be selected through a port argument.
    pub fn config_sync_port(self: &Arc<Self>) -> Arc<dyn ConfigSyncPort> {
        Arc::new(ConfigPort(self.clone()))
    }
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

struct ConfigPort(Arc<ChatStore>);
impl ConfigPort {
    async fn run(&self, command: Command) -> Result<Reply, ConfigPortError> {
        command.validate()?;
        let (reply, answer) = oneshot::channel();
        let permits = tokio::time::timeout(REQUEST_TIMEOUT, self.0.permits(command.bytes()))
            .await
            .map_err(|_| ConfigPortError::Storage)?
            .ok_or(ConfigPortError::Unavailable)?;
        self.0.shared.push(
            Work::Request(Request::Config { command, reply }),
            Some(permits),
        );
        answer.await.map_err(|_| ConfigPortError::Unavailable)?
    }
}
impl ConfigSyncPort for ConfigPort {
    fn list_heads(&self) -> ConfigFuture<'_, Vec<ConfigSnapshotRef>> {
        Box::pin(async move {
            match self.run(Command::Heads).await? {
                Reply::Heads(values) => Ok(values),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn read_head<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigSnapshotHead>> {
        Box::pin(async move {
            match self.run(Command::Head(id.into())).await? {
                Reply::Head(value) => Ok(value),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn read_snapshot<'a>(
        &'a self,
        id: &'a str,
        head: &'a ConfigSnapshotHead,
    ) -> ConfigFuture<'a, Zeroizing<Vec<u8>>> {
        Box::pin(async move {
            match self
                .run(Command::Snapshot {
                    id: id.into(),
                    head: head.clone(),
                })
                .await?
            {
                Reply::Snapshot(value) => Ok(value),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn publish_snapshot<'a>(
        &'a self,
        id: &'a str,
        expected_revision: Option<&'a str>,
        snapshot: Zeroizing<Vec<u8>>,
        metadata: ConfigSnapshotMetadata,
    ) -> ConfigFuture<'a, ConfigSnapshotHead> {
        Box::pin(async move {
            match self
                .run(Command::Publish {
                    id: id.into(),
                    expected: expected_revision.map(str::to_owned),
                    snapshot,
                    metadata,
                })
                .await?
            {
                Reply::Published(value) => Ok(value),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn list_device_ids(&self) -> ConfigFuture<'_, Vec<String>> {
        Box::pin(async move {
            match self.run(Command::DeviceIds).await? {
                Reply::Ids(values) => Ok(values),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn read_device_state<'a>(&'a self, id: &'a str) -> ConfigFuture<'a, Option<ConfigDeviceState>> {
        Box::pin(async move {
            match self.run(Command::Device(id.into())).await? {
                Reply::Device(value) => Ok(value),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
    fn save_device_state<'a>(
        &'a self,
        id: &'a str,
        expected_head: Option<&'a str>,
        state: ConfigDeviceState,
    ) -> ConfigFuture<'a, ()> {
        Box::pin(async move {
            match self
                .run(Command::SaveDevice {
                    id: id.into(),
                    expected: expected_head.map(str::to_owned),
                    state,
                })
                .await?
            {
                Reply::Saved => Ok(()),
                _ => Err(ConfigPortError::Invalid),
            }
        })
    }
}
