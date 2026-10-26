//! One coalesced worker per active Account runtime. HTTP never holds database transactions; all
//! ingress and acknowledgements go through the profile writer. Stop drops only this owned task.
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use super::{
    SyncIdentity,
    exchange::{Command, Download, Pending, Reply, Upload},
};
use crate::chatstore::ChatStore;
use aura_protocol::account::{
    AccountFailure, AccountFailureCode, AccountSyncState, AccountSyncStatus,
};
use aura_sync::wire::{Blob, Heads};
use tokio::sync::{Notify, watch};

pub enum NetworkRequest {
    Connect,
    Pull(u64),
    Push(Vec<aura_sync::wire::EncryptedRecord>),
    Upload(Upload),
    Download(String),
}
pub enum NetworkReply {
    Connected,
    Pull(aura_sync::wire::Pull),
    Heads(Heads),
    Uploaded(String),
    Blob(Blob),
}
pub type NetworkFuture<'a> =
    Pin<Box<dyn Future<Output = Result<NetworkReply, AccountFailure>> + Send + 'a>>;
/// Injected fake networks exercise the scheduler without authentication, vendor calls or sockets.
pub trait Network: Send + Sync {
    fn request<'a>(
        &'a self,
        identity: &'a SyncIdentity,
        request: NetworkRequest,
    ) -> NetworkFuture<'a>;
}

