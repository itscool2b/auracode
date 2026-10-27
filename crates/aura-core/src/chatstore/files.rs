//! The writer's external files. Account callers select encryption once, before the writer starts;
//! no operation may fall back to the Local file layout after a failed encrypted read or write.
use super::blobs::{self, ReadError};
use aura_protocol::session::BlobText;
use std::{io, path::PathBuf, sync::Arc};

#[derive(Debug, Clone)]
pub(crate) enum Attachments {
    Local(PathBuf),
    #[cfg(feature = "account-sync")]
    Encrypted(crate::profile_files::EncryptedFiles),
}
impl Attachments {
    #[cfg(feature = "account-sync")]
    pub(crate) fn sync_range(
        &self,
        hash: &str,
        offset: u64,
    ) -> io::Result<(u64, zeroize::Zeroizing<Vec<u8>>)> {
        if !blobs::is_sha256(hash) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid attachment identifier.",
            ));
        }
        let Self::Encrypted(files) = self else {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Sync requires encrypted attachment storage.",
            ));
        };
        let mut reader = files.reader(hash)?;
        let page = reader.range(offset, 192 * 1024).map_err(io::Error::other)?;
        Ok((page.total, page.bytes))
    }
    pub(crate) fn write(&self, hash: &str, bytes: &[u8]) -> io::Result<u64> {
        match self {
            Self::Local(dir) => blobs::write(dir, hash, bytes),
            #[cfg(feature = "account-sync")]
            Self::Encrypted(files) => {
                if !blobs::is_sha256(hash) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "Invalid blob hash.",
                    ));
                }
                files.write(hash, &bytes[..bytes.len().min(blobs::MAX_BLOB_BYTES)])
            }
        }
    }
    pub(crate) fn reader(&self) -> Option<Arc<dyn aura_drivers::attachments::AttachmentReader>> {
        match self {
            Self::Local(_) => None,
            #[cfg(feature = "account-sync")]
            Self::Encrypted(files) => Some(Arc::new(files.clone())),
        }
    }
    pub(crate) fn read_page(
        &self,
        hash: &str,
        offset: u64,
        len: u32,
    ) -> Result<BlobText, ReadError> {
        match self {
            Self::Local(dir) => blobs::read_page(dir, hash, offset, len),
            #[cfg(feature = "account-sync")]
            Self::Encrypted(files) => {
                if !blobs::is_sha256(hash) {
                    return Err(ReadError::Gone);
                }
                let mut reader = files.reader(hash).map_err(|error| {
                    if error.kind() == io::ErrorKind::NotFound {
                        ReadError::Gone
                    } else {
                        ReadError::Io(error)
                    }
                })?;
                let total = reader.total();
                let offset = offset.min(total);
                let len = len.clamp(1, blobs::MAX_BLOB_PAGE);
                // A UTF-8 boundary may require four extra bytes. Each authenticated range remains
                // within the codec's independent 256 KiB budget.
                let wanted = (u64::from(len) + 4).min(total - offset) as usize;
                let mut bytes = Vec::with_capacity(wanted);
                while bytes.len() < wanted {
                    let page = reader
                        .range(
                            offset + bytes.len() as u64,
                            (wanted - bytes.len()).min(aura_sync::crypto::files::MAX_PAGE),
                        )
                        .map_err(|error| ReadError::Io(io::Error::other(error)))?;
                    bytes.extend_from_slice(&page.bytes);
                }
                Ok(blobs::text_window(hash, offset, len, total, &bytes))
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct Files {
    pub attachments: Attachments,
    pub backups: PathBuf,
    #[cfg(feature = "account-sync")]
    pub recovery: Option<crate::profile_files::EncryptedFiles>,
}
impl Files {
    pub(crate) fn local(profile: &crate::profile::Profile) -> Self {
        Self {
            attachments: Attachments::Local(profile.attachments_dir()),
            backups: profile.backups_dir(),
            #[cfg(feature = "account-sync")]
            recovery: None,
        }
    }
    #[cfg(feature = "account-sync")]
    pub(crate) fn account(
        profile: &crate::profile::Profile,
        key: Arc<aura_sync::crypto::files::ProfileFileKey>,
    ) -> io::Result<Self> {
        use crate::profile_files::EncryptedFiles;
        use aura_sync::crypto::files::Purpose;
        Ok(Self {
            attachments: Attachments::Encrypted(EncryptedFiles::open(
                &profile.attachments_dir(),
                Purpose::Attachment,
                key.clone(),
            )?),
            backups: profile.backups_dir(),
            recovery: Some(EncryptedFiles::open(
                &profile.backups_dir().join("recovery"),
                Purpose::DeadLetter,
                key,
            )?),
        })
    }
}
