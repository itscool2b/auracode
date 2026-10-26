//! Explicit recovery of a lost secure-store profile binding. The caller selects an existing UUID;
//! no account databases are searched or initialized. Key proof precedes every database mutation.
use super::*;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use rusqlite::{Connection, OpenFlags, params};
use std::{io::Read, path::Path};

impl Accounts {
    /// The desktop holds its transition gate and refuses an already-open target runtime.
    pub async fn rebind_profile(&self, id: &str, now_ms: u64) -> Result<AccountStatus> {
        let mut inner = self.action()?;
        let account = account(&mut inner)?;
        if account.pending_reset_version().is_some() {
            return Err(error::state());
        }
        let (key, version) = account.local_key_handle().ok_or_else(error::state)?;
        let account_id = account.id().to_owned();
        let device = account.device_id().ok_or_else(error::state)?.to_owned();
        if inner.index.accounts.iter().any(|(other, profile)| {
            profile.as_deref().is_some_and(|profile| {
                (other == &account_id && profile != id) || (other != &account_id && profile == id)
            })
        }) {
            return Err(error::state());
        }
        let root = self.profiles.root().root().to_owned();
        let profile_id = id.to_owned();
        let proof_account = account_id.clone();
        tokio::task::spawn_blocking(move || {
            verify_and_rebind(
                &root,
                &profile_id,
                &proof_account,
                &device,
                version,
                &key,
                now_ms,
            )
        })
        .await
        .map_err(|_| error::storage())??;
        // A failure here preserves the previous mapping. Retrying verifies the same database;
        // the device migration is idempotent and never resets its outbox, cursor or config bases.
        let mut index = inner.index.clone();
        index.ensure(&account_id)?;
        index.accounts.insert(account_id, Some(id.to_owned()));
        index
            .save(self.vault.clone(), self.index_entry.clone())
            .await?;
        inner.index = index;
        snapshot(&inner)
    }
}

fn denied() -> AccountFailure {
    error::failure(
        AccountFailureCode::LocalStorage,
        "The recovered key does not match this existing Account workspace, or its files are unavailable. Nothing was replaced.",
    )
}

fn regular(dir: &Dir, name: &str, writable: bool) -> Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(writable)
        .follow(FollowSymlinks::No);
    let file = dir
        .open_with(name, &options)
        .map_err(|_| denied())?
        .into_std();
    if !file.metadata().map_err(|_| denied())?.is_file() {
        return Err(denied());
    }
    Ok(file)
}

fn same(dir: &Dir, path: &Path) -> Result<()> {
    let held = same_file::Handle::from_file(dir.try_clone().map_err(|_| denied())?.into_std_file())
        .map_err(|_| denied())?;
    let current = same_file::Handle::from_file(
        Dir::open_ambient_dir(path, cap_std::ambient_authority())
            .map_err(|_| denied())?
            .into_std_file(),
    )
    .map_err(|_| denied())?;
    if held != current {
        return Err(denied());
    }
    Ok(())
}

fn verify_and_rebind(
    root: &Path,
    id: &str,
    account: &str,
    device: &str,
    version: u32,
    key: &Arc<AccountKey>,
    now_ms: u64,
) -> Result<()> {
    if !uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        return Err(denied());
    }
    let path = std::fs::canonicalize(root.join("profiles").join(id)).map_err(|_| denied())?;
    let root = Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| denied())?;
    let profiles = root.open_dir_nofollow("profiles").map_err(|_| denied())?;
    let dir = profiles.open_dir_nofollow(id).map_err(|_| denied())?;
    let mut bytes = Vec::new();
    regular(&dir, "profile.json", false)?
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|_| denied())?;
    if bytes.len() > 16_384 {
        return Err(denied());
    }
    let meta: crate::profile::ProfileMeta = serde_json::from_slice(&bytes).map_err(|_| denied())?;
    if meta.kind != ProfileKind::Account || meta.id != id {
        return Err(denied());
    }
    // A strict lock is required here. Unsupported locking is not permission to rewrite identity.
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .follow(FollowSymlinks::No);
    let owner = dir
        .open_with("owner.lock", &options)
        .map_err(|_| denied())?
        .into_std();
    if !owner.metadata().map_err(|_| denied())?.is_file() || owner.try_lock().is_err() {
        return Err(denied());
    }
    let db = regular(&dir, "aura.encrypted.db", false)?;
    if db.metadata().map_err(|_| denied())?.len() == 0 {
        return Err(denied());
    }
    let mut sidecars = Vec::new();
    for name in [
        "aura.encrypted.db-wal",
        "aura.encrypted.db-shm",
        "aura.encrypted.db-journal",
    ] {
        match dir.symlink_metadata(name) {
            Ok(_) => sidecars.push(regular(&dir, name, false)?),
            Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(denied()),
        }
    }
    same(&dir, &path)?;
    // NOFOLLOW prevents SQLite from following a replaced leaf. Parent capabilities and file
    // identities are retained and checked again before the first write.
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let mut conn =
        Connection::open_with_flags(path.join("aura.encrypted.db"), flags).map_err(|_| denied())?;
    let db_key = key.database_key(account, id).map_err(error::crypto)?;
    aura_sync::database::configure(&mut conn, &db_key).map_err(|_| denied())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|_| denied())?;
    conn.execute_batch("PRAGMA trusted_schema=OFF")
        .map_err(|_| denied())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| denied())?;
    let pinned: (String, String, u32, String, String) = tx.query_row(
        "SELECT account_id,device_id,key_version,key_fingerprint,last_hlc FROM sync_state WHERE singleton=1", [],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).map_err(|_| denied())?;
    if pinned.0 != account
        || pinned.2 != version
        || pinned.3 != key.fingerprint(account, version).map_err(error::crypto)?
    {
        return Err(denied());
    }
    same(&dir, &path)?;
    let held = same_file::Handle::from_file(db).map_err(|_| denied())?;
    let current = same_file::Handle::from_file(regular(&dir, "aura.encrypted.db", false)?)
        .map_err(|_| denied())?;
    if held != current {
        return Err(denied());
    }
    if pinned.1 != device {
        let prior = pinned
            .4
            .parse::<aura_sync::clock::Hlc>()
            .map_err(|_| denied())?;
        if prior.device() != pinned.1 {
            return Err(denied());
        }
        let mut clock = aura_sync::clock::Clock::new(device).map_err(|_| denied())?;
        clock.observe(&prior, now_ms).map_err(|_| denied())?;
        let identity = crate::sync::SyncIdentity {
            account: account.into(),
            device: device.into(),
            key_version: version,
        };
        crate::sync::rebind::outgoing_for_device(&tx, &identity, key, &mut clock, now_ms)
            .map_err(|_| denied())?;
        tx.execute(
            "UPDATE sync_state SET device_id=?1,last_hlc=?2 WHERE singleton=1",
            params![device, clock.last().to_string()],
        )
        .map_err(|_| denied())?;
    }
    tx.commit().map_err(|_| denied())?;
    Ok(())
}
