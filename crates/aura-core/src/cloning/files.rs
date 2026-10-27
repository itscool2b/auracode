use super::*;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::OpenOptions;
use std::{
    io::{Read, Write},
    path::Path,
};

pub(super) struct Destination {
    pub(super) prepared: Prepared,
    pub(super) directory: Dir,
    pub(super) journal: Dir,
}

pub(super) fn absent(parent: &Dir, name: &str) -> Result<()> {
    match parent.symlink_metadata(name) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(_) => Err(CloneError::message(
            "The destination already exists. Choose another new folder name; its contents were left unchanged.",
        )),
    }
}

pub(super) fn matches(directory: &Dir, path: &Path) -> Result<()> {
    let retained = same_file::Handle::from_file(directory.try_clone()?.into_std_file())?;
    let current = same_file::Handle::from_file(
        Dir::open_ambient_dir(path, cap_std::ambient_authority())?.into_std_file(),
    )?;
    if retained != current {
        return Err(CloneError::message(
            "The chosen folder was moved or replaced. Review the clone again.",
        ));
    }
    Ok(())
}

pub(super) fn begin(prepared: Prepared, record: &CloneRecord) -> Result<Destination> {
    matches(&prepared.parent_handle, &prepared.parent)?;
    absent(&prepared.parent_handle, &prepared.name)?;
    let name = format!(".auracode-clone-{}", record.id);
    prepared.parent_handle.create_dir(&name)?;
    let journal = prepared.parent_handle.open_dir_nofollow(&name)?;
    write(&journal, "started.json", record)?;
    journal.create_dir("empty-hooks")?;
    journal.create_dir("empty-template")?;
    write_bytes(&journal, "empty-config", &[])?;
    // Atomic create refuses even an independently created empty destination. Nothing is removed.
    prepared.parent_handle.create_dir(&prepared.name)?;
    let directory = prepared.parent_handle.open_dir_nofollow(&prepared.name)?;
    sync_directory(&prepared.parent_handle)?;
    Ok(Destination {
        prepared,
        directory,
        journal,
    })
}

pub(super) fn finish(destination: Destination, record: &CloneRecord) -> Result<()> {
    write(&destination.journal, "finished.json", record)
}

