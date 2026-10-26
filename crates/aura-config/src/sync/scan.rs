//! Explicit bounded discovery. Every deletion decision is checked again against its own source;
//! absence from this list, malformed documents and missing agents are never proof of uninstall.
use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
};

use cap_std::fs::Dir;
use serde_json::{Value, value::RawValue};

use super::{
    ConfigContent, ConfigFile, ConfigFormat, ConfigIdentity, ConfigPortError, ConfigScope,
    ConfigSnapshot, LocalSnapshot,
    snapshot::{forbidden_key, validate_value},
};
use crate::{Error, Provider, Scope, Source, inventory, mcp_document::RawObject, safe_fs};

const SCAN_BYTES: usize = 16 * 1024 * 1024;
const SCAN_FULL: &str =
    "Configuration discovery reached its item or byte limit. Remaining items are retained.";

#[derive(Clone)]
pub struct ConfigSource {
    pub source: Source,
    /// Supplied by native agent discovery, never inferred from a leftover config folder.
    pub installed: bool,
}

pub struct ConfigScanner {
    pub(crate) sources: Vec<ConfigSource>,
    pub(crate) home: PathBuf,
    pub(crate) platform: ConfigScope,
}

pub struct ConfigScan {
    pub items: BTreeMap<String, ConfigSnapshot>,
    pub skipped: Vec<ConfigSkipped>,
}

#[derive(Debug, Clone)]
pub struct ConfigSkipped {
    pub provider: Provider,
    pub identity: Option<ConfigIdentity>,
    /// Fixed reason, never a vendor message, credential value or absolute path.
    pub reason: String,
}

impl ConfigScanner {
    pub fn new(
        sources: Vec<ConfigSource>,
        home: PathBuf,
        platform: ConfigScope,
    ) -> Result<Self, ConfigPortError> {
        let mut unique = HashSet::new();
        if !home.is_absolute()
            || home.to_str().is_none()
            || platform == ConfigScope::Portable
            || sources.len() > 5
            || sources.iter().any(|entry| {
                entry.source.scope != Scope::User
                    || !entry.source.root.is_absolute()
                    || entry.source.claude_state_only && entry.source.provider != Provider::Claude
                    || !unique.insert((
                        format!("{:?}", entry.source.provider),
                        entry.source.claude_state_only,
                    ))
            })
        {
            return Err(ConfigPortError::Invalid);
        }
        Ok(Self {
            sources,
            home,
            platform,
        })
    }

    pub fn scan(&self) -> ConfigScan {
        let mut scan = ConfigScan {
            items: BTreeMap::new(),
            skipped: Vec::new(),
        };
        let mut bytes = 0usize;
        for source in &self.sources {
            let provider = source.source.provider;
            if !source.installed {
                skip(
                    &mut scan,
                    provider,
                    None,
                    "Install this agent to apply its waiting configuration.",
                );
                continue;
            }
            let Ok(root) = inventory::open(&source.source) else {
                skip(
                    &mut scan,
                    provider,
                    None,
                    "This configuration folder is unavailable. Existing synced items are retained.",
                );
                continue;
            };
            let candidates = self.candidates(source, &root);
            for candidate in candidates {
                let (identity, content) = match candidate {
                    Ok(candidate) => candidate,
                    Err((identity, reason)) => {
                        skip(&mut scan, provider, identity, reason);
                        continue;
                    }
                };
                let snapshot = ConfigSnapshot {
                    schema: 1,
                    identity,
                    content: Some(content),
                };
                let encoded = match snapshot.encode() {
                    Ok(value) => value,
                    Err(_) => {
                        skip(
                            &mut scan,
                            provider,
                            Some(snapshot.identity),
                            "This item is protected, unsupported or exceeds the sync limit.",
                        );
                        continue;
                    }
                };
                if scan.items.len() >= safe_fs::ITEM_COUNT || bytes + encoded.len() > SCAN_BYTES {
                    skip(
                        &mut scan,
                        provider,
                        None,
                        "Configuration discovery reached its item or byte limit. Remaining items are retained.",
                    );
                    return scan;
                }
                bytes += encoded.len();
                if let Ok(id) = snapshot.identity.id() {
                    scan.items.insert(id, snapshot);
                }
            }
        }
        scan
    }

