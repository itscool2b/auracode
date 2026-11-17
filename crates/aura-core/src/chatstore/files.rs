//! The writer's external files: one profile's attachment blobs and its backups folder.
use super::blobs::{self, ReadError};
use aura_protocol::session::BlobText;
use std::{io, path::PathBuf};

/// `<profile>/attachments`, where blobs are stored by content hash.
#[derive(Debug, Clone)]
pub(crate) struct Attachments(PathBuf);

impl Attachments {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self(dir)
    }
    pub(crate) fn write(&self, hash: &str, bytes: &[u8]) -> io::Result<u64> {
        blobs::write(&self.0, hash, bytes)
    }
    pub(crate) fn read_page(
        &self,
        hash: &str,
        offset: u64,
        len: u32,
    ) -> Result<BlobText, ReadError> {
        blobs::read_page(&self.0, hash, offset, len)
    }
}

#[derive(Clone)]
pub(crate) struct Files {
    pub attachments: Attachments,
    pub backups: PathBuf,
}

impl Files {
    pub(crate) fn new(profile: &crate::profile::Profile) -> Self {
        Self {
            attachments: Attachments::new(profile.attachments_dir()),
            backups: profile.backups_dir(),
        }
    }
}
