//! Replace only a reviewed selected value. Unrelated values and their formatting stay local.
use serde_json::Value;

use super::{ConfigFormat, ConfigIdentity};
use crate::{Error, Result, mcp_document::RawObject};

pub(super) fn selected(bytes: &[u8], id: &ConfigIdentity) -> Result<Option<Value>> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if id.format == ConfigFormat::Mcp {
        return crate::mcp_document::selected(bytes, id.provider, &id.keys[0]);
    }
    let text = crate::inventory::text(bytes)?;
    if id.format == ConfigFormat::Toml {
        let document = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| Error::Format)?;
        let mut table: &dyn toml_edit::TableLike = document.as_table();
        for (index, key) in id.keys.iter().enumerate() {
            let Some(item) = table.get(key) else {
                return Ok(None);
            };
            if index + 1 == id.keys.len() {
                return crate::mcp::toml_json(item).map(Some);
            }
            table = item.as_table_like().ok_or(Error::Format)?;
        }
        return Err(Error::Format);
    }
    let mut raw = text;
    for key in &id.keys {
        let object: RawObject<'_> = serde_json::from_str(raw).map_err(|_| Error::Format)?;
        let Some(next) = object.get(key) else {
            return Ok(None);
        };
        raw = next.get();
    }
    serde_json::from_str(raw)
        .map(Some)
        .map_err(|_| Error::Format)
}

pub(super) fn document(
    bytes: &[u8],
    id: &ConfigIdentity,
    value: Option<&Value>,
) -> Result<Vec<u8>> {
    let text = crate::inventory::text(bytes)?;
    let updated = match id.format {
        ConfigFormat::Mcp => {
            return crate::mcp_document::replace(bytes, id.provider, &id.keys[0], value);
        }
        ConfigFormat::Json => json(if text.is_empty() { "{}\n" } else { text }, &id.keys, value)?,
        ConfigFormat::Toml => {
            let mut document = text
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| Error::Format)?;
            toml(document.as_table_mut(), &id.keys, value)?;
            document.to_string()
        }
        _ => return Err(Error::Format),
    };
    if updated.len() > crate::safe_fs::FILE_LIMIT {
        return Err(Error::Limit);
    }
    Ok(updated.into_bytes())
}

fn json(text: &str, keys: &[String], value: Option<&Value>) -> Result<String> {
    let (key, tail) = keys.split_first().ok_or(Error::Format)?;
    let object: RawObject<'_> = serde_json::from_str(text).map_err(|_| Error::Format)?;
    let replacement = if tail.is_empty() {
        value
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| Error::Format)?
    } else if let Some(raw) = object.get(key) {
        Some(json(raw.get(), tail, value)?)
    } else if value.is_some() {
        Some(json("{}", tail, value)?)
    } else {
        return Ok(text.into());
    };
    object.replace(text, key, replacement.as_deref())
}

fn toml(
    table: &mut dyn toml_edit::TableLike,
    keys: &[String],
    value: Option<&Value>,
) -> Result<()> {
    let (key, tail) = keys.split_first().ok_or(Error::Format)?;
    if tail.is_empty() {
        if let Some(value) = value {
            let mut next = toml_value(value)?;
            if let Some(old) = table.get(key).and_then(toml_edit::Item::as_value) {
                *next.decor_mut() = old.decor().clone();
            }
            if let Some(old) = table.get_mut(key) {
                *old = toml_edit::Item::Value(next);
            } else {
                table.insert(key, toml_edit::Item::Value(next));
            }
        } else {
            table.remove(key);
        }
    } else {
        if table.get(key).is_none() {
            if value.is_none() {
                return Ok(());
            }
            table.insert(key, toml_edit::Item::Table(toml_edit::Table::new()));
        }
        let child = table
            .get_mut(key)
            .and_then(toml_edit::Item::as_table_like_mut)
            .ok_or(Error::Format)?;
        toml(child, tail, value)?;
    }
    Ok(())
}