    /// This is the only way to establish local absence for a known remote/base identity. Re-read at
    /// apply time. A failed read returns Unavailable and must never be replaced by an empty item.
    pub fn observe(&self, identity: &ConfigIdentity) -> Result<LocalSnapshot, ConfigPortError> {
        identity.validate()?;
        if !identity.applies_on(self.platform) {
            return Ok(LocalSnapshot::Unavailable);
        }
        let Some(source) = self.source(identity) else {
            return Ok(LocalSnapshot::Unavailable);
        };
        if !source.installed {
            return Ok(LocalSnapshot::Unavailable);
        }
        let Ok(root) = inventory::open(&source.source) else {
            return Ok(LocalSnapshot::Unavailable);
        };
        let content = match read_content(&root, identity) {
            Ok(None) => return Ok(LocalSnapshot::Absent),
            Ok(Some(value)) => value,
            Err(_) => return Ok(LocalSnapshot::Unavailable),
        };
        let Ok((mut observed, content)) = self.normalize(identity.clone(), content) else {
            return Ok(LocalSnapshot::Unavailable);
        };
        // A portable record cannot overwrite an item that now contains platform-specific paths.
        // A previously explicit OS scope remains stable if an edit becomes portable.
        if observed.scope == ConfigScope::Portable {
            observed.scope = identity.scope;
        }
        if observed != *identity {
            return Ok(LocalSnapshot::Unavailable);
        }
        let snapshot = ConfigSnapshot {
            schema: 1,
            identity: observed,
            content: Some(content),
        };
        if snapshot.encode().is_err() {
            return Ok(LocalSnapshot::Unavailable);
        }
        Ok(LocalSnapshot::Present(snapshot))
    }

    pub(crate) fn source(&self, identity: &ConfigIdentity) -> Option<&ConfigSource> {
        let state_only =
            identity.provider == Provider::Claude && identity.format == ConfigFormat::Mcp;
        self.sources.iter().find(|entry| {
            entry.source.provider == identity.provider
                && entry.source.claude_state_only == state_only
        })
    }

    fn candidates(&self, source: &ConfigSource, root: &Dir) -> Vec<Candidate> {
        let provider = source.source.provider;
        let mut candidates = Candidates::default();
        if source.source.claude_state_only {
            self.mcp_candidates(root, provider, ".claude.json", &mut candidates);
            return candidates.items;
        }
        let (files, directories, documents): (&[&str], &[&str], &[&str]) = match provider {
            Provider::Claude => (
                &["CLAUDE.md"],
                &["rules", "commands", "agents", "output-styles"],
                &["settings.json", "keybindings.json"],
            ),
            Provider::Codex => (
                &["AGENTS.md", "AGENTS.override.md"],
                &["agents", "rules"],
                &["config.toml", "hooks.json"],
            ),
            Provider::Pi => (
                &[
                    "AGENTS.md",
                    "AGENTS.override.md",
                    "SYSTEM.md",
                    "APPEND_SYSTEM.md",
                ],
                &["prompts", "themes", "extensions"],
                &["settings.json", "keybindings.json", "models.json"],
            ),
            Provider::Shared => (&[], &[], &[]),
        };
        for path in files {
            self.file_candidate(root, provider, path, &mut candidates);
        }
        for directory in directories {
            if candidates.full {
                return candidates.items;
            }
            if missing(root, directory) {
                continue;
            }
            match safe_fs::tree(root, directory) {
                Ok(files) => for file in files {
                    if candidates.full { return candidates.items; }
                    let path = format!("{directory}/{}", file.path);
                    self.push_content(identity(provider, ConfigFormat::File, &path, Vec::new()),
                        ConfigContent::Files(BTreeMap::from([("".into(), ConfigFile {
                            bytes: file.bytes, executable: file.executable })])), &mut candidates);
                },
                Err(_) => candidates.push(Err((None, "A configuration directory could not be fully inspected. Its items are retained."))),
            }
        }
        let skill_root = if provider == Provider::Shared {
            ""
        } else {
            "skills"
        };
        if skill_root.is_empty() || !missing(root, skill_root) {
            match safe_fs::children(root, skill_root) {
                Ok(names) => {
                    for name in names {
                        if candidates.full {
                            return candidates.items;
                        }
                        let path = if skill_root.is_empty() {
                            name
                        } else {
                            format!("{skill_root}/{name}")
                        };
                        let id = identity(provider, ConfigFormat::Tree, &path, Vec::new());
                        match read_content(root, &id) {
                        Ok(Some(content)) => self.push_content(id, content, &mut candidates),
                        Ok(None) => {},
                        Err(_) => candidates.push(Err((Some(id), "This skill is incomplete, protected or too large. Its previous version is retained."))),
                    }
                    }
                }
                Err(_) => candidates.push(Err((
                    None,
                    "The skills folder is unavailable. Existing synced skills are retained.",
                ))),
            }
        }
        for path in documents {
            if candidates.full {
                return candidates.items;
            }
            let format = if path.ends_with(".toml") {
                ConfigFormat::Toml
            } else {
                ConfigFormat::Json
            };
            let value = match read_document(root, path, format) {
                Ok(Some(value)) => value,
                Ok(None) => continue,
                Err(_) => {
                    candidates.push(Err((None, "A settings document is malformed or unavailable. Its synced fields are retained.")));
                    continue;
                }
            };
            let mut values = Vec::new();
            flatten(&value, &mut Vec::new(), &mut values, 0);
            for (keys, value) in values {
                if keys.is_empty() || format == ConfigFormat::Toml && keys[0] == "mcp_servers" {
                    continue;
                }
                let id = identity(provider, format, path, keys);
                self.push_content(id, ConfigContent::Value(value), &mut candidates);
                if candidates.full {
                    return candidates.items;
                }
            }
        }
        match provider {
            Provider::Codex => self.mcp_candidates(root, provider, "config.toml", &mut candidates),
            Provider::Pi => self.mcp_candidates(root, provider, "mcp.json", &mut candidates),
            _ => {}
        }
        candidates.items
    }

