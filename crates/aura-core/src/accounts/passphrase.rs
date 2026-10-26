//! Explicit selection of an app-owned fallback. The directory's presence is a fail-closed choice:
//! startup never silently returns to OS storage after a partial creation or a missing password.
use super::{Accounts, Result, error, index};
use aura_protocol::account::AccountFailureCode;
use aura_sync::vault::{PassphraseDirectory, SecretStore};
use cap_fs_ext::DirExt;
use cap_std::fs::Dir;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use zeroize::Zeroizing;

const DIRECTORY: &str = "account-passphrase-vault";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    Missing,
    Empty,
    Existing,
}
pub fn inspect(root: &Path) -> Result<Presence> {
    let root =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| error::storage())?;
    match root.symlink_metadata(DIRECTORY) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            let directory = root
                .open_dir_nofollow(DIRECTORY)
                .map_err(|_| error::storage())?;
            let mut entries = directory.entries().map_err(|_| error::storage())?;
            match entries.next() {
                Some(Ok(_)) => Ok(Presence::Existing),
                Some(Err(_)) => Err(error::storage()),
                None => Ok(Presence::Empty),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Presence::Missing),
        _ => Err(error::failure(
            AccountFailureCode::SecureStorage,
            "The selected passphrase store is unavailable or is not a private app directory. Its contents were preserved.",
        )),
    }
}
fn location(root: &Path, origin: &str, create: bool) -> Result<(PathBuf, String)> {
    let canonical = root.canonicalize().map_err(|_| error::storage())?;
    match (inspect(&canonical)?, create) {
        (Presence::Missing, true) => {
            let dir = Dir::open_ambient_dir(&canonical, cap_std::ambient_authority())
                .map_err(|_| error::storage())?;
            let mut builder = cap_std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use cap_std::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            // Keep the builder mutable on every supported target without changing global ACLs.
            builder.recursive(false);
            dir.create_dir_with(DIRECTORY, &builder)
                .map_err(|_| error::storage())?;
        }
        (Presence::Empty, true) | (Presence::Existing, false) => {}
        _ => {
            return Err(error::failure(
                AccountFailureCode::SecureStorage,
                "Create a new passphrase store only in its empty app directory, or unlock the existing store. Existing ciphertext is never replaced.",
            ));
        }
    }
    let scope = serde_json::to_string(&(
        origin,
        format!(
            "{:x}",
            Sha256::digest(canonical.as_os_str().as_encoded_bytes())
        ),
    ))
    .map_err(|_| error::storage())?;
    Ok((canonical.join(DIRECTORY), scope))
}
pub fn open(
    root: &Path,
    origin: &str,
    passphrase: Zeroizing<String>,
    create: bool,
) -> Result<Arc<dyn SecretStore>> {
    // Used only before Accounts is open. An existing Accounts service holds this same lock and
    // provides its own method for preparing a choice that takes effect after restart.
    let _owner = index::acquire(root)?;
    open_owned(root, origin, passphrase, create)
}
fn open_owned(
    root: &Path,
    origin: &str,
    passphrase: Zeroizing<String>,
    create: bool,
) -> Result<Arc<dyn SecretStore>> {
    let (path, scope) = location(root, origin, create)?;
    let vault = if create {
        PassphraseDirectory::create(&path, &scope, passphrase)
    } else {
        PassphraseDirectory::open(&path, &scope, passphrase)
    }
    .map_err(error::vault)?;
    Ok(Arc::new(vault))
}
impl Accounts {
    /// Prepare only while the existing runtime remains selected. It must not swap live services;
    /// the desktop reports restart required and leaves all native credentials untouched.
    pub fn prepare_passphrase_store(&self, passphrase: Zeroizing<String>) -> Result<()> {
        let _vault = open_owned(
            self.profiles.root().root(),
            self.api.origin(),
            passphrase,
            true,
        )?;
        Ok(())
    }
}
