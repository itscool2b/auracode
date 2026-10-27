//! Directory capabilities confine removal to a reviewed app profile. The encrypted index owns the
//! receipt. A nonsecret marker binds its private staging directory across an interrupted deletion.
use super::*;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::io::{Read, Write};

const STAGING: &str = ".account-removals";
const MARKER: &str = "owner";

fn root(path: &std::path::Path) -> Result<Dir> {
    Dir::open_ambient_dir(path, cap_std::ambient_authority()).map_err(|_| error::storage())
}
fn read(dir: &Dir, name: &str, limit: u64) -> Result<Vec<u8>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = dir
        .open_with(name, &options)
        .map_err(|_| error::storage())?;
    let meta = file.metadata().map_err(|_| error::storage())?;
    if !meta.is_file() || meta.len() > limit {
        return Err(error::storage());
    }
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error::storage())?;
    if bytes.len() as u64 > limit {
        return Err(error::storage());
    }
    Ok(bytes)
}
fn metadata(dir: &Dir, id: &str) -> Result<(crate::profile::ProfileMeta, String)> {
    use sha2::{Digest, Sha256};
    let bytes = read(dir, "profile.json", 16_384)?;
    let meta: crate::profile::ProfileMeta =
        serde_json::from_slice(&bytes).map_err(|_| error::storage())?;
    if meta.id != id || meta.kind != ProfileKind::Account {
        return Err(error::state());
    }
    Ok((meta, format!("{:x}", Sha256::digest(&bytes))))
}
pub(super) fn review(path: &std::path::Path, id: &str) -> Result<(String, String, String)> {
    let dir = root(path)?
        .open_dir_nofollow("profiles")
        .and_then(|profiles| profiles.open_dir_nofollow(id))
        .map_err(|_| error::storage())?;
    let (meta, hash) = metadata(&dir, id)?;
    Ok((meta.display_name, hash, tree_hash(&dir)?))
}
fn tree_hash(dir: &Dir) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    let mut budget = 100_000;
    inspect(dir, 0, &mut budget, &mut hash)?;
    Ok(format!("{:x}", hash.finalize()))
}
fn inspect(dir: &Dir, depth: usize, budget: &mut usize, hash: &mut sha2::Sha256) -> Result<()> {
    use sha2::Digest;
    if depth > 64 {
        return Err(error::storage());
    }
    let mut entries = dir
        .entries()
        .map_err(|_| error::storage())?
        .take(*budget + 1)
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| error::storage())?;
    if entries.len() > *budget {
        return Err(error::storage());
    }
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if depth == 0 && entry.file_name() == "owner.lock" {
            continue;
        }
        *budget = budget.checked_sub(1).ok_or_else(error::storage)?;
        let kind = entry.file_type().map_err(|_| error::storage())?;
        if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
            return Err(error::storage());
        }
        let name = entry.file_name();
        let name = name.as_encoded_bytes();
        hash.update((name.len() as u64).to_be_bytes());
        hash.update(name);
        let meta = dir
            .symlink_metadata(entry.file_name())
            .map_err(|_| error::storage())?;
        if meta.file_type().is_symlink() {
            return Err(error::storage());
        }
        hash.update([u8::from(kind.is_dir())]);
        hash.update(meta.len().to_be_bytes());
        hash.update(
            meta.modified()
                .map_err(|_| error::storage())?
                .into_std()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| error::storage())?
                .as_nanos()
                .to_be_bytes(),
        );
        if kind.is_dir() {
            inspect(
                &dir.open_dir_nofollow(entry.file_name())
                    .map_err(|_| error::storage())?,
                depth + 1,
                budget,
                hash,
            )?;
        }
    }
    Ok(())
}
fn marker(receipt: &Receipt) -> Vec<u8> {
    format!(
        "auracode-profile-removal-v1\n{}\n{}\n",
        receipt.token, receipt.profile_id
    )
    .into_bytes()
}
fn lock_owner(dir: &Dir) -> Result<aura_process::locked_file::LockedFile> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .follow(FollowSymlinks::No);
    let file = dir
        .open_with("owner.lock", &options)
        .map_err(|_| error::storage())?
        .into_std();
    if !file.metadata().map_err(|_| error::storage())?.is_file() || file.try_lock().is_err() {
        return Err(error::state());
    }
    Ok(aura_process::locked_file::LockedFile::new(file))
}
fn sync(dir: &Dir) -> Result<()> {
    #[cfg(unix)]
    dir.try_clone()
        .and_then(|dir| dir.into_std_file().sync_all())
        .map_err(|_| error::storage())?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}
