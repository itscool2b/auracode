//! Reviewed filesystem transactions. Durable payloads belong to the encrypted active profile.
use zeroize::Zeroizing;

use super::ConfigPortError;

pub const MAX_APPLY_RECEIPT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_APPLY_RECEIPTS: usize = 256;

/// Bound to one unlocked profile, never selected by an IPC argument. Implementations encrypt both
/// receipts and their UUID index, authenticate previous data and serialize index/CAS mutations.
/// `create` must durably save the receipt and index before returning. A missing `read` is Invalid.
/// Receipt hashes are lowercase SHA-256 of the exact returned plaintext bytes. No plaintext
/// receipt, snapshot, or backup may be written into the Account profile or vendor directories.
/// The caller retains the profile and filesystem mutation guards through completion or recovery.
pub trait ConfigApplyJournal: Send + Sync {
    fn create(&self, id: &str, receipt: Zeroizing<Vec<u8>>) -> Result<(), ConfigPortError>;
    fn read(&self, id: &str) -> Result<Zeroizing<Vec<u8>>, ConfigPortError>;
    fn replace(
        &self,
        id: &str,
        expected_hash: &str,
        receipt: Zeroizing<Vec<u8>>,
    ) -> Result<(), ConfigPortError>;
    fn list(&self) -> Result<Vec<String>, ConfigPortError>;
}
