//! Public MCP projection and device-local requirements. No credential value leaves this module
//! through a snapshot, requirement list, preview or diagnostic.
use super::{ConfigFormat, ConfigIdentity, ConfigPortError};
use crate::{Error, Provider, Result};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

fn local_group(provider: Provider, field: &str) -> bool {
    field == "env"
        || match provider {
            Provider::Codex => matches!(
                field,
                "http_headers" | "env_http_headers" | "env_vars" | "bearer_token_env_var"
            ),
            Provider::Claude | Provider::Pi => field == "headers",
            Provider::Shared => false,
        }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.$".contains(&byte))
}

pub(super) fn validate_requirements(
    fields: &[String],
    provider: Provider,
) -> std::result::Result<(), ConfigPortError> {
    if fields.len() > 128 || fields.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(ConfigPortError::Invalid);
    }
    for field in fields {
        let valid = if field == "bearer_token_env_var" {
            provider == Provider::Codex
        } else if let Some((group, name)) = field.split_once('/') {
            local_group(provider, group) && group != "bearer_token_env_var" && valid_name(name)
        } else {
            false
        };
        if !valid {
            return Err(ConfigPortError::Invalid);
        }
    }
    Ok(())
}

/// Return a supported public entry plus the exact names of existing local setup requirements.
/// Unknown options remain unsupported; dropping an unknown field could change vendor behavior.
pub(super) fn project(value: &Value, provider: Provider) -> Result<(Value, Vec<String>)> {
    let object = value.as_object().ok_or(Error::Format)?;
    let mut public = Map::new();
    let mut fields = BTreeSet::new();
    for (field, value) in object {
        if !local_group(provider, field) {
            public.insert(field.clone(), value.clone());
            continue;
        }
        if field == "bearer_token_env_var" {
            if value.as_str().is_none_or(|name| !valid_name(name)) {
                return Err(Error::Format);
            }
            fields.insert(field.clone());
        } else if field == "env_vars" {
            for name in value.as_array().ok_or(Error::Format)? {
                let name = name
                    .as_str()
                    .filter(|name| valid_name(name))
                    .ok_or(Error::Format)?;
                fields.insert(format!("{field}/{name}"));
            }
        } else {
            for (name, value) in value.as_object().ok_or(Error::Format)? {
                if !valid_name(name) || value.as_str().is_none_or(|value| value.is_empty()) {
                    return Err(Error::Format);
                }
                fields.insert(format!("{field}/{name}"));
            }
        }
    }
    let fields: Vec<_> = fields.into_iter().collect();
    validate_requirements(&fields, provider).map_err(|_| Error::Format)?;
    let public = Value::Object(public);
    crate::mcp::portable(&public, provider, provider)?;
    Ok((public, fields))
}

/// Local values never follow a changed endpoint, command or argument list. Such a change needs the
/// vendor's explicit setup workflow, even when the remote snapshot has authenticated successfully.
pub(super) fn preserve(
    public: Option<&Value>,
    local: Option<&Value>,
    required: &[String],
    provider: Provider,
) -> Result<Option<Value>> {
    validate_requirements(required, provider).map_err(|_| Error::Format)?;
    let (local_public, available) = local
        .map(|value| project(value, provider))
        .transpose()?
        .unwrap_or((Value::Null, Vec::new()));
    if required
        .iter()
        .any(|name| available.binary_search(name).is_err())
    {
        return Err(Error::Unavailable);
    }
    let Some(public) = public else {
        if !available.is_empty() {
            return Err(Error::Unavailable);
        }
        return Ok(None);
    };
    crate::mcp::portable(public, provider, provider)?;
    if !available.is_empty()
        && ["command", "args", "url", "type"]
            .iter()
            .any(|key| local_public.get(*key) != public.get(*key))
    {
        return Err(Error::Unavailable);
    }
    let mut merged = public.as_object().ok_or(Error::Format)?.clone();
    if let Some(local) = local.and_then(Value::as_object) {
        for (field, value) in local {
            if local_group(provider, field) {
                merged.insert(field.clone(), value.clone());
            }
        }
    }
    Ok(Some(Value::Object(merged)))
}

/// Modify the public fields of one entry while retaining raw private JSON spans/TOML tables.
pub(super) fn edit(bytes: &[u8], id: &ConfigIdentity, value: Option<&Value>) -> Result<Vec<u8>> {
    let old = crate::mcp_document::selected(bytes, id.provider, &id.keys[0])?;
    let mut key = id.clone();
    key.format = if id.provider == Provider::Codex {
        ConfigFormat::Toml
    } else {
        ConfigFormat::Json
    };
    key.keys = vec![
        if id.provider == Provider::Codex {
            "mcp_servers".into()
        } else {
            "mcpServers".into()
        },
        id.keys[0].clone(),
    ];
    let Some(value) = value else {
        return super::edit::document(bytes, &key, None);
    };
    let (public, _) = project(value, id.provider)?;
    if let Some(old) = &old {
        let before = old.as_object().ok_or(Error::Format)?;
        let after = value.as_object().ok_or(Error::Format)?;
        for name in before.keys().chain(after.keys()) {
            if local_group(id.provider, name) && before.get(name) != after.get(name) {
                return Err(Error::Stale);
            }
        }
    }
    let mut next = bytes.to_vec();
    for field in ["command", "args", "url", "type", "enabled"] {
        if old.as_ref().and_then(|old| old.get(field)) == public.get(field) {
            continue;
        }
        let mut selected = key.clone();
        selected.keys.push(field.into());
        next = super::edit::document(&next, &selected, public.get(field))?;
    }
    Ok(next)
}
