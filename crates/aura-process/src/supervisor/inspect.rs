//! Read-only discovery facts resolved on Linux. Exports paths, never an environment map or the
//! contents of provider settings, credentials or transcripts.

use std::collections::BTreeMap;
use std::io;

use serde::{Deserialize, Serialize};

use super::wire::{PROTOCOL_VERSION, invalid};
use crate::ResolvedEnv;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InspectRequest {
    pub protocol: u32,
    pub cwd: String,
    /// Bare executable names selected by the catalog. Discovery never executes them.
    pub executables: Vec<String>,
}

impl InspectRequest {
    pub fn validate(&self) -> io::Result<()> {
        if self.protocol != PROTOCOL_VERSION
            || !self.cwd.starts_with('/')
            || self.cwd.contains('\0')
            || self.executables.len() > 64
            || self.executables.iter().any(|name| {
                name.is_empty()
                    || name.len() > 256
                    || name.starts_with('-')
                    || name
                        .chars()
                        .any(|c| c.is_control() || matches!(c, '/' | '\\'))
                    || matches!(name.as_str(), "." | "..")
            })
        {
            return Err(invalid("invalid supervisor inspection request"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutablePath {
    pub name: String,
    /// Keep the user's stable symlink as the launch path.
    pub launch_path: String,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostInspection {
    pub protocol: u32,
    pub canonical_cwd: String,
    /// Known provider configuration roots only. Their spelling remains Linux case sensitive.
    pub config_roots: BTreeMap<String, String>,
    pub executables: Vec<ExecutablePath>,
}

/// Blocking metadata work, called on the supervisor's blocking pool. No CLI or shell is started.
pub fn inspect(request: &InspectRequest, env: &ResolvedEnv) -> io::Result<HostInspection> {
    request.validate()?;
    #[cfg(target_os = "linux")]
    {
        linux(request, env)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = env;
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "host inspection requires Linux",
        ))
    }
}

#[cfg(target_os = "linux")]
fn linux(request: &InspectRequest, env: &ResolvedEnv) -> io::Result<HostInspection> {
    use crate::{EnvKey, find_program};
    use std::path::{Component, Path, PathBuf};

    fn text(path: &Path) -> io::Result<String> {
        path.to_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| invalid("host path is not UTF-8"))
    }
    fn identity(path: PathBuf) -> io::Result<String> {
        let path = path
            .ancestors()
            .find_map(|ancestor| {
                std::fs::canonicalize(ancestor)
                    .ok()
                    .and_then(|root| path.strip_prefix(ancestor).ok().map(|tail| root.join(tail)))
            })
            .unwrap_or(path);
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                other => normalized.push(other.as_os_str()),
            }
        }
        text(&normalized)
    }
    let cwd = std::fs::canonicalize(&request.cwd)?;
    if !cwd.is_dir() {
        return Err(invalid("host working directory is not a directory"));
    }
    let variable = |name: &str| {
        env.vars
            .get(&EnvKey::from(name))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    let mut config_roots = BTreeMap::new();
    for (provider, variable_name, default) in [
        ("claude", "CLAUDE_CONFIG_DIR", ".claude"),
        ("codex", "CODEX_HOME", ".codex"),
    ] {
        if let Some(path) =
            variable(variable_name).or_else(|| variable("HOME").map(|home| home.join(default)))
        {
            let absolute = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            config_roots.insert(provider.into(), identity(absolute)?);
        }
    }
    let mut executables = Vec::new();
    for name in &request.executables {
        if let Some(path) = find_program(name, &env.vars) {
            executables.push(ExecutablePath {
                name: name.clone(),
                launch_path: text(&path)?,
                resolved_path: std::fs::canonicalize(&path)
                    .ok()
                    .and_then(|path| text(&path).ok()),
            });
        }
    }
    Ok(HostInspection {
        protocol: PROTOCOL_VERSION,
        canonical_cwd: text(&cwd)?,
        config_roots,
        executables,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_accepts_only_bounded_catalog_names_and_linux_folders() {
        let mut request = InspectRequest {
            protocol: PROTOCOL_VERSION,
            cwd: "/workspace".into(),
            executables: vec!["claude".into()],
        };
        request.validate().expect("valid");
        for name in ["../agent", "/usr/bin/agent", "a\nb", "-x", ".."] {
            request.executables = vec![name.into()];
            assert!(request.validate().is_err());
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn inspection_preserves_linux_case_and_exports_no_credential_environment() {
        use crate::{EnvKey, EnvSource};
        let dir = tempfile::tempdir().expect("folder");
        let alias = dir.path().join("alias");
        std::os::unix::fs::symlink(dir.path(), &alias).expect("alias");
        let env = ResolvedEnv {
            vars: [
                (EnvKey::from("HOME"), dir.path().as_os_str().to_owned()),
                (
                    EnvKey::from("CLAUDE_CONFIG_DIR"),
                    alias.join("NewConfig").into_os_string(),
                ),
                (
                    EnvKey::from("ANTHROPIC_API_KEY"),
                    "private-value-never-exported".into(),
                ),
            ]
            .into(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        };
        let request = InspectRequest {
            protocol: PROTOCOL_VERSION,
            cwd: alias.to_string_lossy().into_owned(),
            executables: Vec::new(),
        };
        let result = inspect(&request, &env).expect("inspection");
        assert_eq!(result.canonical_cwd, dir.path().to_string_lossy());
        assert!(result.config_roots["claude"].ends_with("/NewConfig"));
        let body = serde_json::to_string(&result).expect("json");
        assert!(!body.contains("ANTHROPIC_API_KEY"));
        assert!(!body.contains("private-value"));
    }
}
