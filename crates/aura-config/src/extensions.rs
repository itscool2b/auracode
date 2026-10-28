//! Names-only inventory of the extension files the Library item inventory does not cover: slash
//! commands, subagents, hook events, Pi prompt templates and OpenCode's declared plugins and MCP
//! servers. Nothing here is copied or executed, and no value beyond a name leaves this module:
//! OpenCode MCP entries report the names of their environment and header fields, never values.
use std::path::Path;

use cap_std::fs::Dir;
use serde_json::Value;

use crate::{Error, Provider, Result, safe_fs};

/// One configured MCP server named in a file, with the names of its device-local fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedServer {
    pub name: String,
    pub kind: Option<String>,
    pub local_fields: Vec<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Extensions {
    pub commands: Vec<String>,
    pub subagents: Vec<String>,
    pub hooks: Vec<String>,
    /// Marketplace names declared in settings (Claude `extraKnownMarketplaces`, Codex
    /// `[marketplaces]`), used when the CLI cannot list them.
    pub marketplaces: Vec<String>,
    /// OpenCode only: npm plugins declared in `opencode.json` and local plugin files.
    pub plugins: Vec<String>,
    /// OpenCode only: its `mcp` servers.
    pub servers: Vec<NamedServer>,
    /// OpenCode only: skill folders.
    pub skills: Vec<String>,
    /// Fixed sentences for parts that could not be read. The rest is still listed.
    pub notices: Vec<String>,
}

fn open(root: &Path) -> Result<Dir> {
    Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(|_| Error::Unavailable)
}

/// Files with one of `extensions` directly in `dir` (and one level down for namespaced Claude
/// commands), as names without their extension.
fn names(root: &Dir, dir: &str, extensions: &[&str], nested: bool) -> Result<Vec<String>> {
    if root
        .symlink_metadata(dir)
        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
    {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for name in safe_fs::children(root, dir)? {
        let path = format!("{dir}/{name}");
        if let Some(stem) = extensions
            .iter()
            .find_map(|extension| name.strip_suffix(extension))
        {
            if root
                .symlink_metadata(&path)
                .is_ok_and(|meta| meta.is_file())
            {
                found.push(stem.to_owned());
            }
        } else if nested && safe_fs::directory(root, &path).is_ok() {
            for inner in safe_fs::children(root, &path)? {
                if let Some(stem) = extensions
                    .iter()
                    .find_map(|extension| inner.strip_suffix(extension))
                {
                    found.push(format!("{name}:{stem}"));
                }
            }
        }
        if found.len() >= safe_fs::ITEM_COUNT {
            return Err(Error::Limit);
        }
    }
    Ok(found)
}

fn json(root: &Dir, path: &str) -> Result<Option<Value>> {
    let Some(bytes) = safe_fs::read(root, path)? else {
        return Ok(None);
    };
    let text = crate::inventory::text(&bytes)?;
    serde_json::from_str(&strip_jsonc(text))
        .map(Some)
        .map_err(|_| Error::Format)
}

fn keys(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_object)
        .map(|object| object.keys().filter(|key| plain(key)).cloned().collect())
        .unwrap_or_default()
}

