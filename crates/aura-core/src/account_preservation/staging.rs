use super::{PreservationError, Result};
use crate::{
    paths::DataRoot,
    profile::{Profile, ProfileKind, ProfileMeta},
};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use std::io::Write;

pub(super) struct Stage {
    pub profile: Profile,
    directory: cap_std::fs::Dir,
    _owner: crate::owner::ProfileOwner,
}
impl Stage {
    pub fn new(root: DataRoot) -> Result<Self> {
        root.ensure().map_err(|_| PreservationError::Storage)?;
        let parent =
            cap_std::fs::Dir::open_ambient_dir(root.profiles_dir(), cap_std::ambient_authority())
                .map_err(|_| PreservationError::Storage)?;
        let id = crate::ids::new_id();
        parent
            .create_dir(&id)
            .map_err(|_| PreservationError::Storage)?;
        let profile = Profile {
            dir: root
                .profile_dir(&id)
                .map_err(|_| PreservationError::Storage)?,
            meta: ProfileMeta {
                id: id.clone(),
                kind: ProfileKind::Local,
                display_name: "Kept Local workspace".into(),
                created_at: crate::time::now_millis(),
            },
        };
        crate::fsutil::restrict_to_owner(&profile.dir);
        #[cfg(windows)]
        if !crate::fsutil::is_owner_only(&profile.dir).map_err(|_| PreservationError::Storage)? {
            return Err(PreservationError::Storage);
        }
        let directory = parent
            .open_dir_nofollow(&id)
            .map_err(|_| PreservationError::Storage)?;
        for folder in ["attachments", "checkpoints", "logs", "backups"] {
            directory
                .create_dir(folder)
                .map_err(|_| PreservationError::Storage)?;
        }
        let owner = crate::owner::ProfileOwner::acquire(&profile)
            .map_err(|_| PreservationError::Storage)?;
        let stage = Self {
            profile,
            directory,
            _owner: owner,
        };
        stage.write_new("keep-local-incomplete.json", b"{\"version\":1,\"notice\":\"Explicit unencrypted Local copy. Incomplete copies are retained and never activated automatically.\"}")?;
        Ok(stage)
    }
    fn write_new(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = self
            .directory
            .open_with(name, &options)
            .map_err(|_| PreservationError::Storage)?;
        file.write_all(bytes)
            .map_err(|_| PreservationError::Storage)?;
        file.sync_all().map_err(|_| PreservationError::Storage)
    }
    pub fn publish(&mut self) -> Result<()> {
        let mut options = cap_std::fs::OpenOptions::new();
        options.read(true).write(true).follow(FollowSymlinks::No);
        self.directory
            .open_with("aura.db", &options)
            .and_then(|file| file.sync_all())
            .map_err(|_| PreservationError::Storage)?;
        let bytes =
            serde_json::to_vec(&self.profile.meta).map_err(|_| PreservationError::Storage)?;
        self.write_new("profile.prepared.json", &bytes)?;
        // Atomic no-replace publication. list() ignores a partial copy without profile.json.
        self.directory
            .hard_link("profile.prepared.json", &self.directory, "profile.json")
            .map_err(|_| PreservationError::Storage)?;
        #[cfg(unix)]
        self.directory
            .try_clone()
            .map_err(|_| PreservationError::Storage)?
            .into_std_file()
            .sync_all()
            .map_err(|_| PreservationError::Storage)?;
        let _ = self.directory.remove_file("profile.prepared.json");
        let _ = self.directory.remove_file("keep-local-incomplete.json");
        Ok(())
    }
    pub fn write_attachment(&self, hash: &str, bytes: &[u8]) -> Result<()> {
        if !crate::chatstore::blobs::is_sha256(hash) {
            return Err(PreservationError::Storage);
        }
        let directory = self
            .directory
            .open_dir_nofollow("attachments")
            .map_err(|_| PreservationError::Storage)?;
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = directory
            .open_with(hash, &options)
            .map_err(|_| PreservationError::Storage)?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| PreservationError::Storage)?;
        #[cfg(unix)]
        directory
            .into_std_file()
            .sync_all()
            .map_err(|_| PreservationError::Storage)?;
        Ok(())
    }
}
