//! Pure, bounded three-way configuration merge. Conflicts never write marker text to agent files.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::{ConfigContent, ConfigFile, ConfigPortError, ConfigSnapshot};

pub enum LocalSnapshot {
    Present(ConfigSnapshot),
    /// Only an entirely successful scan of the approved source can establish absence.
    Absent,
    /// Missing agents, skipped items, device-only choices, unsupported scope and read failures.
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfigOperation {
    InSync,
    Apply,
    Publish,
    Merge,
    Conflict,
    Wait,
}

pub struct ConfigDecision {
    pub first_link: bool,
    pub operation: ConfigOperation,
    pub result: Option<ConfigSnapshot>,
    /// Relative file or JSON-pointer keys only. No rejected value is included in an error message.
    pub conflicts: Vec<String>,
}

pub fn merge(
    base: Option<&ConfigSnapshot>,
    local: &LocalSnapshot,
    remote: Option<&ConfigSnapshot>,
) -> Result<ConfigDecision, ConfigPortError> {
    let mut decision = ConfigDecision {
        first_link: base.is_none(),
        operation: ConfigOperation::Wait,
        result: None,
        conflicts: Vec::new(),
    };
    let local = match local {
        LocalSnapshot::Unavailable => return Ok(decision),
        LocalSnapshot::Present(value) => Some(value),
        LocalSnapshot::Absent => None,
    };
    let Some(identity) = local.or(remote).or(base).map(|s| &s.identity) else {
        decision.operation = ConfigOperation::InSync;
        return Ok(decision);
    };
    for snapshot in [base, local, remote].into_iter().flatten() {
        snapshot.validate()?;
        if &snapshot.identity != identity {
            return Err(ConfigPortError::Invalid);
        }
    }
    let absent = ConfigSnapshot::tombstone(identity.clone());
    let local = local.unwrap_or(&absent);
    let operation = if let Some(base) = base {
        match remote {
            None => ConfigOperation::Wait,
            Some(remote) if local == remote => ConfigOperation::InSync,
            Some(_) if local == base => ConfigOperation::Apply,
            Some(remote) if remote == base => ConfigOperation::Publish,
            Some(_) => ConfigOperation::Conflict,
        }
    } else {
        match (local.content.is_some(), remote) {
            (false, None) => ConfigOperation::InSync,
            (false, Some(remote)) if remote.content.is_none() => ConfigOperation::InSync,
            (true, None) => ConfigOperation::Publish,
            (true, Some(remote)) if remote.content.is_none() => ConfigOperation::Publish,
            (false, Some(_)) => ConfigOperation::Apply,
            (_, Some(remote)) if remote == local => ConfigOperation::InSync,
            (_, Some(_)) => ConfigOperation::Conflict,
        }
    };
    decision.operation = operation;
    decision.result = match operation {
        ConfigOperation::InSync => remote.cloned().or_else(|| Some(local.clone())),
        ConfigOperation::Apply => remote.cloned(),
        ConfigOperation::Publish => Some(local.clone()),
        ConfigOperation::Conflict => {
            let remote = remote.ok_or(ConfigPortError::Invalid)?;
            let content = merge_content(
                base.and_then(|s| s.content.as_ref()),
                local.content.as_ref(),
                remote.content.as_ref(),
                &mut decision.conflicts,
            );
            if decision.conflicts.is_empty() {
                decision.operation = ConfigOperation::Merge;
                Some(ConfigSnapshot {
                    schema: 1,
                    identity: identity.clone(),
                    content,
                })
            } else {
                None
            }
        }
        ConfigOperation::Merge | ConfigOperation::Wait => None,
    };
    if let Some(result) = &decision.result {
        result.encode()?;
    }
    Ok(decision)
}

fn merge_content(
    base: Option<&ConfigContent>,
    local: Option<&ConfigContent>,
    remote: Option<&ConfigContent>,
    conflicts: &mut Vec<String>,
) -> Option<ConfigContent> {
    match (base, local, remote) {
        (base, Some(ConfigContent::Value(local)), Some(ConfigContent::Value(remote))) => {
            let base = match base {
                Some(ConfigContent::Value(base)) => Some(base),
                _ => None,
            };
            merge_value(base, Some(local), Some(remote), "", conflicts).map(ConfigContent::Value)
        }
        (base, Some(ConfigContent::Files(local)), Some(ConfigContent::Files(remote))) => {
            let empty = BTreeMap::new();
            let base = match base {
                Some(ConfigContent::Files(base)) => base,
                _ => &empty,
            };
            let keys: BTreeSet<_> = base
                .keys()
                .chain(local.keys())
                .chain(remote.keys())
                .collect();
            let mut result = BTreeMap::new();
            for key in keys {
                let file = merge_file(
                    base.get(key),
                    local.get(key),
                    remote.get(key),
                    key,
                    conflicts,
                );
                if let Some(file) = file {
                    result.insert(key.clone(), file);
                }
            }
            Some(ConfigContent::Files(result))
        }
        _ => {
            conflicts.push("/".into());
            None
        }
    }
}

fn merge_value(
    base: Option<&Value>,
    local: Option<&Value>,
    remote: Option<&Value>,
    path: &str,
    conflicts: &mut Vec<String>,
) -> Option<Value> {
    if local == remote {
        return local.cloned();
    }
    if local == base {
        return remote.cloned();
    }
    if remote == base {
        return local.cloned();
    }
    if let (Some(Value::Object(local)), Some(Value::Object(remote))) = (local, remote) {
        let empty = serde_json::Map::new();
        let base = match base {
            Some(Value::Object(base)) => base,
            None => &empty,
            _ => {
                conflicts.push(path.into());
                return None;
            }
        };
        let keys: BTreeSet<_> = base
            .keys()
            .chain(local.keys())
            .chain(remote.keys())
            .collect();
        let mut result = serde_json::Map::new();
        for key in keys {
            let key_path = format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"));
            if let Some(value) = merge_value(
                base.get(key),
                local.get(key),
                remote.get(key),
                &key_path,
                conflicts,
            ) {
                result.insert(key.clone(), value);
            }
        }
        Some(Value::Object(result))
    } else {
        conflicts.push(if path.is_empty() {
            "/".into()
        } else {
            path.into()
        });
        None
    }
}

fn merge_file(
    base: Option<&ConfigFile>,
    local: Option<&ConfigFile>,
    remote: Option<&ConfigFile>,
    path: &str,
    conflicts: &mut Vec<String>,
) -> Option<ConfigFile> {
    if local == remote {
        return local.cloned();
    }
    if local == base {
        return remote.cloned();
    }
    if remote == base {
        return local.cloned();
    }
    if let (Some(base), Some(local), Some(remote)) = (base, local, remote) {
        let mode = if local.executable == remote.executable || remote.executable == base.executable
        {
            local.executable
        } else {
            remote.executable
        };
        let text = [base, local, remote].map(|file| {
            std::str::from_utf8(&file.bytes)
                .ok()
                .filter(|text| text.len() <= 128 * 1024 && text.lines().count() <= 4096)
        });
        if let [Some(base), Some(local), Some(remote)] = text
            && let Ok(merged) = diffy::merge(base, local, remote)
        {
            return Some(ConfigFile {
                bytes: merged.into_bytes(),
                executable: mode,
            });
        }
    }
    conflicts.push(if path.is_empty() {
        "/".into()
    } else {
        path.into()
    });
    None
}