    fn file_candidate(
        &self,
        root: &Dir,
        provider: Provider,
        path: &str,
        candidates: &mut Candidates,
    ) {
        let id = identity(provider, ConfigFormat::File, path, Vec::new());
        match read_content(root, &id) {
            Ok(Some(value)) => self.push_content(id, value, candidates),
            Ok(None) => {}
            Err(_) => candidates.push(Err((
                Some(id),
                "This file could not be safely inspected. Its previous version is retained.",
            ))),
        }
    }

    fn mcp_candidates(
        &self,
        root: &Dir,
        provider: Provider,
        path: &str,
        candidates: &mut Candidates,
    ) {
        let format = if provider == Provider::Codex {
            ConfigFormat::Toml
        } else {
            ConfigFormat::Json
        };
        let document = match read_document(root, path, format) {
            Ok(Some(document)) => document,
            Ok(None) => return,
            Err(_) => {
                candidates.push(Err((
                    None,
                    "The MCP document is malformed or unavailable. Existing servers are retained.",
                )));
                return;
            }
        };
        let group = if provider == Provider::Codex {
            "mcp_servers"
        } else {
            "mcpServers"
        };
        let Some(entries) = document.get(group) else {
            return;
        };
        let Some(entries) = entries.as_object() else {
            candidates.push(Err((
                None,
                "The MCP entries are malformed. Existing servers are retained.",
            )));
            return;
        };
        for (key, value) in entries {
            if candidates.full {
                return;
            }
            let id = identity(provider, ConfigFormat::Mcp, path, vec![key.clone()]);
            self.push_content(id, ConfigContent::Value(value.clone()), candidates);
        }
    }

    fn push_content(
        &self,
        id: ConfigIdentity,
        content: ConfigContent,
        candidates: &mut Candidates,
    ) {
        let original = id.clone();
        match self.normalize(id, content) {
            Ok(candidate) => candidates.push(Ok(candidate)),
            Err(_) => candidates.push(Err((Some(original), "This item contains protected fields or incompatible paths and stays on this device."))),
        }
    }

