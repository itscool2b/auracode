//! Account-only encrypted object storage. All IO after root selection is directory-relative and
//! refuses final-component links. Publication never replaces an existing immutable object.
use aura_sync::crypto::files::{self, ProfileFileKey, Purpose, Reader};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{self, Read, Write},
    path::Path,
    sync::Arc,
};

const MARKER: &str = ".auracode-encrypted";
#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Marker {
    version: u8,
    key_check: String,
}

#[derive(Clone)]
pub struct EncryptedFiles {
    dir: Arc<Dir>,
    key: Arc<ProfileFileKey>,
    purpose: Purpose,
}
impl std::fmt::Debug for EncryptedFiles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptedFiles")
            .field("purpose", &self.purpose)
            .finish_non_exhaustive()
    }
}
impl aura_drivers::attachments::AttachmentReader for EncryptedFiles {
    fn read(&self, hash: &str, limit: usize) -> Result<Vec<u8>, String> {
        if self.purpose != Purpose::Attachment {
            return Err("This file store cannot supply attachments.".into());
        }
        self.read(hash, limit).map_err(|_| "The encrypted attachment could not be read or verified. Attach the original file again.".into())
    }
}
impl EncryptedFiles {
    /// Select only an auracode-owned private profile directory while holding its ownership guard.
    /// Existing plaintext files or another key's marker are preserved and require explicit import.
    pub fn open(path: &Path, purpose: Purpose, key: Arc<ProfileFileKey>) -> io::Result<Self> {
        crate::fsutil::create_private_dir_all(path).map_err(io::Error::other)?;
        let dir = Arc::new(Dir::open_ambient_dir(path, cap_std::ambient_authority())?);
        Self::open_directory(dir, purpose, key)
    }
    fn open_directory(
        dir: Arc<Dir>,
        purpose: Purpose,
        key: Arc<ProfileFileKey>,
    ) -> io::Result<Self> {
        let store = Self { dir, key, purpose };
        let expected = Marker {
            version: 1,
            key_check: store
                .key
                .object_name(purpose, "storage-format")
                .map_err(io::Error::other)?,
        };
        match store.open_regular(MARKER) {
            Ok(file) => {
                if file.metadata()?.len() > 256 {
                    return Err(invalid("The encrypted file directory marker is invalid."));
                }
                let mut bytes = Vec::new();
                file.take(257).read_to_end(&mut bytes)?;
                let found: Marker = serde_json::from_slice(&bytes)
                    .map_err(|_| invalid("The encrypted file directory marker is invalid."))?;
                if found != expected {
                    return Err(invalid(
                        "The file directory belongs to another key or encryption format.",
                    ));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if store.dir.entries()?.next().is_some() {
                    return Err(invalid(
                        "Existing profile files need an explicit encrypted import. Nothing was changed.",
                    ));
                }
                let bytes = serde_json::to_vec(&expected).map_err(io::Error::other)?;
                store.publish(MARKER, |file| file.write_all(&bytes))?;
            }
            Err(error) => return Err(error),
        }
        Ok(store)
    }
    /// An independently discoverable recovery group. The UUID contains no message or account data.
    /// Callers also bind it into every child object ID, preventing cross-journal substitution.
    pub(crate) fn child(&self, id: &str, create: bool) -> io::Result<Self> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| invalid("Invalid recovery group."))?;
        if uuid.to_string() != id {
            return Err(invalid("Invalid recovery group."));
        }
        if create {
            let builder = cap_std::fs::DirBuilder::new();
            #[cfg(unix)]
            let builder = {
                use cap_std::fs::DirBuilderExt;
                let mut builder = builder;
                builder.mode(0o700);
                builder
            };
            self.dir.create_dir_with(id, &builder)?;
            self.sync_directory()?;
        }
        Self::open_directory(
            Arc::new(self.dir.open_dir_nofollow(id)?),
            self.purpose,
            self.key.clone(),
        )
    }
    pub fn reader(&self, id: &str) -> io::Result<Reader<'_, File>> {
        let name = self.name(id)?;
        Reader::new(&self.key, self.purpose, id, self.open_regular(&name)?)
            .map_err(io::Error::other)
    }
    pub fn read(&self, id: &str, limit: usize) -> io::Result<Vec<u8>> {
        let mut reader = self.reader(id)?;
        if reader.total() > limit as u64 {
            return Err(invalid("The encrypted file exceeds the read limit."));
        }
        // The caller needs an owned payload for the vendor wire. Intermediate plaintext is zeroized.
        Ok(reader.read_all().map_err(io::Error::other)?.to_vec())
    }
    /// Idempotent only when every existing plaintext byte matches. Damaged ciphertext or a reused
    /// object ID never counts as success and is never silently overwritten.
    pub fn write(&self, id: &str, plain: &[u8]) -> io::Result<u64> {
        if plain.len() > files::MAX_FILE {
            return Err(invalid("The profile file exceeds its size limit."));
        }
        match self.matches(id, plain) {
            Ok(true) => return Ok(plain.len() as u64),
            Ok(false) => {
                return Err(invalid(
                    "The existing encrypted object has different contents.",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let name = self.name(id)?;
        match self.publish(&name, |file| {
            files::seal(&self.key, self.purpose, id, plain, file).map_err(io::Error::other)
        }) {
            Ok(()) => {}
            Err(error)
                if error.kind() == io::ErrorKind::AlreadyExists && self.matches(id, plain)? => {}
            Err(error) => return Err(error),
        }
        Ok(plain.len() as u64)
    }
    fn matches(&self, id: &str, plain: &[u8]) -> io::Result<bool> {
        let mut reader = self.reader(id)?;
        if reader.total() != plain.len() as u64 {
            return Ok(false);
        }
        let mut offset = 0;
        while offset < plain.len() {
            let page = reader
                .range(offset as u64, files::MAX_PAGE)
                .map_err(io::Error::other)?;
            if page.bytes.as_slice() != &plain[offset..offset + page.bytes.len()] {
                return Ok(false);
            }
            offset += page.bytes.len();
        }
        Ok(true)
    }
    fn name(&self, id: &str) -> io::Result<String> {
        self.key
            .object_name(self.purpose, id)
            .map_err(io::Error::other)
    }
    fn open_regular(&self, name: &str) -> io::Result<File> {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = self.dir.open_with(name, &options)?.into_std();
        if !file.metadata()?.is_file() {
            return Err(invalid("The encrypted object is not a regular file."));
        }
        Ok(file)
    }
    fn publish(
        &self,
        name: &str,
        write: impl FnOnce(&mut File) -> io::Result<()>,
    ) -> io::Result<()> {
        let temporary = format!(".{}.partial", crate::ids::new_id());
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
        let mut file = self.dir.open_with(&temporary, &options)?.into_std();
        let result = (|| {
            write(&mut file)?;
            file.sync_all()?;
            drop(file);
            // Hard-link publication is atomic and fails if the final name already exists. A
            // filesystem without this primitive fails visibly instead of replacing prior data.
            self.dir.hard_link(&temporary, &self.dir, name)?;
            self.sync_directory()
        })();
        let removed = self.dir.remove_file(&temporary);
        if result.is_ok() {
            removed?;
            self.sync_directory()?;
        }
        result
    }
    fn sync_directory(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.dir.try_clone()?.into_std_file().sync_all()?;
        }
        Ok(())
    }
}
fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_sync::crypto::AccountKey;
    fn key() -> Arc<ProfileFileKey> {
        Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        )
    }
    #[test]
    fn files_are_ciphertext_only_and_reopen_with_the_matching_key() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("files");
        let key = key();
        let files = EncryptedFiles::open(&dir, Purpose::Attachment, key.clone()).unwrap();
        let text = b"private synthetic file contents";
        files.write("content_hash", text).unwrap();
        files.write("content_hash", text).unwrap();
        assert_eq!(files.read("content_hash", 1024).unwrap(), text);
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 2);
        assert!(!names.iter().any(|s| s.contains("content_hash")));
        for name in names {
            let bytes = std::fs::read(dir.join(name)).unwrap();
            assert!(!bytes.windows(text.len()).any(|p| p == text));
        }
        drop(files);
        let reopened = EncryptedFiles::open(&dir, Purpose::Attachment, key).unwrap();
        assert_eq!(reopened.read("content_hash", 1024).unwrap(), text);
        assert!(reopened.read("content_hash", 1).is_err());
    }
    #[test]
    fn wrong_keys_legacy_files_and_reused_ids_preserve_original_data() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("files");
        let files = EncryptedFiles::open(&dir, Purpose::Attachment, key()).unwrap();
        files.write("id", b"original").unwrap();
        assert!(files.write("id", b"replaced").is_err());
        assert_eq!(files.read("id", 30).unwrap(), b"original");
        assert!(EncryptedFiles::open(&dir, Purpose::Attachment, key()).is_err());
        let legacy = temp.path().join("legacy");
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("existing"), b"local data").unwrap();
        assert!(EncryptedFiles::open(&legacy, Purpose::Attachment, key()).is_err());
        assert_eq!(
            std::fs::read(legacy.join("existing")).unwrap(),
            b"local data"
        );
        assert!(!legacy.join(MARKER).exists());
    }
    #[test]
    fn failed_publication_and_corrupt_existing_ciphertext_never_claim_success() {
        let temp = tempfile::tempdir().unwrap();
        let key = key();
        let files = EncryptedFiles::open(temp.path(), Purpose::DeadLetter, key.clone()).unwrap();
        assert!(
            files
                .publish("unused.enc", |file| {
                    file.write_all(b"ciphertext prefix")?;
                    Err(io::Error::other("synthetic disk failure"))
                })
                .is_err()
        );
        assert!(!temp.path().join("unused.enc").exists());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
        files.write("record", b"retained").unwrap();
        let path = temp
            .path()
            .join(key.object_name(Purpose::DeadLetter, "record").unwrap());
        let mut bytes = std::fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        std::fs::write(&path, &bytes).unwrap();
        assert!(files.write("record", b"retained").is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
