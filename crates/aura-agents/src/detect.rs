//! Detection: whether each agent can start here, and the launch spec of one start.
//!
//! Probes run through `run_helper` with the resolved, scrubbed env, 10 s and 64 KiB of output;
//! binaries run in `$HOME`, adapter probes in the adapter folder. Results are cached, and every
//! caller shares the env resolution and the probe in flight. Detection never installs and never
//! runs an adapter: the install happens in [`Detector::prepare_launch`].
//!
//! - `Binary`: found on the env's `PATH`, its version command runs, and it meets its floor.
//! - `NpmAdapter`: Node of the required major or newer; the user's binary (the adapter's variable
//!   when it names an executable file, else the one on `PATH`; `.exe` only on Windows) runs and
//!   meets its floor; `npm` is needed only until the adapter is installed. `Ready` names the user's
//!   binary, the one that will actually run.

use std::path::PathBuf;
use std::sync::Arc;

use aura_process::{EnvResolver, LaunchSpec, LeftoverRegistry};
use aura_protocol::session::{AgentEntry, Availability};
use tokio::runtime::Handle;
use tokio::sync::mpsc;

use crate::catalog::{AgentSpec, Recipe, catalog};
use crate::launch::{self, LaunchError};

/// What this build reports for every agent detection would have to probe.
const NOT_BUILT: &str = "detection is not built in this build";

/// What a built-in agent reports as its path.
const BUILT_IN: &str = "built in";

/// Detects agents and prepares their launches.
#[derive(Debug)]
pub struct Detector {
    mode: Mode,
}

#[derive(Debug)]
enum Mode {
    Live {
        specs: Vec<AgentSpec>,
        #[expect(
            dead_code,
            reason = "detection (package A) probes with the resolved env"
        )]
        env: Arc<EnvResolver>,
        #[expect(dead_code, reason = "detection (package A) registers its probes")]
        registry: Arc<LeftoverRegistry>,
        #[expect(dead_code, reason = "the adapter install (package A) works here")]
        adapters_dir: PathBuf,
        #[expect(dead_code, reason = "detection (package A) runs its probes here")]
        rt: Handle,
    },
    Fixed {
        agents: Vec<FixedAgent>,
    },
}

/// An agent with fixed answers, for tests: no probes, no env, no installs.
#[derive(Debug, Clone)]
pub struct FixedAgent {
    pub spec: AgentSpec,
    pub availability: Availability,
    /// `None` for a built-in agent, or to make `prepare_launch` fail with the availability's reason.
    pub launch: Option<LaunchSpec>,
}

impl Detector {
    /// Detects the catalog's agents. Detection starts once the env resolves; `adapters_dir` is
    /// `<data root>/adapters`.
    ///
    /// This build reports the built-in demo agent `Ready` and every other agent `Missing`: probing
    /// and the adapter install are package A's.
    pub fn new(
        env: Arc<EnvResolver>,
        registry: Arc<LeftoverRegistry>,
        adapters_dir: PathBuf,
        rt: Handle,
    ) -> Arc<Detector> {
        Arc::new(Detector {
            mode: Mode::Live {
                specs: catalog().to_vec(),
                env,
                registry,
                adapters_dir,
                rt,
            },
        })
    }

    /// Tests: these agents with fixed availability and launch specs; no probes, no env, no installs.
    pub fn fixed(agents: Vec<FixedAgent>) -> Arc<Detector> {
        Arc::new(Detector {
            mode: Mode::Fixed { agents },
        })
    }

    /// The agent with this id. The session manager looks agents up here, never in `catalog()`, so
    /// tests can inject their own.
    pub fn spec(&self, id: &str) -> Option<AgentSpec> {
        match &self.mode {
            Mode::Live { specs, .. } => specs.iter().find(|spec| spec.id == id).cloned(),
            Mode::Fixed { agents } => agents
                .iter()
                .find(|agent| agent.spec.id == id)
                .map(|agent| agent.spec.clone()),
        }
    }

    /// Whether `spec` can start here. Cached; shares the env resolution and the probe in flight
    /// with every other caller.
    pub async fn detect(&self, spec: &AgentSpec) -> Availability {
        self.availability(spec)
    }

    /// Every agent, in catalog order. `refresh` re-resolves the env and probes again.
    pub async fn detect_all(&self, _refresh: bool) -> Vec<AgentEntry> {
        self.cached()
    }

