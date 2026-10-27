//! Authenticated, bounded local profile files. Each independently authenticated chunk binds its
//! object, purpose, total length and index. Plaintext never needs a temporary file for range reads.
use super::{
    AccountKey, CryptoError, Payload, URL_SAFE_NO_PAD, XChaCha20Poly1305, XNonce, derive,
    identifier, json_context, random,
};
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use std::io::{Read, Seek, SeekFrom, Write};
use zeroize::Zeroizing;

const MAGIC: &[u8; 10] = b"AURA-FILE\x01";
const HEADER: usize = 42;
const TAG: usize = 16;
pub const CHUNK: usize = 64 * 1024;
pub const MAX_FILE: usize = 64 * 1024 * 1024;
pub const MAX_PAGE: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Attachment,
    DeadLetter,
    Checkpoint,
    Metadata,
}
impl Purpose {
    fn label(self) -> &'static str {
        match self {
            Self::Attachment => "attachment",
            Self::DeadLetter => "dead_letter",
            Self::Checkpoint => "checkpoint",
            Self::Metadata => "metadata",
        }
    }
}

pub struct ProfileFileKey(Zeroizing<[u8; 32]>);
impl std::fmt::Debug for ProfileFileKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProfileFileKey([REDACTED])")
    }
}
impl AccountKey {
    pub fn profile_file_key(&self, account: &str, profile: &str) -> super::Result<ProfileFileKey> {
        identifier(account)?;
        identifier(profile)?;
        Ok(ProfileFileKey(derive(
            self.0.as_ref(),
            &json_context(&("auracode-profile-files-v1", account, profile))?,
        )?))
    }
}
impl ProfileFileKey {
    /// Opaque deterministic filename; public content hashes do not reveal a known file's presence.
    pub fn object_name(&self, purpose: Purpose, id: &str) -> super::Result<String> {
        identifier(id)?;
        let name = derive(
            self.0.as_ref(),
            &json_context(&("auracode-profile-file-name-v1", purpose.label(), id))?,
        )?;
        Ok(format!("{}.enc", URL_SAFE_NO_PAD.encode(name.as_ref())))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error("The encrypted profile file could not be read or written.")]
    Io(#[from] std::io::Error),
}
type Result<T> = std::result::Result<T, FileError>;

/// Writes only the fixed header and ciphertext. The caller owns atomic file publication and cleanup
/// if IO fails. Every replacement uses a fresh random 192-bit starting nonce, never a reused stream.
pub fn seal(
    key: &ProfileFileKey,
    purpose: Purpose,
    id: &str,
    plain: &[u8],
    mut out: impl Write,
) -> Result<()> {
    identifier(id)?;
    if plain.len() > MAX_FILE {
        return Err(CryptoError::TooLarge.into());
    }
    let prefix = *random::<24>()?;
    out.write_all(MAGIC)?;
    out.write_all(&(plain.len() as u64).to_be_bytes())?;
    out.write_all(&prefix)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(key.0.as_ref()).map_err(|_| CryptoError::Invalid)?;
    for index in 0..count(plain.len() as u64) {
        let start = index as usize * CHUNK;
        let msg = &plain[start..plain.len().min(start + CHUNK)];
        let aad = aad(purpose, id, plain.len() as u64, index)?;
        let encrypted = cipher
            .encrypt(
                &XNonce::from(nonce(prefix, index)),
                Payload { msg, aad: &aad },
            )
            .map_err(|_| CryptoError::Authentication)?;
        out.write_all(&encrypted)?;
    }
    Ok(())
}

/// The header is authenticated against chunk zero before length or offsets are exposed. A range
/// verifies each requested chunk before returning any bytes, and never claims unread chunks passed.
pub struct Reader<'a, R> {
    key: &'a ProfileFileKey,
    purpose: Purpose,
    id: String,
    stream: R,
    total: u64,
    prefix: [u8; 24],
}
pub struct PlainRange {
    pub offset: u64,
    pub total: u64,
    pub bytes: Zeroizing<Vec<u8>>,
}
impl PlainRange {
    pub fn next_offset(&self) -> u64 {
        self.offset + self.bytes.len() as u64
    }
}
impl<'a, R: Read + Seek> Reader<'a, R> {
    pub fn new(key: &'a ProfileFileKey, purpose: Purpose, id: &str, mut stream: R) -> Result<Self> {
        identifier(id)?;
        stream.seek(SeekFrom::Start(0))?;
        let mut header = [0; HEADER];
        exact(&mut stream, &mut header)?;
        if &header[..10] != MAGIC {
            return Err(CryptoError::Version.into());
        }
        let total = u64::from_be_bytes(
            header[10..18]
                .try_into()
                .map_err(|_| CryptoError::Invalid)?,
        );
        if total > MAX_FILE as u64 {
            return Err(CryptoError::TooLarge.into());
        }
        if stream.seek(SeekFrom::End(0))? != HEADER as u64 + total + count(total) * TAG as u64 {
            return Err(CryptoError::Invalid.into());
        }
        let prefix = header[18..].try_into().map_err(|_| CryptoError::Invalid)?;
        let mut reader = Self {
            key,
            purpose,
            id: id.into(),
            stream,
            total,
            prefix,
        };
        reader.chunk(0)?;
        Ok(reader)
    }
    pub fn total(&self) -> u64 {
        self.total
    }
    pub fn range(&mut self, offset: u64, limit: usize) -> Result<PlainRange> {
        if limit == 0 || limit > MAX_PAGE {
            return Err(CryptoError::TooLarge.into());
        }
        let offset = offset.min(self.total);
        let end = offset.saturating_add(limit as u64).min(self.total);
        let mut bytes = Zeroizing::new(Vec::with_capacity((end - offset) as usize));
        let mut position = offset;
        while position < end {
            let index = position / CHUNK as u64;
            let chunk = self.chunk(index)?;
            let start = (position % CHUNK as u64) as usize;
            let length = ((end - position) as usize).min(chunk.len() - start);
            bytes.extend_from_slice(&chunk[start..start + length]);
            position += length as u64;
        }
        Ok(PlainRange {
            offset,
            total: self.total,
            bytes,
        })
    }
    pub fn read_all(&mut self) -> Result<Zeroizing<Vec<u8>>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(self.total as usize));
        while (bytes.len() as u64) < self.total {
            let offset = bytes.len() as u64;
            bytes.extend_from_slice(&self.range(offset, MAX_PAGE)?.bytes);
        }
        Ok(bytes)
    }
    fn chunk(&mut self, index: u64) -> Result<Zeroizing<Vec<u8>>> {
        if index >= count(self.total) {
            return Err(CryptoError::Invalid.into());
        }
        let plain_len = (self.total - index * CHUNK as u64).min(CHUNK as u64) as usize;
        let mut encrypted = vec![0; plain_len + TAG];
        self.stream.seek(SeekFrom::Start(
            HEADER as u64 + index * (CHUNK + TAG) as u64,
        ))?;
        exact(&mut self.stream, &mut encrypted)?;
        let aad = aad(self.purpose, &self.id, self.total, index)?;
        let cipher = XChaCha20Poly1305::new_from_slice(self.key.0.as_ref())
            .map_err(|_| CryptoError::Invalid)?;
        cipher
            .decrypt(
                &XNonce::from(nonce(self.prefix, index)),
                Payload {
                    msg: &encrypted,
                    aad: &aad,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| CryptoError::Authentication.into())
    }
}
fn exact(stream: &mut impl Read, bytes: &mut [u8]) -> Result<()> {
    match stream.read_exact(bytes) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            Err(CryptoError::Invalid.into())
        }
        Err(error) => Err(error.into()),
    }
}
fn count(total: u64) -> u64 {
    total.div_ceil(CHUNK as u64).max(1)
}
fn nonce(mut prefix: [u8; 24], index: u64) -> [u8; 24] {
    // Big-endian addition modulo 2^192. Each file has at most 1024 chunks, so its counters cannot
    // repeat. Randomizing all 192 starting bits makes overlap between files' short ranges negligible.
    let mut carry = index;
    for byte in prefix.iter_mut().rev() {
        let sum = u64::from(*byte) + (carry & 0xff);
        *byte = sum as u8;
        carry = (carry >> 8) + (sum >> 8);
    }
    prefix
}
fn aad(purpose: Purpose, id: &str, total: u64, index: u64) -> super::Result<Vec<u8>> {
    json_context(&(
        "auracode-profile-file-v1",
        purpose.label(),
        id,
        total,
        index,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    fn key() -> ProfileFileKey {
        AccountKey::generate()
            .unwrap()
            .profile_file_key("account", "profile")
            .unwrap()
    }
    fn encrypted(key: &ProfileFileKey, purpose: Purpose, id: &str, plain: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        seal(key, purpose, id, plain, &mut bytes).unwrap();
        bytes
    }
    #[test]
    fn ranges_cross_chunks_and_empty_files_authenticate_without_plaintext_storage() {
        let key = key();
        let plain: Vec<_> = (0..CHUNK * 2 + 23).map(|n| (n % 251) as u8).collect();
        let bytes = encrypted(&key, Purpose::Attachment, "content", &plain);
        let mut reader =
            Reader::new(&key, Purpose::Attachment, "content", Cursor::new(&bytes)).unwrap();
        assert_eq!(reader.total(), plain.len() as u64);
        let page = reader.range((CHUNK - 7) as u64, 23).unwrap();
        assert_eq!(page.bytes.as_slice(), &plain[CHUNK - 7..CHUNK + 16]);
        assert_eq!(reader.read_all().unwrap().as_slice(), plain);
        assert!(reader.range(u64::MAX, MAX_PAGE).unwrap().bytes.is_empty());
        let empty = encrypted(&key, Purpose::DeadLetter, "empty", &[]);
        assert_eq!(empty.len(), HEADER + TAG);
        assert_eq!(
            Reader::new(&key, Purpose::DeadLetter, "empty", Cursor::new(empty))
                .unwrap()
                .total(),
            0
        );
        assert_ne!(
            bytes,
            encrypted(&key, Purpose::Attachment, "content", &plain)
        );
    }
    #[test]
    fn purpose_object_key_header_and_truncation_substitution_fail() {
        let key = key();
        let bytes = encrypted(
            &key,
            Purpose::Checkpoint,
            "object",
            b"private synthetic contents",
        );
        assert!(
            !bytes
                .windows(b"private synthetic contents".len())
                .any(|p| p == b"private synthetic contents")
        );
        assert!(Reader::new(&key, Purpose::Attachment, "object", Cursor::new(&bytes)).is_err());
        assert!(Reader::new(&key, Purpose::Checkpoint, "other", Cursor::new(&bytes)).is_err());
        let other = AccountKey::generate()
            .unwrap()
            .profile_file_key("account", "profile")
            .unwrap();
        assert!(Reader::new(&other, Purpose::Checkpoint, "object", Cursor::new(&bytes)).is_err());
        for length in [0, HEADER - 1, bytes.len() - 1] {
            assert!(
                Reader::new(
                    &key,
                    Purpose::Checkpoint,
                    "object",
                    Cursor::new(&bytes[..length])
                )
                .is_err()
            );
        }
        for at in [0, 10, 18, HEADER, bytes.len() - 1] {
            let mut changed = bytes.clone();
            changed[at] ^= 1;
            assert!(
                Reader::new(&key, Purpose::Checkpoint, "object", Cursor::new(changed)).is_err()
            );
        }
    }
    #[test]
    fn chunk_reordering_fails_and_requested_range_never_returns_partial_plaintext() {
        let key = key();
        let plain = vec![5; CHUNK * 3];
        let mut bytes = encrypted(&key, Purpose::Attachment, "object", &plain);
        let a = bytes[HEADER + CHUNK + TAG..HEADER + 2 * (CHUNK + TAG)].to_vec();
        let b = bytes[HEADER + 2 * (CHUNK + TAG)..].to_vec();
        bytes[HEADER + CHUNK + TAG..HEADER + 2 * (CHUNK + TAG)].copy_from_slice(&b);
        bytes[HEADER + 2 * (CHUNK + TAG)..].copy_from_slice(&a);
        let mut reader =
            Reader::new(&key, Purpose::Attachment, "object", Cursor::new(bytes)).unwrap();
        assert!(reader.range(0, CHUNK + 1).is_err());
    }
    #[test]
    fn opaque_names_are_stable_but_account_profile_purpose_and_id_bound() {
        let account = AccountKey::generate().unwrap();
        let first = account.profile_file_key("account", "profile").unwrap();
        let same = account.profile_file_key("account", "profile").unwrap();
        let name = first
            .object_name(Purpose::Attachment, "known_hash")
            .unwrap();
        assert_eq!(
            name,
            same.object_name(Purpose::Attachment, "known_hash").unwrap()
        );
        for key in [
            account.profile_file_key("other", "profile").unwrap(),
            account.profile_file_key("account", "other").unwrap(),
        ] {
            assert_ne!(
                name,
                key.object_name(Purpose::Attachment, "known_hash").unwrap()
            );
        }
        assert_ne!(
            name,
            first
                .object_name(Purpose::Checkpoint, "known_hash")
                .unwrap()
        );
        assert_ne!(
            name,
            first
                .object_name(Purpose::Attachment, "other_hash")
                .unwrap()
        );
        assert!(!name.contains("known_hash"));
        assert!(first.object_name(Purpose::Attachment, "../escape").is_err());
    }
    #[test]
    fn nonce_addition_carries_across_the_full_192_bit_value() {
        assert_eq!(nonce([255; 24], 1), [0; 24]);
        let mut start = [0; 24];
        start[23] = 255;
        let mut next = [0; 24];
        next[22] = 1;
        assert_eq!(nonce(start, 1), next);
        let mut seen = std::collections::HashSet::new();
        for index in 0..1024 {
            assert!(seen.insert(nonce(start, index)));
        }
    }
}