    fn normalize(
        &self,
        mut id: ConfigIdentity,
        mut content: ConfigContent,
    ) -> Result<(ConfigIdentity, ConfigContent), ConfigPortError> {
        let mut scope = ConfigScope::Portable;
        if let ConfigContent::Value(value) = &mut content {
            validate_value(value, 0)?;
            normalize_value(
                value,
                self.home.to_str().ok_or(ConfigPortError::Invalid)?,
                &mut scope,
            )?;
        }
        if let ConfigContent::Files(files) = &content {
            for file in files.values() {
                if let Ok(text) = std::str::from_utf8(&file.bytes) {
                    if text.starts_with("#!/") {
                        choose_scope(&mut scope, ConfigScope::Macos)?;
                    }
                    if id.path.ends_with(".ps1")
                        || id.path.ends_with(".cmd")
                        || id.path.ends_with(".bat")
                    {
                        choose_scope(&mut scope, ConfigScope::Windows)?;
                    }
                }
            }
        }
        id.scope = scope;
        Ok((id, content))
    }
}

type Candidate = Result<(ConfigIdentity, ConfigContent), (Option<ConfigIdentity>, &'static str)>;

#[derive(Default)]
struct Candidates {
    items: Vec<Candidate>,
    bytes: usize,
    full: bool,
}
impl Candidates {
    fn push(&mut self, candidate: Candidate) {
        if self.full {
            return;
        }
        let size = match &candidate {
            Ok((identity, ConfigContent::Files(files))) => {
                identity.path.len()
                    + files
                        .iter()
                        .map(|(path, file)| path.len() + file.bytes.len().saturating_mul(4) + 64)
                        .sum::<usize>()
            }
            Ok((identity, ConfigContent::Value(value))) => {
                identity.path.len()
                    + serde_json::to_vec(value).map_or(SCAN_BYTES, |bytes| bytes.len())
                    + 1024
            }
            Err(_) => 256,
        };
        if self.items.len() >= safe_fs::ITEM_COUNT || self.bytes.saturating_add(size) > SCAN_BYTES {
            self.full = true;
            self.items.push(Err((None, SCAN_FULL)));
            return;
        }
        self.bytes += size;
        self.items.push(candidate);
    }
}

fn identity(
    provider: Provider,
    format: ConfigFormat,
    path: &str,
    keys: Vec<String>,
) -> ConfigIdentity {
    ConfigIdentity {
        provider,
        scope: ConfigScope::Portable,
        format,
        path: path.into(),
        keys,
    }
}
fn skip(scan: &mut ConfigScan, provider: Provider, identity: Option<ConfigIdentity>, reason: &str) {
    if scan.skipped.len() < 512 {
        scan.skipped.push(ConfigSkipped {
            provider,
            identity,
            reason: reason.into(),
        });
    }
}
fn missing(root: &Dir, path: &str) -> bool {
    root.symlink_metadata(path)
        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
}

pub(super) fn read_content(
    root: &Dir,
    id: &ConfigIdentity,
) -> crate::Result<Option<ConfigContent>> {
    match id.format {
        ConfigFormat::File => Ok(safe_fs::read_file(root, &id.path)?.map(|file| {
            ConfigContent::Files(BTreeMap::from([(
                "".into(),
                ConfigFile {
                    bytes: file.bytes,
                    executable: file.executable,
                },
            )]))
        })),
        ConfigFormat::Tree => {
            if missing(root, &id.path) {
                return Ok(None);
            }
            let files = safe_fs::tree(root, &id.path)?;
            if !files.iter().any(|file| file.path == "SKILL.md") {
                return Err(Error::Format);
            }
            Ok(Some(ConfigContent::Files(
                files
                    .into_iter()
                    .map(|file| {
                        (
                            file.path,
                            ConfigFile {
                                bytes: file.bytes,
                                executable: file.executable,
                            },
                        )
                    })
                    .collect(),
            )))
        }
        ConfigFormat::Mcp => {
            let Some(bytes) = safe_fs::read(root, &id.path)? else {
                return Ok(None);
            };
            crate::mcp_document::selected(&bytes, id.provider, &id.keys[0])
                .map(|value| value.map(ConfigContent::Value))
        }
        ConfigFormat::Json | ConfigFormat::Toml => {
            let Some(value) = read_document(root, &id.path, id.format)? else {
                return Ok(None);
            };
            let mut selected = &value;
            for key in &id.keys {
                let object = selected.as_object().ok_or(Error::Format)?;
                let Some(next) = object.get(key) else {
                    return Ok(None);
                };
                selected = next;
            }
            Ok(Some(ConfigContent::Value(selected.clone())))
        }
    }
}

fn read_document(root: &Dir, path: &str, format: ConfigFormat) -> crate::Result<Option<Value>> {
    let Some(bytes) = safe_fs::read(root, path)? else {
        return Ok(None);
    };
    let text = inventory::text(&bytes)?;
    if format == ConfigFormat::Toml {
        let document = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| Error::Format)?;
        let mut value = serde_json::Map::new();
        for (key, item) in document.iter() {
            if let Ok(item) = crate::mcp::toml_json(item) {
                value.insert(key.into(), item);
            } else {
                return Err(Error::Format);
            }
        }
        Ok(Some(Value::Object(value)))
    } else {
        let raw: &RawValue = serde_json::from_str(text).map_err(|_| Error::Format)?;
        strict_value(raw, 0).map(Some)
    }
}

