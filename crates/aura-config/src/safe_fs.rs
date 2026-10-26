use std::{
    io::Read,
    path::{Component, Path},
};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};

use crate::{Error, Result};

pub(crate) const FILE_LIMIT: usize = 1024 * 1024;
pub(crate) const TREE_LIMIT: usize = 16 * 1024 * 1024;
pub(crate) const FILE_COUNT: usize = 256;
pub(crate) const ITEM_COUNT: usize = 2048;

pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn validate(path: &str) -> Result<()> {
    if path.is_empty()
        || path.len() > 1024
        || path.contains(['\\', ':', '\0'])
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path
            .split('/')
            .any(|part| part.is_empty() || part.ends_with([' ', '.']) || excluded(part))
    {
        return Err(Error::UnsafePath);
    }
    Ok(())
}

fn excluded(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        "auth.json"
            | "credentials.json"
            | ".credentials.json"
            | "sessions"
            | "cache"
            | "synced"
            | ".git"
            | "node_modules"
            | ".env"
            | "id_rsa"
            | "id_ed25519"
    ) || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.split('.').next().is_some_and(|stem| {
            matches!(
                stem,
                "con"
                    | "prn"
                    | "aux"
                    | "nul"
                    | "com1"
                    | "com2"
                    | "com3"
                    | "com4"
                    | "com5"
                    | "com6"
                    | "com7"
                    | "com8"
                    | "com9"
                    | "lpt1"
                    | "lpt2"
                    | "lpt3"
                    | "lpt4"
                    | "lpt5"
                    | "lpt6"
                    | "lpt7"
                    | "lpt8"
                    | "lpt9"
            )
        })
}

pub(crate) fn parent(root: &Dir, path: &str) -> Result<(Dir, String)> {
    validate(path)?;
    let mut directory = root.try_clone()?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            return Ok((directory, part.to_owned()));
        }
        directory = directory
            .open_dir_nofollow(part)
            .map_err(|_| Error::UnsafePath)?;
    }
    Err(Error::UnsafePath)
}

pub(crate) fn read(root: &Dir, path: &str) -> Result<Option<Vec<u8>>> {
    validate(path)?;
    // A missing path is ordinary. Every subsequent open is capability-relative and refuses links.
    match root.symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::Io),
        Ok(_) => {}
    }
    let (directory, name) = parent(root, path)?;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = directory
        .open_with(name, &options)
        .map_err(|_| Error::UnsafePath)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(Error::UnsafePath);
    }
    if metadata.len() > FILE_LIMIT as u64 {
        return Err(Error::Limit);
    }
    let mut bytes = Vec::new();
    file.take(FILE_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > FILE_LIMIT {
        return Err(Error::Limit);
    }
    Ok(Some(bytes))
}

pub(crate) fn directory(root: &Dir, path: &str) -> Result<Dir> {
    if path.is_empty() {
        return Ok(root.try_clone()?);
    }
    validate(path)?;
    let mut directory = root.try_clone()?;
    for component in path.split('/') {
        directory = directory
            .open_dir_nofollow(component)
            .map_err(|_| Error::UnsafePath)?;
    }
    Ok(directory)
}

pub(crate) fn children(root: &Dir, path: &str) -> Result<Vec<String>> {
    let directory = directory(root, path)?;
    let mut names = Vec::new();
    for entry in directory.entries()? {
        if names.len() == ITEM_COUNT {
            return Err(Error::Limit);
        }
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate(&name).is_ok() {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

pub(crate) fn tree(root: &Dir, path: &str) -> Result<Vec<(String, Vec<u8>)>> {
    fn walk(
        dir: &Dir,
        prefix: &str,
        depth: usize,
        total: &mut usize,
        files: &mut Vec<(String, Vec<u8>)>,
    ) -> Result<()> {
        if depth > 8 {
            return Err(Error::Limit);
        }
        for entry in dir.entries()? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| Error::UnsafePath)?;
            // Unlike listing, copying a bundle never silently skips an unsafe dependency.
            validate(&name)?;
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let metadata = dir.symlink_metadata(&name)?;
            if metadata.is_dir() {
                walk(
                    &dir.open_dir_nofollow(&name)
                        .map_err(|_| Error::UnsafePath)?,
                    &path,
                    depth + 1,
                    total,
                    files,
                )?;
            } else {
                if files.len() == FILE_COUNT {
                    return Err(Error::Limit);
                }
                let bytes = read(dir, &name)?.ok_or(Error::Stale)?;
                *total += bytes.len();
                if *total > TREE_LIMIT {
                    return Err(Error::Limit);
                }
                files.push((path, bytes));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(&directory(root, path)?, "", 0, &mut 0, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

pub(crate) fn tree_hash(files: &[(String, Vec<u8>)]) -> String {
    let mut digest = Sha256::new();
    for (path, bytes) in files {
        digest.update((path.len() as u64).to_le_bytes());
        digest.update(path);
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}