fn plain(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

/// Reads one provider's user configuration folder. A part that fails adds a notice and leaves the
/// rest listed; a missing folder lists nothing.
pub fn inspect(provider: Provider, root: &Path) -> Extensions {
    let mut result = Extensions::default();
    let Ok(dir) = open(root) else {
        return result;
    };
    fn note(result: &mut Extensions, what: &str, outcome: Result<Vec<String>>) -> Vec<String> {
        outcome.unwrap_or_else(|error| {
            result.notices.push(format!("{what}: {error}"));
            Vec::new()
        })
    }
    match provider {
        Provider::Claude => {
            result.commands = note(
                &mut result,
                "commands",
                names(&dir, "commands", &[".md"], true),
            );
            result.subagents = note(
                &mut result,
                "agents",
                names(&dir, "agents", &[".md"], false),
            );
            match json(&dir, "settings.json") {
                Ok(settings) => {
                    result.hooks = keys(settings.as_ref().and_then(|value| value.get("hooks")));
                    result.marketplaces = keys(
                        settings
                            .as_ref()
                            .and_then(|value| value.get("extraKnownMarketplaces")),
                    );
                }
                Err(error) => result.notices.push(format!("settings.json: {error}")),
            }
        }
        Provider::Codex => {
            result.subagents = note(
                &mut result,
                "agents",
                names(&dir, "agents", &[".toml"], false),
            );
            match json(&dir, "hooks.json") {
                Ok(hooks) => {
                    result.hooks = keys(
                        hooks
                            .as_ref()
                            .and_then(|value| value.get("hooks").or(Some(value))),
                    );
                }
                Err(error) => result.notices.push(format!("hooks.json: {error}")),
            }
            match safe_fs::read(&dir, "config.toml").and_then(|bytes| {
                bytes
                    .map(|bytes| {
                        crate::inventory::text(&bytes)?
                            .parse::<toml_edit::DocumentMut>()
                            .map_err(|_| Error::Format)
                    })
                    .transpose()
            }) {
                Ok(Some(document)) => {
                    if let Some(table) = document
                        .get("marketplaces")
                        .and_then(|item| item.as_table_like())
                    {
                        result.marketplaces = table
                            .iter()
                            .map(|(key, _)| key.to_owned())
                            .filter(|key| plain(key))
                            .collect();
                    }
                }
                Ok(None) => {}
                Err(error) => result.notices.push(format!("config.toml: {error}")),
            }
        }
        Provider::Pi => {
            result.commands = note(
                &mut result,
                "prompts",
                names(&dir, "prompts", &[".md"], false),
            );
        }
        Provider::Shared => {}
    }
    result
}

/// OpenCode's global folder (`~/.config/opencode`): `opencode.json` or `opencode.jsonc` with its
/// `plugin` array and `mcp` servers, and the `plugins`, `skills`, `commands` and `agents` folders
/// (singular names are still read, as OpenCode does). Source: opencode.ai/docs/config and
/// opencode.ai/docs/plugins, checked 2026-10-28.
pub fn inspect_opencode(root: &Path) -> Extensions {
    let mut result = Extensions::default();
    let Ok(dir) = open(root) else {
        return result;
    };
    let config = match json(&dir, "opencode.json") {
        Ok(Some(value)) => Ok(Some(value)),
        Ok(None) => json(&dir, "opencode.jsonc"),
        Err(error) => Err(error),
    };
    match config {
        Ok(Some(config)) => {
            if let Some(plugins) = config.get("plugin").and_then(Value::as_array) {
                result.plugins.extend(
                    plugins
                        .iter()
                        .filter_map(|plugin| {
                            plugin
                                .as_str()
                                .or_else(|| plugin.get(0).and_then(Value::as_str))
                        })
                        .filter(|name| npm_name(name))
                        .map(str::to_owned),
                );
            }
            if let Some(servers) = config.get("mcp").and_then(Value::as_object) {
                for (name, server) in servers.iter().take(safe_fs::ITEM_COUNT) {
                    if !plain(name) {
                        continue;
                    }
                    let mut fields = Vec::new();
                    for group in ["environment", "headers"] {
                        fields.extend(
                            keys(server.get(group))
                                .into_iter()
                                .map(|key| format!("{group}/{key}")),
                        );
                    }
                    fields.sort();
                    result.servers.push(NamedServer {
                        name: name.clone(),
                        kind: server
                            .get("type")
                            .and_then(Value::as_str)
                            .filter(|kind| plain(kind))
                            .map(str::to_owned),
                        local_fields: fields,
                        enabled: server.get("enabled").and_then(Value::as_bool),
                    });
                }
            }
        }
        Ok(None) => {}
        Err(error) => result.notices.push(format!("opencode.json: {error}")),
    }
    for (plural, singular, extensions, target) in [
        ("plugins", "plugin", &[".js", ".ts"][..], 0),
        ("commands", "command", &[".md"][..], 1),
        ("agents", "agent", &[".md"][..], 2),
    ] {
        for dir_name in [plural, singular] {
            match names(&dir, dir_name, extensions, false) {
                Ok(found) => {
                    let list = match target {
                        0 => &mut result.plugins,
                        1 => &mut result.commands,
                        _ => &mut result.subagents,
                    };
                    for name in found {
                        if !list.contains(&name) {
                            list.push(name);
                        }
                    }
                }
                Err(error) => result.notices.push(format!("{dir_name}: {error}")),
            }
        }
    }
    for dir_name in ["skills", "skill"] {
        if dir
            .symlink_metadata(dir_name)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        {
            continue;
        }
        match safe_fs::children(&dir, dir_name) {
            Ok(children) => {
                for name in children {
                    let manifest = format!("{dir_name}/{name}/SKILL.md");
                    if dir.symlink_metadata(&manifest).is_ok() && !result.skills.contains(&name) {
                        result.skills.push(name);
                    }
                }
            }
            Err(error) => result.notices.push(format!("{dir_name}: {error}")),
        }
    }
    result
}

/// An npm package name, optionally with a version. Anything else (a path, a URL) stays hidden.
fn npm_name(value: &str) -> bool {
    value.len() <= 214
        && !value.starts_with(['.', '/'])
        && !value.contains("://")
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@/._-^~".contains(c))
}

/// JSON with comments and trailing commas, as OpenCode accepts, to plain JSON. Strings are kept
/// byte for byte; only comments outside strings and commas before a closing bracket go.
pub(crate) fn strip_jsonc(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut in_string = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            let width = utf8_width(byte);
            out.push_str(&text[index..index + width]);
            if byte == b'\\' && index + 1 < bytes.len() {
                let next = utf8_width(bytes[index + 1]);
                out.push_str(&text[index + 1..index + 1 + next]);
                index += 1 + next;
                continue;
            }
            if byte == b'"' {
                in_string = false;
            }
            index += width;
            continue;
        }
        match byte {
            b'"' => {
                in_string = true;
                out.push('"');
                index += 1;
            }
            b'/' if bytes.get(index + 1) == Some(&b'/') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
                index += 2;
            }
            b',' => {
                let rest = text[index + 1..].trim_start();
                if !(rest.starts_with('}') || rest.starts_with(']')) {
                    out.push(',');
                }
                index += 1;
            }
            _ => {
                let width = utf8_width(byte);
                out.push_str(&text[index..index + width]);
                index += width;
            }
        }
    }
    out
}

fn utf8_width(byte: u8) -> usize {
    match byte {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonc_comments_and_trailing_commas_are_removed_outside_strings() {
        let text = "{\n // a comment\n \"a\": \"// not a comment\", /* block */ \"b\": [1, 2,],\n \"c\": \"é\\\"q\",\n}";
        let value: Value = serde_json::from_str(&strip_jsonc(text)).unwrap();
        assert_eq!(value["a"], "// not a comment");
        assert_eq!(value["b"], serde_json::json!([1, 2]));
        assert_eq!(value["c"], "é\"q");
    }
}