fn strict_value(raw: &RawValue, depth: usize) -> crate::Result<Value> {
    if depth > 16 {
        return Err(Error::Limit);
    }
    let text = raw.get().trim_start();
    if text.starts_with('{') {
        let object: RawObject<'_> = serde_json::from_str(text).map_err(|_| Error::Format)?;
        if object.0.len() > 2048 {
            return Err(Error::Limit);
        }
        let mut result = serde_json::Map::new();
        for (key, value) in object.0 {
            result.insert(key, strict_value(value, depth + 1)?);
        }
        Ok(Value::Object(result))
    } else if text.starts_with('[') {
        let values: Vec<&RawValue> = serde_json::from_str(text).map_err(|_| Error::Format)?;
        if values.len() > 1024 {
            return Err(Error::Limit);
        }
        values
            .into_iter()
            .map(|value| strict_value(value, depth + 1))
            .collect::<crate::Result<Vec<_>>>()
            .map(Value::Array)
    } else {
        serde_json::from_str(text).map_err(|_| Error::Format)
    }
}

fn flatten(
    value: &Value,
    keys: &mut Vec<String>,
    values: &mut Vec<(Vec<String>, Value)>,
    depth: usize,
) {
    if values.len() >= safe_fs::ITEM_COUNT || depth > 16 {
        return;
    }
    let atomic = keys.len() >= 2
        && keys.first().is_some_and(|key| {
            matches!(
                key.as_str(),
                "enabledPlugins" | "extraKnownMarketplaces" | "mcp_servers"
            )
        });
    if let Value::Object(object) = value {
        // Objects are containers of setting-key identities. Empty containers do not become
        // overlapping parent items; absence of an old leaf is established by observe instead.
        if object.is_empty() && !atomic {
            return;
        }
        if !object.is_empty() && !atomic {
            for (key, value) in object {
                if forbidden_key(key) {
                    continue;
                }
                keys.push(key.clone());
                flatten(value, keys, values, depth + 1);
                keys.pop();
            }
            return;
        }
    }
    values.push((keys.clone(), value.clone()));
}

fn normalize_value(
    value: &mut Value,
    home: &str,
    scope: &mut ConfigScope,
) -> Result<(), ConfigPortError> {
    match value {
        Value::String(value) => {
            let portable = value.replace('\\', "/");
            let home = home.replace('\\', "/");
            let prefix = format!("{}/", home.trim_end_matches('/'));
            if portable == home || portable.starts_with(&prefix) {
                *value = format!("~{}", &portable[home.len()..]);
            } else if portable.as_bytes().get(1) == Some(&b':')
                && portable.as_bytes().get(2) == Some(&b'/')
                || portable.starts_with("//")
                || matches!(
                    portable.to_ascii_lowercase().as_str(),
                    "powershell.exe" | "cmd.exe" | "pwsh.exe"
                )
            {
                choose_scope(scope, ConfigScope::Windows)?;
            } else if [
                "/Users/",
                "/Applications/",
                "/opt/homebrew/",
                "/usr/",
                "/bin/",
            ]
            .iter()
            .any(|prefix| portable.starts_with(prefix))
            {
                choose_scope(scope, ConfigScope::Macos)?;
            }
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                normalize_value(value, home, scope)?;
            }
        }
        Value::Array(array) => {
            for value in array {
                normalize_value(value, home, scope)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn choose_scope(current: &mut ConfigScope, next: ConfigScope) -> Result<(), ConfigPortError> {
    if *current != ConfigScope::Portable && *current != next {
        return Err(ConfigPortError::Invalid);
    }
    *current = next;
    Ok(())
}
