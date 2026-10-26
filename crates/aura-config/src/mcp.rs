use serde_json::{Map, Value, json};

use crate::{Error, Provider, Result};

/// The copyable subset is deliberately closed. Unknown vendor fields are not discarded to make a
/// conversion appear successful. Values from credential-bearing fields never enter a preview.
pub(crate) fn preview(value: &Value, provider: Provider) -> (String, Option<String>) {
    match portable(value, provider, provider) {
        Ok(value) => (
            serde_json::to_string_pretty(&value).unwrap_or_default(),
            None,
        ),
        Err(error) => {
            let fields = value
                .as_object()
                .map(|object| object.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            (serde_json::to_string_pretty(&json!({"fields": fields, "values": "Hidden because this entry requires a manual review in the agent's configuration."})).unwrap_or_default(), Some(error.to_string()))
        }
    }
}

pub(crate) fn portable(value: &Value, from: Provider, to: Provider) -> Result<Value> {
    let object = value.as_object().ok_or(Error::Format)?;
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "command" | "args" | "url" | "type" | "enabled"
        )
    }) {
        return Err(Error::Unsupported("This server has authentication, environment, or vendor options that require manual setup. No values will be copied.".into()));
    }
    let mut result = Map::new();
    match (object.get("command"), object.get("url")) {
        (Some(Value::String(command)), None) => {
            if command.is_empty()
                || command.len() > 4096
                || sensitive(command)
                || command.contains(['\n', '\r', '\0'])
            {
                return Err(Error::Unsupported(
                    "This server command requires manual review.".into(),
                ));
            }
            if object
                .get("type")
                .is_some_and(|kind| kind.as_str() != Some("stdio"))
            {
                return Err(Error::Format);
            }
            result.insert("command".into(), Value::String(command.clone()));
            if let Some(args) = object.get("args") {
                let args = args.as_array().ok_or(Error::Format)?;
                if args.len() > 128
                    || args
                        .iter()
                        .any(|arg| arg.as_str().is_none_or(|s| s.len() > 4096 || sensitive(s)))
                {
                    return Err(Error::Unsupported("Server arguments may contain authentication or executable interpolation. Review them in the agent's configuration.".into()));
                }
                result.insert("args".into(), Value::Array(args.clone()));
            }
        }
        (None, Some(Value::String(address))) => {
            let url = url::Url::parse(address).map_err(|_| Error::Format)?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || sensitive(url.path())
            {
                return Err(Error::Unsupported("This server URL may contain credentials or unsupported parameters. Configure it manually.".into()));
            }
            if object.contains_key("args") {
                return Err(Error::Format);
            }
            let kind = object
                .get("type")
                .map(|value| value.as_str().ok_or(Error::Format))
                .transpose()?;
            if (from == Provider::Claude && kind.is_none())
                || kind.is_some_and(|kind| {
                    kind != "http"
                        && !(matches!(from, Provider::Pi | Provider::Claude)
                            && kind == "streamable-http")
                })
            {
                return Err(Error::Unsupported(
                    "This transport cannot be converted without changing its behavior.".into(),
                ));
            }
            result.insert("url".into(), Value::String(address.clone()));
            if to == Provider::Claude {
                result.insert("type".into(), Value::String("http".into()));
            }
        }
        _ => return Err(Error::Format),
    }
    if let Some(enabled) = object.get("enabled") {
        let enabled = enabled.as_bool().ok_or(Error::Format)?;
        if to == Provider::Claude {
            // Claude's state is represented separately from an MCP server declaration.
            if !enabled {
                return Err(Error::Unsupported(
                    "A disabled server cannot be enabled by copying it to Claude.".into(),
                ));
            }
        } else {
            result.insert("enabled".into(), Value::Bool(enabled));
        }
    }
    Ok(Value::Object(result))
}

fn sensitive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "passwd",
        "api_key",
        "api-key",
        "apikey",
        "authorization",
        "bearer ",
        "sk-",
        "ghp_",
        "github_pat_",
        "${",
        "$(",
        "`",
        "-----begin",
    ]
    .iter()
    .any(|part| lower.contains(part))
}

pub(crate) fn toml_json(item: &toml_edit::Item) -> Result<Value> {
    if let Some(table) = item.as_table_like() {
        let mut object = Map::new();
        for (key, value) in table.iter() {
            object.insert(key.into(), toml_json(value)?);
        }
        return Ok(Value::Object(object));
    }
    value_json(item.as_value().ok_or(Error::Format)?)
}

fn value_json(value: &toml_edit::Value) -> Result<Value> {
    Ok(match value {
        toml_edit::Value::String(value) => json!(value.value()),
        toml_edit::Value::Integer(value) => json!(value.value()),
        toml_edit::Value::Float(value) => json!(value.value()),
        toml_edit::Value::Boolean(value) => json!(value.value()),
        toml_edit::Value::Array(array) => {
            Value::Array(array.iter().map(value_json).collect::<Result<_>>()?)
        }
        toml_edit::Value::InlineTable(table) => Value::Object(
            table
                .iter()
                .map(|(key, value)| Ok((key.to_owned(), value_json(value)?)))
                .collect::<Result<_>>()?,
        ),
        toml_edit::Value::Datetime(_) => return Err(Error::Format),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_http_requires_its_native_discriminator_but_supports_the_documented_alias() {
        assert!(
            portable(
                &json!({"url":"https://example.test/mcp"}),
                Provider::Claude,
                Provider::Pi
            )
            .is_err()
        );
        let converted = portable(
            &json!({"type":"streamable-http", "url":"https://example.test/mcp"}),
            Provider::Claude,
            Provider::Codex,
        )
        .unwrap();
        assert_eq!(converted, json!({"url":"https://example.test/mcp"}));
        assert!(
            portable(
                &json!({"type":"sse", "url":"https://example.test/sse"}),
                Provider::Claude,
                Provider::Pi
            )
            .is_err()
        );
    }
}