    /// The last results, without waiting: `Checking` until the first detection ends.
    pub fn cached(&self) -> Vec<AgentEntry> {
        self.specs()
            .iter()
            .map(|spec| entry(spec, self.availability(spec)))
            .collect()
    }

    /// Installs an npm adapter when it is not installed (one shared attempt per package; `progress`
    /// receives status details), then builds the launch spec. Dropping the future kills a running
    /// install.
    pub async fn prepare_launch(
        &self,
        spec: &AgentSpec,
        _progress: mpsc::UnboundedSender<String>,
    ) -> Result<LaunchSpec, LaunchError> {
        match &self.mode {
            Mode::Fixed { agents } => {
                let Some(agent) = agents.iter().find(|agent| agent.spec.id == spec.id) else {
                    return Err(LaunchError::Missing {
                        reason: format!("auracode doesn't know an agent called \"{}\".", spec.id),
                    });
                };
                match (&agent.launch, &agent.spec.recipe) {
                    (Some(launch), _) => Ok(launch.clone()),
                    (None, Recipe::Builtin) => Ok(launch::builtin(&agent.spec)),
                    (None, _) => Err(unavailable(&agent.availability)),
                }
            }
            Mode::Live { .. } => match spec.recipe {
                Recipe::Builtin => Ok(launch::builtin(spec)),
                Recipe::Binary { .. } | Recipe::NpmAdapter { .. } => Err(LaunchError::Missing {
                    reason: NOT_BUILT.into(),
                }),
            },
        }
    }

    /// Deletes an adapter's install marker, so the next start installs it again (a start failed on
    /// a missing module).
    pub fn forget_install(&self, _spec: &AgentSpec) {}

    fn specs(&self) -> Vec<AgentSpec> {
        match &self.mode {
            Mode::Live { specs, .. } => specs.clone(),
            Mode::Fixed { agents } => agents.iter().map(|agent| agent.spec.clone()).collect(),
        }
    }

    fn availability(&self, spec: &AgentSpec) -> Availability {
        match &self.mode {
            Mode::Fixed { agents } => agents
                .iter()
                .find(|agent| agent.spec.id == spec.id)
                .map_or_else(
                    || Availability::Missing {
                        reason: format!("auracode doesn't know an agent called \"{}\".", spec.id),
                    },
                    |agent| agent.availability.clone(),
                ),
            Mode::Live { .. } => match spec.recipe {
                Recipe::Builtin => Availability::Ready {
                    version: None,
                    path: BUILT_IN.into(),
                },
                Recipe::Binary { .. } | Recipe::NpmAdapter { .. } => Availability::Missing {
                    reason: NOT_BUILT.into(),
                },
            },
        }
    }
}

/// The error for an agent that cannot start, from its availability.
fn unavailable(availability: &Availability) -> LaunchError {
    match availability {
        Availability::Missing { reason } => LaunchError::Missing {
            reason: reason.clone(),
        },
        Availability::Broken { reason } => LaunchError::Broken {
            reason: reason.clone(),
        },
        Availability::Checking | Availability::Ready { .. } => LaunchError::Missing {
            reason: "this test agent has no launch spec".into(),
        },
    }
}

/// An agent as the New chat screen lists it.
fn entry(spec: &AgentSpec, availability: Availability) -> AgentEntry {
    AgentEntry {
        id: spec.id.to_owned(),
        name: spec.name.to_owned(),
        description: spec.description.to_owned(),
        availability,
        launch: launch_label(spec),
        needs_download: false,
        last_verified: spec.last_verified.to_owned(),
    }
}