fn toml_value(value: &Value) -> Result<toml_edit::Value> {
    Ok(match value {
        Value::String(value) => toml_edit::Value::from(value.as_str()),
        Value::Bool(value) => toml_edit::Value::from(*value),
        Value::Number(value) if value.is_i64() => {
            toml_edit::Value::from(value.as_i64().ok_or(Error::Format)?)
        }
        Value::Number(value) if value.is_u64() => return Err(Error::Format),
        Value::Number(value) => toml_edit::Value::from(
            value
                .as_f64()
                .filter(|v| v.is_finite())
                .ok_or(Error::Format)?,
        ),
        Value::Array(values) => {
            let mut array = toml_edit::Array::new();
            for value in values {
                array.push(toml_value(value)?);
            }
            toml_edit::Value::Array(array)
        }
        Value::Object(values) => {
            let mut table = toml_edit::InlineTable::new();
            for (key, value) in values {
                table.insert(key, toml_value(value)?);
            }
            toml_edit::Value::InlineTable(table)
        }
        Value::Null => return Err(Error::Format),
    })
}

pub(super) fn expand_home(value: &mut Value, home: &str) {
    match value {
        Value::String(text) if text == "~" => *text = home.into(),
        Value::String(text) if text.starts_with("~/") => {
            *text = format!("{}/{}", home.trim_end_matches(['/', '\\']), &text[2..])
        }
        Value::Array(values) => {
            for value in values {
                expand_home(value, home);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                expand_home(value, home);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Provider, sync::ConfigScope};
    use serde_json::json;

    fn id(format: ConfigFormat, keys: &[&str]) -> ConfigIdentity {
        ConfigIdentity {
            provider: Provider::Codex,
            scope: ConfigScope::Portable,
            format,
            path: "config.toml".into(),
            keys: keys.iter().map(|key| (*key).into()).collect(),
        }
    }

    #[test]
    fn json_replaces_nested_value_without_touching_private_fields_or_number_spelling() {
        let before = br#"{ "safe": {"chosen": 2, "sibling": 1e2}, "env": {"PRIVATE":"fixture"} }"#;
        let next = document(
            before,
            &id(ConfigFormat::Json, &["safe", "chosen"]),
            Some(&json!(3)),
        )
        .unwrap();
        assert_eq!(
            std::str::from_utf8(&next).unwrap(),
            r#"{ "safe": {"chosen": 3, "sibling": 1e2}, "env": {"PRIVATE":"fixture"} }"#
        );
        assert!(
            document(
                br#"{"safe":{},"safe":{}}"#,
                &id(ConfigFormat::Json, &["safe", "chosen"]),
                Some(&json!(3))
            )
            .is_err()
        );
        assert!(
            document(
                br#"{"safe":null}"#,
                &id(ConfigFormat::Json, &["safe", "chosen"]),
                Some(&json!(3))
            )
            .is_err()
        );
    }

    #[test]
    fn json_missing_parent_insert_and_delete_are_valid() {
        let identity = id(ConfigFormat::Json, &["safe", "chosen"]);
        let inserted = document(b"{}", &identity, Some(&json!([1, "two"]))).unwrap();
        let removed = document(&inserted, &identity, None).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&removed).unwrap(),
            json!({"safe":{}})
        );
    }

    #[test]
    fn toml_preserves_unrelated_comments_and_private_tables() {
        let before =
            b"# header\nmodel = 'old' # choice\n[projects.'private']\ntrust_level = 'trusted'\n";
        let after = document(
            before,
            &id(ConfigFormat::Toml, &["model"]),
            Some(&json!("new")),
        )
        .unwrap();
        let text = std::str::from_utf8(&after).unwrap();
        assert!(text.starts_with("# header\n"));
        assert!(text.contains("# choice\n"));
        assert!(text.ends_with("[projects.'private']\ntrust_level = 'trusted'\n"));
        assert!(
            document(
                before,
                &id(ConfigFormat::Toml, &["model"]),
                Some(&Value::Null)
            )
            .is_err()
        );
    }

    #[test]
    fn home_expansion_is_a_prefix_operation_not_an_environment_interpreter() {
        let mut value = json!(["~/rules", "~", "$HOME", "a~/b", "~someone/x"]);
        expand_home(&mut value, "C:/Users/fixture");
        assert_eq!(
            value,
            json!([
                "C:/Users/fixture/rules",
                "C:/Users/fixture",
                "$HOME",
                "a~/b",
                "~someone/x"
            ])
        );
    }
}
