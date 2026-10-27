//! Account-bound HTTP adapter. Tokens stay inside the account state machine and auth failures clear
//! its session before the scheduler is told to pause. Invitation restrictions preserve the session
//! for account management. Another selected account is never substituted.
use super::*;
use crate::sync::{
    SyncIdentity,
    engine::{Network, NetworkFuture, NetworkReply, NetworkRequest},
};

impl Network for Accounts {
    fn request<'a>(
        &'a self,
        identity: &'a SyncIdentity,
        request: NetworkRequest,
    ) -> NetworkFuture<'a> {
        Box::pin(async move {
            let mut inner = self.inner.lock().await;
            let account = account(&mut inner)?;
            if account.id() != identity.account
                || account.device_id() != Some(identity.device.as_str())
                || account
                    .local_key_handle()
                    .is_none_or(|(_, version)| version != identity.key_version)
            {
                return Err(error::state());
            }
            let now = crate::time::now_millis() / 1000;
            let result = match request {
                NetworkRequest::Connect => {
                    if account.access() == &Access::VerificationRequired {
                        account.connect(now).await.map_err(error::account)?;
                    }
                    if account.access() == &Access::InviteRequired {
                        return Err(error::api(aura_sync::api::ApiError::InviteRequired));
                    }
                    if account.access() != &Access::Ready {
                        return Err(error::state());
                    }
                    NetworkReply::Connected
                }
                NetworkRequest::Pull(cursor) => {
                    NetworkReply::Pull(account.pull(cursor, now).await.map_err(error::account)?)
                }
                NetworkRequest::Push(records) => {
                    NetworkReply::Heads(account.push(&records, now).await.map_err(error::account)?)
                }
                NetworkRequest::Upload(upload) => NetworkReply::Uploaded(
                    account
                        .upload_blob(&upload.id, &upload.sealed, upload.key_version, now)
                        .await
                        .map_err(error::account)?,
                ),
                NetworkRequest::Download(id) => {
                    NetworkReply::Blob(account.blob(&id, now).await.map_err(error::account)?)
                }
            };
            Ok(result)
        })
    }
}
