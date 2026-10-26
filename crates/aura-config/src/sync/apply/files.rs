use std::io::Write;

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};

use super::receipt::{Mutation, Receipt};
use crate::{
    Error, Result, safe_fs,
    sync::{ConfigFile, ConfigFormat},
};

pub(super) fn read(root: &Dir, path: &str) -> Result<Option<ConfigFile>> {
    Ok(safe_fs::read_file(root, path)?.map(|file| ConfigFile {
        bytes: file.bytes,
        executable: file.executable,
    }))
}

pub(super) fn identity(root: &Dir) -> Result<same_file::Handle> {
    same_file::Handle::from_file(root.try_clone()?.into_std_file()).map_err(Into::into)
}

fn sync(dir: &Dir) -> Result<()> {
    #[cfg(unix)]
    dir.try_clone()?.into_std_file().sync_all()?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

fn mkdir(root: &Dir, path: &str) -> Result<Dir> {
    safe_fs::validate(path)?;
    let mut dir = root.try_clone()?;
    for part in path.split('/') {
        match dir.create_dir(part) {
            Ok(()) => sync(&dir)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        dir = dir.open_dir_nofollow(part).map_err(|_| Error::UnsafePath)?;
    }
    Ok(dir)
}

fn parent(root: &Dir, path: &str) -> Result<(Dir, String)> {
    safe_fs::validate(path)?;
    match path.rsplit_once('/') {
        Some((prefix, name)) => Ok((mkdir(root, prefix)?, name.into())),
        None => Ok((root.try_clone()?, path.into())),
    }
}

fn same_parent(root: &Dir, path: &str, held: &Dir) -> Result<()> {
    let (current, _) = safe_fs::parent(root, path)?;
    if identity(&current)? != identity(held)? {
        return Err(Error::Stale);
    }
    Ok(())
}

pub(super) fn stage_name(receipt: &Receipt) -> String {
    format!(".auracode-apply-{}", receipt.id)
}

pub(super) fn create_stage(root: &Dir, receipt: &Receipt) -> Result<Dir> {
    let name = stage_name(receipt);
    let mut options = cap_std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use cap_std::fs::DirBuilderExt;
        options.mode(0o700);
    }
    #[cfg(not(unix))]
    let _ = &mut options;
    root.create_dir_with(&name, &options)?;
    sync(root)?;
    root.open_dir_nofollow(name).map_err(Into::into)
}

pub(super) fn stage(root: &Dir, name: &str, file: &ConfigFile) -> Result<()> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(if file.executable { 0o700 } else { 0o600 });
    }
    let mut output = root.open_with(name, &options)?;
    output.write_all(&file.bytes)?;
    output.sync_all()?;
    sync(root)
}

pub(super) fn mutate(root: &Dir, stage: &Dir, index: usize, mutation: &Mutation) -> Result<()> {
    let (parent, name) = parent(root, &mutation.path)?;
    same_parent(root, &mutation.path, &parent)?;
    if read(&parent, &name)? != mutation.before {
        return Err(Error::Stale);
    }
    let old = format!("before-{index}");
    let new = format!("after-{index}");
    if let Some(after) = &mutation.after {
        self::stage(stage, &new, after)?;
    }
    if mutation.before.is_some() {
        parent.rename(&name, stage, &old)?;
        sync(&parent)?;
        sync(stage)?;
        if read(stage, &old)? != mutation.before {
            // No overwrite: an editor that recreated the original path keeps its new file.
            let _ = stage.hard_link(&old, &parent, &name);
            return Err(Error::Stale);
        }
    }
    same_parent(root, &mutation.path, &parent)?;
    if mutation.after.is_some()
        && let Err(error) = stage.hard_link(&new, &parent, &name)
    {
        if mutation.before.is_some() {
            let _ = stage.hard_link(&old, &parent, &name);
        }
        return Err(error.into());
    }
    sync(&parent)?;
    same_parent(root, &mutation.path, &parent)?;
    if read(root, &mutation.path)? != mutation.after {
        return Err(Error::Stale);
    }
    Ok(())
}

/// Recovery only removes publication files whose bytes and executable flag still match the
/// encrypted receipt. A changed original held by another editor is retained for manual recovery.
pub(super) fn cleanup(root: &Dir, receipt: &Receipt, restore_missing: bool) -> Result<()> {
    let name = stage_name(receipt);
    let stage = match root.open_dir_nofollow(&name) {
        Ok(stage) => stage,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    // Validate the entire directory before removing any evidence.
    for entry in stage.entries()? {
        let name = entry?
            .file_name()
            .into_string()
            .map_err(|_| Error::UnsafePath)?;
        let (kind, index) = name.split_once('-').ok_or(Error::Format)?;
        let index: usize = index.parse().map_err(|_| Error::Format)?;
        let mutation = receipt.files.get(index).ok_or(Error::Format)?;
        let expected = match kind {
            "before" => &mutation.before,
            "after" => &mutation.after,
            _ => return Err(Error::Format),
        };
        if expected.is_none() || read(&stage, &name)? != *expected {
            return Err(Error::Stale);
        }
    }
    for (index, mutation) in receipt.files.iter().enumerate() {
        let old = format!("before-{index}");
        if restore_missing && read(root, &mutation.path)?.is_none() && read(&stage, &old)?.is_some()
        {
            let (parent, name) = parent(root, &mutation.path)?;
            stage.hard_link(&old, &parent, &name)?;
            sync(&parent)?;
        }
    }
    for entry in stage.entries()? {
        stage.remove_file(entry?.file_name())?;
    }
    sync(&stage)?;
    drop(stage);
    root.remove_dir(name)?;
    sync(root)
}

pub(super) fn prune(root: &Dir, receipt: &Receipt) -> Result<()> {
    if receipt.identity.format != ConfigFormat::Tree {
        return Ok(());
    }
    let mut paths = std::collections::BTreeSet::new();
    for mutation in &receipt.files {
        if mutation.after.is_some() {
            continue;
        }
        let mut path = mutation.path.as_str();
        while let Some((parent, _)) = path.rsplit_once('/') {
            if parent.len() < receipt.identity.path.len() {
                break;
            }
            paths.insert(parent.to_owned());
            path = parent;
        }
    }
    for path in paths.into_iter().rev() {
        let (parent, name) = safe_fs::parent(root, &path)?;
        match parent.remove_dir(name) {
            Ok(()) => sync(&parent)?,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
