//! Authenticated content is still untrusted. Validate its exact provider-owned destination before
//! displaying it or opening a path. The payload contains no absolute local path or credential field.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use super::{ConfigPortError, ConfigScope, MAX_SNAPSHOT_BYTES};
use crate::{Provider, safe_fs};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFormat {
    File,
    Tree,
    Json,
    Toml,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigIdentity {
    pub provider: Provider,
    pub scope: ConfigScope,
    pub format: ConfigFormat,
    /// Provider-relative path. MCP uses its actual document name, never the whole home folder.
    pub path: String,
    /// Object/table key components. Arrays are one value; their indices are never editable keys.
    pub keys: Vec<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigFile {
    /// Relative to the identity's directory for a Tree, or the empty key for one File.
    pub bytes: Vec<u8>,
    pub executable: bool,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum ConfigContent {
    Files(BTreeMap<String, ConfigFile>),
    Value(Value),
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigSnapshot {
    pub schema: u32,
    pub identity: ConfigIdentity,
    /// None is an explicit tombstone. A missing remote head is not a tombstone.
    pub content: Option<ConfigContent>,
}

impl ConfigIdentity {
    pub fn id(&self) -> Result<String, ConfigPortError> {
        self.validate()?;
        let bytes = serde_json::to_vec(self).map_err(|_| ConfigPortError::Invalid)?;
        Ok(safe_fs::hash(&bytes))
    }

    pub fn validate(&self) -> Result<(), ConfigPortError> {
        safe_fs::validate(&self.path).map_err(|_| ConfigPortError::Invalid)?;
        if self.keys.len() > 16
            || self.keys.iter().any(|key| {
                key.is_empty()
                    || key.len() > 256
                    || key.chars().any(char::is_control)
                    || forbidden_key(key)
            })
            || !allowed_target(self)
        {
            return Err(ConfigPortError::Invalid);
        }
        Ok(())
    }

    pub fn applies_on(&self, platform: ConfigScope) -> bool {
        self.scope == ConfigScope::Portable || self.scope == platform
    }

    /// Declarations that can fetch or activate executable packages require a vendor installation
    /// workflow. Merely writing a declaration must not claim that its package has been installed.
    pub fn requires_vendor(&self) -> bool {
        self.keys.first().is_some_and(|key| {
            matches!(
                key.as_str(),
                "enabledPlugins" | "extraKnownMarketplaces" | "packages"
            )
        })
    }
}

impl ConfigSnapshot {
    pub fn tombstone(identity: ConfigIdentity) -> Self {
        Self {
            schema: 1,
            identity,
            content: None,
        }
    }

    pub fn decode(bytes: &[u8], expected_id: &str) -> Result<Self, ConfigPortError> {
        if bytes.len() > MAX_SNAPSHOT_BYTES {
            return Err(ConfigPortError::Limit);
        }
        let snapshot: Self = serde_json::from_slice(bytes).map_err(|_| ConfigPortError::Invalid)?;
        snapshot.validate()?;
        if snapshot.identity.id()? != expected_id {
            return Err(ConfigPortError::Invalid);
        }
        Ok(snapshot)
    }

    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>, ConfigPortError> {
        self.validate()?;
        let mut value = serde_json::to_value(self).map_err(|_| ConfigPortError::Invalid)?;
        canonicalize(&mut value);
        let bytes =
            Zeroizing::new(serde_json::to_vec(&value).map_err(|_| ConfigPortError::Invalid)?);
        if bytes.len() > MAX_SNAPSHOT_BYTES {
            return Err(ConfigPortError::Limit);
        }
        Ok(bytes)
    }

    pub fn validate(&self) -> Result<(), ConfigPortError> {
        self.identity.validate()?;
        if self.schema != 1 {
            return Err(ConfigPortError::Invalid);
        }
        let Some(content) = &self.content else {
            return Ok(());
        };
        match (self.identity.format, content) {
            (ConfigFormat::File | ConfigFormat::Tree, ConfigContent::Files(files)) => {
                if files.is_empty()
                    || files.len() > safe_fs::FILE_COUNT
                    || self.identity.format == ConfigFormat::File
                        && (files.len() != 1 || !files.contains_key(""))
                {
                    return Err(ConfigPortError::Invalid);
                }
                let mut total = 0usize;
                for (path, file) in files {
                    if self.identity.format == ConfigFormat::Tree {
                        safe_fs::validate(path).map_err(|_| ConfigPortError::Invalid)?;
                    }
                    if file.bytes.len() > safe_fs::FILE_LIMIT {
                        return Err(ConfigPortError::Limit);
                    }
                    total = total
                        .checked_add(file.bytes.len())
                        .ok_or(ConfigPortError::Limit)?;
                }
                if total > MAX_SNAPSHOT_BYTES {
                    return Err(ConfigPortError::Limit);
                }
            }
            (
                ConfigFormat::Json | ConfigFormat::Toml | ConfigFormat::Mcp,
                ConfigContent::Value(value),
            ) => {
                validate_value(value, 0)?;
                if self.identity.format == ConfigFormat::Mcp {
                    crate::mcp::portable(value, self.identity.provider, self.identity.provider)
                        .map_err(|_| ConfigPortError::Invalid)?;
                }
            }
            _ => return Err(ConfigPortError::Invalid),
        }
        Ok(())
    }
}

pub(super) fn forbidden_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "projects"
            | "trust"
            | "trustlevel"
            | "trust_level"
            | "oauth"
            | "credentials"
            | "credential"
            | "auth"
            | "env"
            | "environment"
            | "headers"
            | "http_headers"
            | "apikeyhelper"
            | "api_key_helper"
            | "otel_headers"
    ) || [
        "token",
        "secret",
        "password",
        "passwd",
        "api_key",
        "api-key",
        "apikey",
        "authorization",
        "private_key",
    ]
    .iter()
    .any(|part| lower.contains(part))
}

pub(super) fn validate_value(value: &Value, depth: usize) -> Result<(), ConfigPortError> {
    if depth > 16 {
        return Err(ConfigPortError::Limit);
    }
    match value {
        Value::Object(object) => {
            if object.len() > 512 {
                return Err(ConfigPortError::Limit);
            }
            for (key, value) in object {
                if key.len() > 256 || forbidden_key(key) {
                    return Err(ConfigPortError::Invalid);
                }
                validate_value(value, depth + 1)?;
            }
        }
        Value::Array(array) => {
            if array.len() > 1024 {
                return Err(ConfigPortError::Limit);
            }
            for value in array {
                validate_value(value, depth + 1)?;
            }
        }
        Value::String(value) => {
            if value.len() > safe_fs::FILE_LIMIT {
                return Err(ConfigPortError::Limit);
            }
            if value.contains('\0') || secret_literal(value) {
                return Err(ConfigPortError::Invalid);
            }
        }
        _ => {}
    }
    Ok(())
}

fn secret_literal(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "-----begin",
        "bearer ",
        "sk-ant-",
        "sk-proj-",
        "ghp_",
        "github_pat_",
    ]
    .iter()
    .any(|part| lower.contains(part))
}

pub(super) fn allowed_target(id: &ConfigIdentity) -> bool {
    use ConfigFormat as F;
    use Provider as P;
    let path = id.path.as_str();
    let first = id.keys.first().map(String::as_str);
    match id.format {
        F::File if id.keys.is_empty() => match id.provider {
            P::Claude => {
                path == "CLAUDE.md"
                    || under(path, &["rules", "commands", "agents", "output-styles"])
            }
            P::Codex => {
                matches!(path, "AGENTS.md" | "AGENTS.override.md")
                    || under(path, &["agents", "rules"])
            }
            P::Pi => {
                matches!(
                    path,
                    "AGENTS.md" | "AGENTS.override.md" | "SYSTEM.md" | "APPEND_SYSTEM.md"
                ) || under(path, &["prompts", "themes", "extensions"])
            }
            P::Shared => false,
        },
        F::Tree if id.keys.is_empty() => {
            let parts: Vec<_> = path.split('/').collect();
            if id.provider == P::Shared {
                parts.len() == 1
            } else {
                parts.len() == 2 && parts[0] == "skills"
            }
        }
        F::Mcp if id.keys.len() == 1 => match id.provider {
            P::Claude => path == ".claude.json",
            P::Codex => path == "config.toml",
            P::Pi => path == "mcp.json",
            P::Shared => false,
        },
        F::Json if !id.keys.is_empty() => match id.provider {
            P::Claude => matches!(path, "settings.json" | "keybindings.json"),
            P::Codex => path == "hooks.json",
            P::Pi => matches!(path, "settings.json" | "keybindings.json" | "models.json"),
            P::Shared => false,
        },
        F::Toml if !id.keys.is_empty() => {
            id.provider == P::Codex && path == "config.toml" && first != Some("mcp_servers")
        }
        _ => false,
    }
}

fn under(path: &str, directories: &[&str]) -> bool {
    path.split_once('/')
        .is_some_and(|(root, rest)| directories.contains(&root) && !rest.is_empty())
}

fn canonicalize(value: &mut Value) {
    match value {
        Value::Object(object) => {
            object.sort_keys();
            for value in object.values_mut() {
                canonicalize(value);
            }
        }
        Value::Array(array) => {
            for value in array {
                canonicalize(value);
            }
        }
        _ => {}
    }
}