/// How the agent starts, for display.
fn launch_label(spec: &AgentSpec) -> String {
    match &spec.recipe {
        Recipe::Binary { program, args, .. } => std::iter::once(*program)
            .chain(args.iter().copied())
            .collect::<Vec<_>>()
            .join(" "),
        Recipe::NpmAdapter {
            package,
            version,
            user_binary,
            ..
        } => format!("{package} {version} with your {}", user_binary.program),
        Recipe::Builtin => BUILT_IN.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use aura_process::{EnvMap, EnvSource, ProcessCwd, ResolvedEnv};

    use super::*;
    use crate::catalog::get;

    fn live() -> Arc<Detector> {
        let env = EnvResolver::fixed(ResolvedEnv {
            vars: EnvMap::new(),
            source: EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: Vec::new(),
            resolved_at_ms: 0,
        });
        Detector::new(
            env,
            LeftoverRegistry::disabled(),
            PathBuf::from("/data/adapters"),
            Handle::current(),
        )
    }

    fn progress() -> mpsc::UnboundedSender<String> {
        mpsc::unbounded_channel().0
    }

    #[tokio::test]
    async fn this_build_reports_the_demo_agent_ready_and_the_rest_missing() {
        let detector = live();
        let entries = detector.detect_all(false).await;
        let ids: Vec<&str> = entries.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids, ["hermes", "claude-acp", "codex-acp", "mock"]);
        for entry in &entries {
            if entry.id == "mock" {
                assert!(matches!(entry.availability, Availability::Ready { .. }));
            } else {
                assert_eq!(
                    entry.availability,
                    Availability::Missing {
                        reason: NOT_BUILT.into()
                    }
                );
            }
        }
        assert_eq!(entries[0].launch, "hermes acp");
        assert_eq!(
            entries[1].launch,
            "@agentclientprotocol/claude-agent-acp 0.95.0 with your claude"
        );
        assert_eq!(detector.cached(), entries);

        let mock = detector.spec("mock").expect("mock");
        let launch = detector
            .prepare_launch(&mock, progress())
            .await
            .expect("the demo agent starts");
        assert_eq!(launch.label, "mock");
        assert_eq!(launch.program, PathBuf::new());
        assert_eq!(launch.cwd, ProcessCwd::ChatFolder);
        assert_eq!(launch.startup_timeout, Duration::from_secs(5));

        let hermes = detector.spec("hermes").expect("hermes");
        assert!(matches!(
            detector.prepare_launch(&hermes, progress()).await,
            Err(LaunchError::Missing { .. })
        ));
        assert!(matches!(
            detector.detect(&hermes).await,
            Availability::Missing { .. }
        ));
        assert!(detector.spec("cursor").is_none());
    }

    #[tokio::test]
    async fn fixed_agents_answer_as_given() {
        let hermes = get("hermes").expect("hermes").clone();
        let launch = LaunchSpec {
            label: "hermes acp".into(),
            program: PathBuf::from("/opt/bin/hermes"),
            args: vec!["acp".into()],
            cwd: ProcessCwd::ChatFolder,
            set_env: Vec::new(),
            daemons: hermes.daemons.clone(),
            startup_timeout: hermes.startup_timeout,
        };
        let broken = AgentSpec {
            id: "broken",
            ..get("codex-acp").expect("codex").clone()
        };
        let detector = Detector::fixed(vec![
            FixedAgent {
                spec: hermes.clone(),
                availability: Availability::Ready {
                    version: Some("0.22.5".into()),
                    path: "/opt/bin/hermes".into(),
                },
                launch: Some(launch.clone()),
            },
            FixedAgent {
                spec: broken.clone(),
                availability: Availability::Broken {
                    reason: "auracode needs Codex 0.160.1 or newer (found 0.1.0).".into(),
                },
                launch: None,
            },
            FixedAgent {
                spec: get("mock").expect("mock").clone(),
                availability: Availability::Checking,
                launch: None,
            },
        ]);
        assert_eq!(detector.spec("hermes"), Some(hermes.clone()));
        assert!(
            detector.spec("claude-acp").is_none(),
            "only the given agents"
        );
        assert_eq!(
            detector.prepare_launch(&hermes, progress()).await,
            Ok(launch)
        );
        assert_eq!(
            detector.prepare_launch(&broken, progress()).await,
            Err(LaunchError::Broken {
                reason: "auracode needs Codex 0.160.1 or newer (found 0.1.0).".into()
            })
        );
        let mock = detector.spec("mock").expect("mock");
        assert_eq!(
            detector
                .prepare_launch(&mock, progress())
                .await
                .map(|launch| launch.label),
            Ok("mock".to_owned())
        );
        let ids: Vec<String> = detector
            .detect_all(true)
            .await
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, ["hermes", "broken", "mock"]);
        assert_eq!(detector.detect(&mock).await, Availability::Checking);
        let stranger = AgentSpec {
            id: "stranger",
            ..mock
        };
        assert!(matches!(
            detector.prepare_launch(&stranger, progress()).await,
            Err(LaunchError::Missing { .. })
        ));
        detector.forget_install(&broken);
    }
}
