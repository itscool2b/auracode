use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{ConfigPortError, MAX_APPLY_RECEIPT_BYTES};
use crate::{
    safe_fs,
    sync::{ConfigFile, ConfigFormat, ConfigIdentity},
};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Mutation {
    pub path: String,
    pub before: Option<ConfigFile>,
    pub after: Option<ConfigFile>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum State {
    Prepared,
    Applied,
    RolledBack,
}

pub(super) struct Receipt {
    pub id: String,
    pub source: String,
    pub realm: String,
    pub identity: ConfigIdentity,
    pub state: State,
    pub restores: Option<String>,
    pub files: Vec<Mutation>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    version: u32,
    id: String,
    source: String,
    realm: String,
    identity: ConfigIdentity,
    state: State,
    restores: Option<String>,
    files: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    before: Option<Stamp>,
    after: Option<Stamp>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Stamp {
    len: usize,
    executable: bool,
}

impl Receipt {
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        let stamp = |file: &ConfigFile| Stamp {
            len: file.bytes.len(),
            executable: file.executable,
        };
        let header = Header {
            version: 1,
            id: self.id.clone(),
            source: self.source.clone(),
            realm: self.realm.clone(),
            identity: self.identity.clone(),
            state: self.state,
            restores: self.restores.clone(),
            files: self
                .files
                .iter()
                .map(|file| Entry {
                    path: file.path.clone(),
                    before: file.before.as_ref().map(stamp),
                    after: file.after.as_ref().map(stamp),
                })
                .collect(),
        };
        let metadata = serde_json::to_vec(&header).map_err(|_| ConfigPortError::Invalid)?;
        if metadata.len() > 512 * 1024 {
            return Err(ConfigPortError::Limit);
        }
        let mut bytes = Zeroizing::new(Vec::new());
        bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&metadata);
        for file in &self.files {
            for value in [&file.before, &file.after].into_iter().flatten() {
                if bytes.len().saturating_add(value.bytes.len()) > MAX_APPLY_RECEIPT_BYTES {
                    return Err(ConfigPortError::Limit);
                }
                bytes.extend_from_slice(&value.bytes);
            }
        }
        Ok(bytes)
    }

    pub fn decode(id: &str, bytes: &[u8]) -> Result<Self, ConfigPortError> {
        if bytes.len() > MAX_APPLY_RECEIPT_BYTES || bytes.len() < 4 {
            return Err(ConfigPortError::Invalid);
        }
        let length = u32::from_le_bytes(
            bytes[..4]
                .try_into()
                .map_err(|_| ConfigPortError::Invalid)?,
        ) as usize;
        if length > 512 * 1024 || length > bytes.len() - 4 {
            return Err(ConfigPortError::Invalid);
        }
        let header: Header =
            serde_json::from_slice(&bytes[4..4 + length]).map_err(|_| ConfigPortError::Invalid)?;
        if header.version != 1
            || header.id != id
            || !valid_id(id)
            || header.restores.as_ref().is_some_and(|id| !valid_id(id))
            || header.files.len() > safe_fs::FILE_COUNT * 2
        {
            return Err(ConfigPortError::Invalid);
        }
        header.identity.validate()?;
        let mut seen = std::collections::HashSet::new();
        let mut cursor = 4 + length;
        let mut files = Vec::new();
        for entry in header.files {
            safe_fs::validate(&entry.path).map_err(|_| ConfigPortError::Invalid)?;
            let valid = if header.identity.format == ConfigFormat::Tree {
                entry
                    .path
                    .strip_prefix(&format!("{}/", header.identity.path))
                    .is_some_and(|path| !path.is_empty())
            } else {
                entry.path == header.identity.path
            };
            if !valid || !seen.insert(entry.path.clone()) {
                return Err(ConfigPortError::Invalid);
            }
            let mut take = |stamp: Option<Stamp>| -> Result<Option<ConfigFile>, ConfigPortError> {
                stamp
                    .map(|stamp| {
                        if stamp.len > safe_fs::FILE_LIMIT || stamp.len > bytes.len() - cursor {
                            return Err(ConfigPortError::Invalid);
                        }
                        let file = ConfigFile {
                            bytes: bytes[cursor..cursor + stamp.len].to_vec(),
                            executable: stamp.executable,
                        };
                        cursor += stamp.len;
                        Ok(file)
                    })
                    .transpose()
            };
            files.push(Mutation {
                path: entry.path,
                before: take(entry.before)?,
                after: take(entry.after)?,
            });
        }
        if cursor != bytes.len() {
            return Err(ConfigPortError::Invalid);
        }
        Ok(Self {
            id: header.id,
            source: header.source,
            realm: header.realm,
            identity: header.identity,
            state: header.state,
            restores: header.restores,
            files,
        })
    }
}

impl Drop for Receipt {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        for file in &mut self.files {
            for value in [&mut file.before, &mut file.after].into_iter().flatten() {
                value.bytes.zeroize();
            }
        }
    }
}

pub(super) fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id)
        .ok()
        .is_some_and(|uuid| uuid.to_string() == id)
}
