//! Encrypted recovery JSONL. Stream serialization into bounded immutable parts, then publish the
//! manifest last. A crash preserves authenticated parts; no plaintext recovery file is created.
use crate::profile_files::EncryptedFiles;
use std::io::{self, Write};

const CHUNK: usize = 64 * 1024;
const MAX_PARTS: u32 = 8192;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Manifest {
    pub version: u8,
    pub parts: u32,
    pub bytes: u64,
}

pub(crate) struct Journal {
    files: EncryptedFiles,
    id: String,
    buffer: Vec<u8>,
    parts: u32,
    bytes: u64,
}
impl Journal {
    pub(crate) fn new(root: &EncryptedFiles) -> io::Result<Self> {
        let id = crate::ids::new_id();
        Ok(Self {
            files: root.child(&id, true)?,
            id,
            buffer: Vec::with_capacity(CHUNK),
            parts: 0,
            bytes: 0,
        })
    }
    fn publish_part(&mut self) -> io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        if self.parts == MAX_PARTS {
            return Err(io::Error::other("The recovery journal exceeds its limit."));
        }
        self.files
            .write(&format!("{}-{}", self.id, self.parts), &self.buffer)?;
        self.bytes += self.buffer.len() as u64;
        self.parts += 1;
        self.buffer.fill(0);
        self.buffer.clear();
        Ok(())
    }
    pub(crate) fn finish(mut self) -> io::Result<()> {
        self.publish_part()?;
        let manifest = serde_json::to_vec(&Manifest {
            version: 1,
            parts: self.parts,
            bytes: self.bytes,
        })
        .map_err(io::Error::other)?;
        self.files
            .write(&format!("{}-manifest", self.id), &manifest)?;
        Ok(())
    }
}
impl Write for Journal {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let take = bytes.len().min(CHUNK - self.buffer.len());
        self.buffer.extend_from_slice(&bytes[..take]);
        if self.buffer.len() == CHUNK {
            self.publish_part()?;
        }
        Ok(take)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.publish_part()
    }
}
impl Drop for Journal {
    fn drop(&mut self) {
        self.buffer.fill(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_sync::crypto::{AccountKey, files::Purpose};
    use std::sync::Arc;

    #[test]
    fn journal_streaming_is_bounded_and_incomplete_groups_retain_only_encrypted_parts() {
        let temp = tempfile::tempdir().unwrap();
        let key = Arc::new(
            AccountKey::generate()
                .unwrap()
                .profile_file_key("account", "profile")
                .unwrap(),
        );
        let root = EncryptedFiles::open(temp.path(), Purpose::DeadLetter, key).unwrap();
        let value = serde_json::json!({"text":"private synthetic journal 😀".repeat(10_000)});
        let expected = serde_json::to_vec(&value).unwrap();
        let mut journal = Journal::new(&root).unwrap();
        let id = journal.id.clone();
        serde_json::to_writer(&mut journal, &value).unwrap();
        assert!(journal.buffer.len() < CHUNK);
        journal.finish().unwrap();
        let files = root.child(&id, false).unwrap();
        let manifest: Manifest =
            serde_json::from_slice(&files.read(&format!("{id}-manifest"), 1024).unwrap()).unwrap();
        assert_eq!(manifest.bytes, expected.len() as u64);
        assert!(manifest.parts > 1);
        let mut restored = Vec::new();
        for part in 0..manifest.parts {
            restored.extend(files.read(&format!("{id}-{part}"), CHUNK).unwrap());
        }
        assert_eq!(restored, expected);
        let mut partial = Journal::new(&root).unwrap();
        let partial_id = partial.id.clone();
        partial.write_all(&expected).unwrap();
        drop(partial);
        let files = root.child(&partial_id, false).unwrap();
        assert_eq!(
            files.read(&format!("{partial_id}-0"), CHUNK).unwrap(),
            expected[..CHUNK]
        );
        assert!(files.read(&format!("{partial_id}-manifest"), 1024).is_err());
        // A complete first journal's object identity does not address any second journal object.
        assert!(files.read(&format!("{id}-0"), CHUNK).is_err());
        for entry in std::fs::read_dir(temp.path().join(&partial_id)).unwrap() {
            let bytes = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(!bytes.windows(17).any(|p| p == b"private synthetic"));
        }
    }
}