pub struct SyncEngine {
    wake: Arc<Notify>,
    stop: watch::Sender<Control>,
    status: watch::Receiver<AccountSyncStatus>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Control {
    Running,
    Paused,
    Stopped,
}
impl SyncEngine {
    pub fn start(
        store: Arc<ChatStore>,
        network: Arc<dyn Network>,
        identity: SyncIdentity,
        rt: &tokio::runtime::Handle,
    ) -> Self {
        let wake = Arc::new(Notify::new());
        let (stop, stopped) = watch::channel(Control::Running);
        let (send, status) = watch::channel(AccountSyncStatus {
            state: AccountSyncState::Idle,
            pending_changes: None,
            last_sync_at: None,
            message: None,
        });
        let task = rt.spawn(run(store, network, identity, wake.clone(), stopped, send));
        wake.notify_one();
        Self {
            wake,
            stop,
            status,
            task: std::sync::Mutex::new(Some(task)),
        }
    }
    pub fn trigger(&self) {
        self.wake.notify_one();
    }
    pub fn subscribe(&self) -> watch::Receiver<AccountSyncStatus> {
        self.status.clone()
    }
    pub fn status(&self) -> AccountSyncStatus {
        self.status.borrow().clone()
    }
    pub fn stop(&self) {
        self.stop.send_replace(Control::Stopped);
    }
    /// Explicit account actions suspend sync first, so sign-out never waits behind an HTTP request
    /// while the scheduler dispatches another one. The acknowledgement follows future cancellation.
    pub async fn suspend(&self, deadline: Duration) -> bool {
        if *self.stop.borrow() == Control::Stopped {
            return true;
        }
        self.stop.send_replace(Control::Paused);
        let mut status = self.status.clone();
        tokio::time::timeout(deadline, async move {
            while matches!(status.borrow().state, AccountSyncState::Syncing) {
                if status.changed().await.is_err() {
                    return false;
                }
            }
            true
        })
        .await
        .unwrap_or(false)
    }
    pub fn resume(&self) {
        if *self.stop.borrow() != Control::Stopped {
            self.stop.send_replace(Control::Running);
            self.wake.notify_one();
        }
    }
    pub async fn close(&self, deadline: Duration) -> bool {
        self.stop();
        let task = self
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let Some(mut task) = task else {
            return true;
        };
        match tokio::time::timeout(deadline, &mut task).await {
            Ok(result) => result.is_ok(),
            Err(_) => {
                task.abort();
                false
            }
        }
    }
}
impl Drop for SyncEngine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn failure(code: AccountFailureCode, message: &str) -> AccountFailure {
    AccountFailure {
        code,
        message: message.into(),
        retry_after_seconds: None,
    }
}
fn storage(_: super::SyncError) -> AccountFailure {
    failure(
        AccountFailureCode::LocalStorage,
        "The sync transaction could not be saved. Pending changes remain on this device.",
    )
}
fn protocol() -> AccountFailure {
    failure(
        AccountFailureCode::Protocol,
        "The sync response did not match the requested operation.",
    )
}
async fn pending(store: &ChatStore) -> Result<Pending, AccountFailure> {
    match store
        .sync_exchange(Command::Pending)
        .await
        .map_err(storage)?
    {
        Reply::Pending(work) => Ok(work),
        _ => Err(protocol()),
    }
}
async fn download(
    store: &ChatStore,
    network: &dyn Network,
    identity: &SyncIdentity,
    request: Download,
) -> Result<(), AccountFailure> {
    let NetworkReply::Blob(blob) = network
        .request(identity, NetworkRequest::Download(request.id.clone()))
        .await?
    else {
        return Err(protocol());
    };
    store
        .sync_exchange(Command::Downloaded { request, blob })
        .await
        .map_err(storage)?;
    Ok(())
}
async fn cycle(
    store: &ChatStore,
    network: &dyn Network,
    identity: &SyncIdentity,
) -> Result<(u32, bool), AccountFailure> {
    if !matches!(
        network.request(identity, NetworkRequest::Connect).await?,
        NetworkReply::Connected
    ) {
        return Err(protocol());
    }
    let work = pending(store).await?;
    if let Some(sent) = work.upload {
        let NetworkReply::Uploaded(etag) = network
            .request(identity, NetworkRequest::Upload(sent.clone()))
            .await?
        else {
            return Err(protocol());
        };
        store
            .sync_exchange(Command::Uploaded { sent, etag })
            .await
            .map_err(storage)?;
    }
    let NetworkReply::Pull(page) = network
        .request(identity, NetworkRequest::Pull(work.cursor))
        .await?
    else {
        return Err(protocol());
    };
    let more = page.has_more;
    store
        .sync_exchange(Command::Pull(page))
        .await
        .map_err(storage)?;
    let work = pending(store).await?;
    if !work.records.is_empty() {
        let NetworkReply::Heads(heads) = network
            .request(identity, NetworkRequest::Push(work.records.clone()))
            .await?
        else {
            return Err(protocol());
        };
        store
            .sync_exchange(Command::Heads {
                sent: work.records,
                heads: heads.heads,
            })
            .await
            .map_err(storage)?;
    }
    // Read again because the authoritative push response can introduce a newer remote blob.
    for request in pending(store).await?.downloads {
        download(store, network, identity, request).await?;
    }
    let work = pending(store).await?;
    Ok((
        work.changes,
        more || work.upload.is_some() || !work.records.is_empty() || !work.downloads.is_empty(),
    ))
}

fn error_state(error: &AccountFailure) -> AccountSyncState {
    match error.code {
        AccountFailureCode::Offline
        | AccountFailureCode::TimedOut
        | AccountFailureCode::Unavailable
        | AccountFailureCode::NotFound => AccountSyncState::Offline,
        AccountFailureCode::Unauthorized
        | AccountFailureCode::Forbidden
        | AccountFailureCode::InvalidState
        | AccountFailureCode::Quota
        | AccountFailureCode::RateLimited => AccountSyncState::Paused,
        _ => AccountSyncState::Error,
    }
}
async fn run(
    store: Arc<ChatStore>,
    network: Arc<dyn Network>,
    identity: SyncIdentity,
    wake: Arc<Notify>,
    mut stopped: watch::Receiver<Control>,
    send: watch::Sender<AccountSyncStatus>,
) {
    let mut due = tokio::time::Instant::now();
    let mut blocked_until = due;
    let mut failures = 0u32;
    let mut auth_paused = false;
    loop {
        if *stopped.borrow() == Control::Stopped {
            break;
        }
        if *stopped.borrow() == Control::Paused || auth_paused {
            let previous = send.borrow().clone();
            send.send_replace(AccountSyncStatus {
                state: AccountSyncState::Paused,
                ..previous
            });
            if stopped.changed().await.is_err() {
                break;
            }
            auth_paused = false;
            due = tokio::time::Instant::now().max(blocked_until);
            continue;
        }
        tokio::select! {
            biased;
            _ = stopped.changed() => { if stopped.has_changed().is_err() {break;} continue; },
            _ = wake.notified() => { if tokio::time::Instant::now() < blocked_until {continue;} },
            _ = tokio::time::sleep_until(due) => {},
        }
        if *stopped.borrow() != Control::Running {
            continue;
        }
        let previous = send.borrow().clone();
        send.send_replace(AccountSyncStatus {
            state: AccountSyncState::Syncing,
            message: None,
            ..previous.clone()
        });
        let result = tokio::select! { biased; _=stopped.changed()=>continue, result=cycle(&store,network.as_ref(),&identity)=>result };
        let now = tokio::time::Instant::now();
        match result {
            Ok((pending, more)) => {
                failures = 0;
                blocked_until = now;
                due = now
                    + if more {
                        Duration::from_millis(200)
                    } else {
                        Duration::from_secs(60)
                    };
                send.send_replace(AccountSyncStatus {
                    state: AccountSyncState::Idle,
                    pending_changes: Some(pending),
                    last_sync_at: Some(crate::time::now_millis()),
                    message: None,
                });
            }
            Err(error) => {
                auth_paused = matches!(
                    error.code,
                    AccountFailureCode::Unauthorized
                        | AccountFailureCode::Forbidden
                        | AccountFailureCode::InvalidState
                );
                failures = failures.saturating_add(1);
                let delay = error
                    .retry_after_seconds
                    .map(u64::from)
                    .unwrap_or_else(|| 5u64.saturating_mul(1u64 << failures.min(6)))
                    .clamp(1, 86_400);
                due = now + Duration::from_secs(delay);
                blocked_until = due;
                send.send_replace(AccountSyncStatus {
                    state: error_state(&error),
                    message: Some(error.message),
                    ..previous
                });
            }
        }
    }
    let previous = send.borrow().clone();
    send.send_replace(AccountSyncStatus {
        state: AccountSyncState::Inactive,
        message: None,
        ..previous
    });
}

#[cfg(test)]
mod tests;
