//! Explicit vendor login preparation. No authentication command runs while inspecting this plan.
use super::{SessionError, SessionManager};
use aura_agents::maintenance::{check_unchanged, login_command};
use aura_process::{LaunchSpec, ProcessCwd, SpawnSpec};
use aura_protocol::session::Availability;
use std::path::PathBuf;
use std::time::Duration;

impl SessionManager {
    /// Resolve only the already-detected native installation. The terminal owner must invoke this
    /// for an explicit user action, then launch the returned argv without shell interpolation.
    pub async fn prepare_login(&self, agent_id: &str) -> Result<SpawnSpec, SessionError> {
        if self.shared().is_shutting_down() {
            return Err(SessionError::ShuttingDown);
        }
        let agent = self
            .deps()
            .detector
            .cached()
            .into_iter()
            .find(|entry| entry.id == agent_id)
            .ok_or_else(|| SessionError::UnknownAgent(agent_id.into()))?;
        if !matches!(agent.availability, Availability::Ready { .. }) {
            return Err(SessionError::AgentUnavailable(
                "Refresh agents before signing in.".into(),
            ));
        }
        let installation = agent.installation.ok_or_else(|| {
            SessionError::AgentUnavailable(
                "This installation has no verified login command.".into(),
            )
        })?;
        let command = login_command(&installation)
            .map_err(|error| SessionError::AgentUnavailable(error.to_string()))?;
        let env = self.deps().env.get().await;
        let folder = env
            .vars
            .get(&if cfg!(windows) { "USERPROFILE" } else { "HOME" }.into())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| {
                SessionError::AgentUnavailable("The home folder is unavailable.".into())
            })?;
        // This checks executable identity only, never credentials or vendor configuration.
        check_unchanged(&installation)
            .map_err(|error| SessionError::AgentUnavailable(error.to_string()))?;
        Ok(SpawnSpec {
            launch: LaunchSpec {
                label: format!("{} sign-in", agent.name),
                program: command.program,
                args: command.args,
                cwd: ProcessCwd::Fixed(folder.clone()),
                set_env: Vec::new(),
                daemons: Vec::new(),
                startup_timeout: Duration::from_secs(15),
            },
            folder,
            env,
            max_line_bytes: aura_process::MAX_LINE_BYTES,
        })
    }
}
