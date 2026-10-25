//! A fake machine for detection and install tests: a `PATH` folder of fake tools (this crate's
//! test binary copied as `node`, `npm`, `claude`, `codex` and `hermes`), a home, an adapters folder,
//! and the folder the fakes read their behaviour from and log into. Nothing real ever runs.

#![allow(dead_code, reason = "each test file uses its own part of the helpers")]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use aura_agents::{AgentSpec, Detector, get};
use aura_process::{EnvKey, EnvMap, EnvResolver, EnvSource, LeftoverRegistry, ResolvedEnv};
use tokio::runtime::Handle;

pub const TOOLS: &[&str] = &["node", "npm", "claude", "codex", "hermes"];

pub struct Machine {
    pub root: tempfile::TempDir,
    pub bin: PathBuf,
    pub home: PathBuf,
    pub adapters: PathBuf,
    pub fake: PathBuf,
}

impl Machine {
    /// A machine with every fake tool on `PATH`.
    pub fn new() -> Machine {
        Machine::with_tools(TOOLS)
    }

    pub fn with_tools(tools: &[&str]) -> Machine {
        let root = tempfile::tempdir().expect("tempdir");
        let bin = root.path().join("bin");
        let home = root.path().join("home");
        let adapters = root.path().join("data").join("adapters");
        let fake = root.path().join("fake");
        for dir in [&bin, &home, &fake] {
            std::fs::create_dir_all(dir).expect("mkdir");
        }
        let machine = Machine {
            root,
            bin,
            home,
            adapters,
            fake,
        };
        for tool in tools {
            machine.install_tool(&machine.bin, tool);
        }
        machine
    }

    /// Copies the fake under `name` into `dir`.
    pub fn install_tool(&self, dir: &Path, name: &str) -> PathBuf {
        std::fs::create_dir_all(dir).expect("mkdir");
        let path = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
        std::fs::copy(env!("CARGO_BIN_EXE_aura-agents-testbin"), &path).expect("copy");
        path
    }

    pub fn tool(&self, name: &str) -> PathBuf {
        self.bin
            .join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
    }

    /// Sets what a fake does (`ok`, `fail`, `hang`, ...).
    pub fn mode(&self, tool: &str, mode: &str) {
        std::fs::write(self.fake.join(format!("{tool}.mode")), mode).expect("write");
    }

    /// Sets what a fake's `--version` prints.
    pub fn version(&self, tool: &str, printed: &str) {
        std::fs::write(self.fake.join(format!("{tool}.version")), printed).expect("write");
    }

    /// Every run of a fake: its cwd, argv and npm's update-notifier setting.
    pub fn runs(&self, tool: &str) -> Vec<serde_json::Value> {
        std::fs::read_to_string(self.fake.join(format!("{tool}.log")))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).expect("a run"))
            .collect()
    }

    /// The env: the test's own, with this machine's `PATH` and home and no user binary variables.
    pub fn env(&self, extra: &[(&str, &str)]) -> ResolvedEnv {
        self.env_with_path(&[&self.bin], extra)
    }

    pub fn env_with_path(&self, path: &[&Path], extra: &[(&str, &str)]) -> ResolvedEnv {
        let mut vars: EnvMap = aura_process::process_env();
        for name in [
            "CLAUDE_CODE_EXECUTABLE",
            "CODEX_PATH",
            "HOME",
            "USERPROFILE",
        ] {
            vars.remove(&EnvKey::from(name));
        }
        vars.insert(
            EnvKey::from("PATH"),
            std::env::join_paths(path).expect("join"),
        );
        vars.insert(EnvKey::from("HOME"), self.home.clone().into_os_string());
        vars.insert(
            EnvKey::from("USERPROFILE"),
            self.home.clone().into_os_string(),
        );
        vars.insert(
            EnvKey::from("AURA_FAKE_DIR"),
            self.fake.clone().into_os_string(),
        );
        for (name, value) in extra {
            vars.insert(EnvKey::from(*name), OsString::from(*value));
        }
        ResolvedEnv {
            vars,
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        }
    }

    pub fn detector(&self, env: ResolvedEnv) -> Arc<Detector> {
        Detector::new(
            EnvResolver::fixed(env),
            LeftoverRegistry::disabled(),
            self.adapters.clone(),
            Handle::current(),
        )
    }

    /// The install folder of an adapter.
    pub fn adapter_folder(&self, name: &str) -> PathBuf {
        self.adapters.join(name)
    }

    /// The pids a hanging fake wrote, once they are there.
    pub async fn pids(&self, tool: &str) -> Vec<u32> {
        let path = self.fake.join(format!("{tool}.pids"));
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            if let Ok(text) = std::fs::read_to_string(&path) {
                return text
                    .split_whitespace()
                    .map(|pid| pid.parse().expect("pid"))
                    .collect();
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "{} never appeared",
                path.display()
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

pub fn spec(id: &str) -> AgentSpec {
    get(id).expect("a catalog agent").clone()
}

/// Whether `pid` runs (a zombie has exited already).
#[cfg(unix)]
pub fn alive(pid: u32) -> bool {
    let output = std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("ps");
    let state = String::from_utf8_lossy(&output.stdout);
    let state = state.trim();
    !state.is_empty() && !state.starts_with('Z')
}

#[cfg(windows)]
pub fn alive(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .expect("tasklist");
    String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
}

/// Polls until `pid` is gone; whether that happened within 5 s.
pub async fn gone(pid: u32) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if !alive(pid) {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Kills `pid` if a test left it running (a failed assertion).
pub fn kill(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
}

/// Kills the pids it holds when dropped, so a failing test leaves nothing behind.
#[derive(Default)]
pub struct Reaper(pub Vec<u32>);

impl Drop for Reaper {
    fn drop(&mut self) {
        for pid in &self.0 {
            if alive(*pid) {
                kill(*pid);
            }
        }
    }
}