fn write(directory: &Dir, name: &str, record: &CloneRecord) -> Result<()> {
    let bytes = serde_json::to_vec(record)
        .map_err(|_| CloneError::message("The clone recovery record could not be encoded."))?;
    write_bytes(directory, name, &bytes)
}
fn write_bytes(directory: &Dir, name: &str, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No)
        .sync(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = directory.open_with(name, &options)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync_directory(directory)
}
fn sync_directory(directory: &Dir) -> Result<()> {
    #[cfg(unix)]
    directory.try_clone()?.into_std_file().sync_all()?;
    #[cfg(not(unix))]
    let _ = directory;
    Ok(())
}
fn read(directory: &Dir, name: &str) -> Result<Option<CloneRecord>> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No).nonblock(true);
    let file = match directory.open_with(name, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let meta = file.metadata()?;
    if !meta.is_file() || meta.len() > 16 * 1024 {
        return Err(CloneError::message(
            "A clone recovery record has an unsupported size or file type. It was retained.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(16 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 16 * 1024 {
        return Err(CloneError::message(
            "A clone recovery record grew beyond its limit.",
        ));
    }
    let record = serde_json::from_slice(&bytes).map_err(|_| CloneError::message("A clone recovery record is incomplete or damaged. Inspect its retained folder before retrying."))?;
    Ok(Some(record))
}

pub(super) fn history(parent: &Path) -> Result<Vec<CloneRecord>> {
    if !parent.is_absolute() {
        return Err(CloneError::message("Choose an absolute parent folder."));
    }
    let parent = std::fs::canonicalize(parent)?;
    let directory = Dir::open_ambient_dir(&parent, cap_std::ambient_authority())?;
    let mut records = Vec::new();
    for (index, entry) in directory.entries()?.enumerate() {
        if index >= 8192 {
            return Err(CloneError::message(
                "This parent has too many entries to inspect safely. Choose a smaller project parent.",
            ));
        }
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name.strip_prefix(".auracode-clone-") else {
            continue;
        };
        if uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        if records.len() >= 128 {
            return Err(CloneError::message(
                "This parent has too many retained clone records. Review the existing .auracode-clone folders before starting another clone.",
            ));
        }
        let journal = directory.open_dir_nofollow(name)?;
        let Some(mut record) = read(&journal, "started.json")? else {
            continue;
        };
        let target = Path::new(&record.destination);
        let filename = target
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| CloneError::message("A clone recovery path is invalid."))?;
        validate::name(filename)?;
        if record.id != id
            || Path::new(&record.parent) != parent
            || target != parent.join(filename)
            || Path::new(&record.journal) != parent.join(name)
            || validate::remote(&record.remote)? != record.remote
        {
            return Err(CloneError::message(
                "A clone recovery record does not match its parent. It was retained.",
            ));
        }
        match read(&journal, "finished.json")? {
            Some(finished)
                if finished.id == record.id
                    && finished.remote == record.remote
                    && finished.destination == record.destination
                    && finished.parent == record.parent
                    && finished.journal == record.journal =>
            {
                record = finished
            }
            Some(_) => {
                return Err(CloneError::message(
                    "A clone outcome does not match its ownership record.",
                ));
            }
            None => {
                record.state = CloneState::Interrupted;
                record.detail = "The prior clone did not record completion. Its folder is retained; inspect it before retrying into a new folder.".into();
            }
        }
        records.push(record);
    }
    records.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prepared(temp: &Path) -> (Prepared, CloneRecord) {
        let parent = std::fs::canonicalize(temp).unwrap();
        let env = Arc::new(ResolvedEnv {
            vars: Default::default(),
            source: aura_process::EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        });
        let id = uuid::Uuid::now_v7().to_string();
        let view = CloneReview {
            id: id.clone(),
            remote: "https://github.com/owner/repo.git".into(),
            parent: parent.to_string_lossy().into(),
            destination: parent.join("repo").to_string_lossy().into(),
            notices: vec![],
        };
        let record = CloneRecord {
            id: id.clone(),
            remote: view.remote.clone(),
            parent: view.parent.clone(),
            destination: view.destination.clone(),
            journal: parent
                .join(format!(".auracode-clone-{id}"))
                .to_string_lossy()
                .into(),
            state: CloneState::Running,
            detail: "test".into(),
        };
        (
            Prepared {
                view,
                parent_handle: Dir::open_ambient_dir(&parent, cap_std::ambient_authority())
                    .unwrap(),
                parent,
                name: "repo".into(),
                program: PathBuf::new(),
                env,
                expires: Instant::now() + Duration::from_secs(600),
            },
            record,
        )
    }
    #[test]
    fn existing_empty_or_nonempty_targets_are_never_reused() {
        let temp = tempfile::tempdir().unwrap();
        let (prepared, record) = prepared(temp.path());
        std::fs::create_dir(temp.path().join("repo")).unwrap();
        assert!(begin(prepared, &record).is_err());
        std::fs::write(temp.path().join("repo/user.txt"), "preserve").unwrap();
        assert_eq!(
            std::fs::read(temp.path().join("repo/user.txt")).unwrap(),
            b"preserve"
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }
    #[test]
    fn interrupted_and_canceled_work_remains_discoverable_without_deleting_files() {
        let temp = tempfile::tempdir().unwrap();
        let (prepared, mut record) = prepared(temp.path());
        let destination = begin(prepared, &record).unwrap();
        destination
            .directory
            .write("partial.txt", "preserve")
            .unwrap();
        assert_eq!(
            history(temp.path()).unwrap()[0].state,
            CloneState::Interrupted
        );
        record.state = CloneState::Canceled;
        record.detail = "Canceled. Partial files retained.".into();
        finish(destination, &record).unwrap();
        assert_eq!(history(temp.path()).unwrap(), vec![record]);
        assert_eq!(
            std::fs::read(temp.path().join("repo/partial.txt")).unwrap(),
            b"preserve"
        );
    }
}