fn wrapper(path: &std::path::Path, receipt: &Receipt, create: bool) -> Result<(Dir, Dir)> {
    let root = root(path)?
        .open_dir_nofollow("profiles")
        .map_err(|_| error::storage())?;
    if create {
        match root.create_dir(STAGING) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(error::storage()),
        }
    }
    let parent = root
        .open_dir_nofollow(STAGING)
        .map_err(|_| error::storage())?;
    let created = if create {
        match parent.create_dir(&receipt.token) {
            Ok(()) => true,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => false,
            Err(_) => return Err(error::storage()),
        }
    } else {
        false
    };
    let dir = parent
        .open_dir_nofollow(&receipt.token)
        .map_err(|_| error::storage())?;
    let missing =
        matches!(dir.symlink_metadata(MARKER),Err(e) if e.kind()==std::io::ErrorKind::NotFound);
    if created
        || (create
            && missing
            && dir
                .entries()
                .map_err(|_| error::storage())?
                .next()
                .is_none())
    {
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = dir
            .open_with(MARKER, &options)
            .map_err(|_| error::storage())?;
        file.write_all(&marker(receipt))
            .and_then(|()| file.sync_all())
            .map_err(|_| error::storage())?;
        sync(&dir)?;
        sync(&parent)?;
    }
    if read(&dir, MARKER, 256)? != marker(receipt) {
        return Err(error::storage());
    }
    Ok((parent, dir))
}
pub(super) fn stage(path: &std::path::Path, receipt: &Receipt) -> Result<()> {
    let root = root(path)?;
    let profiles = root
        .open_dir_nofollow("profiles")
        .map_err(|_| error::storage())?;
    let (_, wrapper) = wrapper(path, receipt, true)?;
    let original = profiles.open_dir_nofollow(&receipt.profile_id);
    let staged = wrapper.open_dir_nofollow("data");
    match (original, staged) {
        (Ok(dir), Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            if metadata(&dir, &receipt.profile_id)?.1 != receipt.meta_hash {
                return Err(error::state());
            }
            let owner = lock_owner(&dir)?;
            let held = same_file::Handle::from_file(
                dir.try_clone()
                    .map_err(|_| error::storage())?
                    .into_std_file(),
            )
            .map_err(|_| error::storage())?;
            let current = same_file::Handle::from_file(
                profiles
                    .open_dir_nofollow(&receipt.profile_id)
                    .map_err(|_| error::storage())?
                    .into_std_file(),
            )
            .map_err(|_| error::storage())?;
            if held != current {
                return Err(error::state());
            }
            if tree_hash(&dir)? != receipt.tree_hash {
                return Err(error::state());
            }
            // Windows capability handles deny delete sharing. The data-root account lock stays
            // held while these handles are released for rename. Reacquire profile ownership and
            // recheck the staged content before authorizing deletion, including after a crash.
            drop(held);
            drop(current);
            drop(dir);
            drop(owner);
            profiles
                .rename(&receipt.profile_id, &wrapper, "data")
                .map_err(|_| error::storage())?;
            let staged = wrapper
                .open_dir_nofollow("data")
                .map_err(|_| error::storage())?;
            let _staged_owner = lock_owner(&staged)?;
            if metadata(&staged, &receipt.profile_id)?.1 != receipt.meta_hash
                || tree_hash(&staged)? != receipt.tree_hash
            {
                return Err(error::state());
            }
            sync(&profiles)?;
            sync(&wrapper)?;
        }
        (Err(e), Ok(dir)) if e.kind() == std::io::ErrorKind::NotFound => {
            let _owner = lock_owner(&dir)?;
            if metadata(&dir, &receipt.profile_id)?.1 != receipt.meta_hash
                || tree_hash(&dir)? != receipt.tree_hash
            {
                return Err(error::state());
            }
        }
        _ => return Err(error::storage()),
    }
    Ok(())
}
pub(super) fn erase_files(path: &std::path::Path, receipt: &Receipt) -> Result<()> {
    let (_, wrapper) = wrapper(path, receipt, false)?;
    let dir = match wrapper.open_dir_nofollow("data") {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(error::storage()),
    };
    let owner = lock_owner(&dir)?;
    let mut budget = 100_000;
    erase(&dir, 0, &mut budget)?;
    drop(owner);
    dir.remove_file("owner.lock")
        .map_err(|_| error::storage())?;
    dir.remove_open_dir().map_err(|_| error::storage())?;
    sync(&wrapper)
}
fn erase(dir: &Dir, depth: usize, budget: &mut usize) -> Result<()> {
    if depth > 64 {
        return Err(error::storage());
    }
    for entry in dir.entries().map_err(|_| error::storage())? {
        *budget = budget.checked_sub(1).ok_or_else(error::storage)?;
        let entry = entry.map_err(|_| error::storage())?;
        if depth == 0 && entry.file_name() == "owner.lock" {
            continue;
        }
        let kind = entry.file_type().map_err(|_| error::storage())?;
        if kind.is_symlink() {
            return Err(error::storage());
        }
        if kind.is_dir() {
            let child = dir
                .open_dir_nofollow(entry.file_name())
                .map_err(|_| error::storage())?;
            erase(&child, depth + 1, budget)?;
            child.remove_open_dir().map_err(|_| error::storage())?;
        } else if kind.is_file() {
            dir.remove_file(entry.file_name())
                .map_err(|_| error::storage())?;
        } else {
            return Err(error::storage());
        }
    }
    sync(dir)
}
pub(super) fn finish(path: &std::path::Path, receipt: &Receipt) -> Result<()> {
    let root = root(path)?
        .open_dir_nofollow("profiles")
        .map_err(|_| error::storage())?;
    let parent = root
        .open_dir_nofollow(STAGING)
        .map_err(|_| error::storage())?;
    let dir = match parent.open_dir_nofollow(&receipt.token) {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(error::storage()),
    };
    // A missing marker is allowed only for this final, already-keyless phase, and only when empty.
    match dir.symlink_metadata(MARKER) {
        Ok(_) => {
            if read(&dir, MARKER, 256)? != marker(receipt) {
                return Err(error::storage());
            }
            dir.remove_file(MARKER).map_err(|_| error::storage())?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(error::storage()),
    }
    dir.remove_open_dir().map_err(|_| error::storage())?;
    sync(&parent)
}

pub(super) fn cancel_unstarted(path: &std::path::Path, receipt: &Receipt) -> Result<()> {
    let profiles = root(path)?
        .open_dir_nofollow("profiles")
        .map_err(|_| error::storage())?;
    let source = profiles
        .open_dir_nofollow(&receipt.profile_id)
        .map_err(|_| error::state())?;
    metadata(&source, &receipt.profile_id)?;
    let parent = match profiles.open_dir_nofollow(STAGING) {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(error::storage()),
    };
    let dir = match parent.open_dir_nofollow(&receipt.token) {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(error::storage()),
    };
    if !matches!(dir.symlink_metadata("data"),Err(e) if e.kind()==std::io::ErrorKind::NotFound) {
        return Err(error::state());
    }
    drop(dir);
    finish(path, receipt)
}
