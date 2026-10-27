//! Explicit copies use no-follow handles and create-only publication. Contents stay out of previews.
use super::{
    Result,
    setup::{invalid, validate_path},
};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

const FILE_LIMIT: usize = 1024 * 1024;
const TOTAL_LIMIT: usize = 16 * FILE_LIMIT;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Fingerprint {
    hash: [u8; 32],
    pub bytes: u32,
}
pub(super) type Files = BTreeMap<String, (Fingerprint, Vec<u8>)>;

fn parent(root: &Dir, path: &str, create: bool) -> Result<(Dir, String)> {
    validate_path(path)?;
    let mut dir = root.try_clone()?;
    let parts = path.split('/').collect::<Vec<_>>();
    for part in &parts[..parts.len() - 1] {
        if create {
            match dir.create_dir(part) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        dir = dir.open_dir_nofollow(part)?;
    }
    Ok((dir, parts[parts.len() - 1].into()))
}

fn normalized(root: &Path, path: &Path) -> PathBuf {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    path.canonicalize().unwrap_or_else(|_| {
        let mut result = PathBuf::new();
        for part in path.components() {
            match part {
                Component::ParentDir => {
                    result.pop();
                }
                Component::CurDir => {}
                other => result.push(other),
            }
        }
        result
    })
}

pub(super) fn collect(source: &Path, paths: &[String], protected: &[PathBuf]) -> Result<Files> {
    let source = source.canonicalize()?;
    let protected = protected
        .iter()
        .map(|path| normalized(&source, path))
        .collect::<Vec<_>>();
    let root = Dir::open_ambient_dir(&source, cap_std::ambient_authority())?;
    let mut files = BTreeMap::new();
    let mut total = 0;
    for path in paths {
        validate_path(path)?;
        if protected.iter().any(|protected| {
            source.starts_with(protected) || source.join(path).starts_with(protected)
        }) {
            return Err(invalid(
                "Agent configuration and app profile paths cannot supply setup files.",
            ));
        }
        let (dir, name) = parent(&root, path, false)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = dir.open_with(name, &options)?;
        let meta = file.metadata()?;
        if !meta.is_file() || meta.len() > FILE_LIMIT as u64 {
            return Err(invalid(
                "Setup copies require regular files no larger than 1 MiB.",
            ));
        }
        let mut bytes = Vec::new();
        file.take(FILE_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
        total += bytes.len();
        if bytes.len() > FILE_LIMIT || total > TOTAL_LIMIT {
            return Err(invalid("Setup files exceed the 16 MiB total limit."));
        }
        let fingerprint = Fingerprint {
            hash: Sha256::digest(&bytes).into(),
            bytes: bytes.len() as u32,
        };
        files.insert(path.clone(), (fingerprint, bytes));
    }
    Ok(files)
}

pub(super) fn absent(destination: &Path, paths: impl Iterator<Item = String>) -> Result<()> {
    let root = Dir::open_ambient_dir(destination, cap_std::ambient_authority())?;
    for path in paths {
        validate_path(&path)?;
        match parent(&root, &path, false) {
            Ok((dir, name)) => match dir.symlink_metadata(name) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
                Ok(_) => {
                    return Err(invalid(
                        "A setup destination already exists. Existing files are never overwritten; remove it from the recipe or review it separately.",
                    ));
                }
            },
            Err(super::GitError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// On partial failure, return exactly the already published paths. Their bytes stay available;
/// no cleanup guesses which destination files still belong to this invocation.
pub(super) fn publish(destination: &Path, files: &Files) -> (Vec<String>, Option<String>) {
    let mut copied = Vec::new();
    let result = (|| -> Result<()> {
        absent(destination, files.keys().cloned())?;
        let root = Dir::open_ambient_dir(destination, cap_std::ambient_authority())?;
        for (path, (_, bytes)) in files {
            let (dir, name) = parent(&root, path, true)?;
            let temporary = format!(".auracode-setup-{}", crate::ids::new_id());
            let mut options = OpenOptions::new();
            options
                .write(true)
                .create_new(true)
                .follow(FollowSymlinks::No);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut staged = dir.open_with(&temporary, &options)?;
            staged.write_all(bytes)?;
            staged.sync_all()?;
            drop(staged);
            // hard_link cannot replace an existing file, including a late concurrent writer.
            if let Err(error) = dir.hard_link(&temporary, &dir, &name) {
                let _ = dir.remove_file(&temporary);
                return Err(error.into());
            }
            copied.push(path.clone());
            dir.remove_file(temporary)?;
            #[cfg(unix)]
            dir.try_clone()?.into_std_file().sync_all()?;
        }
        Ok(())
    })();
    let warning=result.err().map(|error|format!("Setup stopped: {error}. Already copied files remain in the worktree. No command was started. Review them before preparing setup again."));
    (copied, warning)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_env_copy_is_create_only_and_provider_roots_are_never_read() {
        let source = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join(".env"), "FAKE_FIXTURE=1").unwrap();
        let paths = vec![".env".into()];
        let files = collect(source.path(), &paths, &[]).unwrap();
        assert!(collect(source.path(), &paths, &[source.path().to_path_buf()]).is_err());
        let result = publish(dest.path(), &files);
        assert_eq!(result.0, paths);
        assert!(result.1.is_none());
        std::fs::write(dest.path().join(".env"), "later edit").unwrap();
        assert!(publish(dest.path(), &files).1.is_some());
        assert_eq!(
            std::fs::read(dest.path().join(".env")).unwrap(),
            b"later edit"
        );
    }
}
