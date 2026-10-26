//! The session's spawner: what drivers spawn through. It mints each spawn id, opens the spawn's
//! protocol log, and records every process control, so force stop reaches them.
//!
//! The record is the chat's [`ProcessBook`], shared with the actor, its supervisor and the manager's
//! `kill_all_now`. Each driver start is a generation: a force stop closes its generation, so a
//! process a wedged driver spawns afterwards is killed at once instead of escaping the stop.

use std::sync::{Arc, Mutex, MutexGuard};

use aura_drivers::driver::AgentSpawner;
use aura_process::{
    LogFactory, ProcessControl, ProcessSpawner, SpawnError, SpawnSpec, SpawnedProcess,
};
use futures::FutureExt;
use futures::future::BoxFuture;

use crate::ids::new_id;

/// Every process a chat's drivers spawned and that may still run.
#[derive(Debug, Default)]
pub(crate) struct ProcessBook {
    inner: Mutex<BookInner>,
}

#[derive(Debug, Default)]
struct BookInner {
    entries: Vec<(u64, ProcessControl)>,
    /// Generations that were force-stopped: what they spawn from now on is killed at once.
    closed: Vec<u64>,
}

impl ProcessBook {
    fn lock(&self) -> MutexGuard<'_, BookInner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Records a process of generation `generation`. Returns false (and records nothing) when that
    /// generation was force-stopped; the caller kills it.
    fn record(&self, generation: u64, control: ProcessControl) -> bool {
        let mut inner = self.lock();
        inner
            .entries
            .retain(|(_, control)| control.try_exited().is_none());
        if inner.closed.contains(&generation) {
            return false;
        }
        inner.entries.push((generation, control));
        true
    }

    /// Closes `generation` and returns its processes, for the force-stop chain.
    pub(crate) fn close(&self, generation: u64) -> Vec<ProcessControl> {
        let mut inner = self.lock();
        if !inner.closed.contains(&generation) {
            inner.closed.push(generation);
        }
        inner
            .entries
            .iter()
            .filter(|(entry, _)| *entry == generation)
            .map(|(_, control)| control.clone())
            .collect()
    }

    /// Forgets `generation`'s processes once its driver ended; dropping the last handle kills a
    /// tree that is still alive.
    pub(crate) fn clear(&self, generation: u64) {
        let removed: Vec<ProcessControl> = {
            let mut inner = self.lock();
            let (gone, kept) = std::mem::take(&mut inner.entries)
                .into_iter()
                .partition(|(entry, _)| *entry == generation);
            inner.entries = kept;
            gone.into_iter().map(|(_, control)| control).collect()
        };
        drop(removed);
    }

    /// Every recorded process (`record_escaped`, the supervisor's cleanup).
    pub(crate) fn all(&self) -> Vec<ProcessControl> {
        self.lock()
            .entries
            .iter()
            .map(|(_, control)| control.clone())
            .collect()
    }

    /// `kill_tree()` on every recorded process; synchronous, callable from any thread.
    pub(crate) fn kill_all(&self) {
        for control in self.all() {
            control.kill_tree();
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.lock().entries.is_empty()
    }
}

/// What one driver start spawns through.
pub(crate) struct SessionSpawner {
    base: Arc<dyn ProcessSpawner>,
    logs: LogFactory,
    protocol_logging: bool,
    chat_id: String,
    book: Arc<ProcessBook>,
    generation: u64,
}

impl SessionSpawner {
    pub(crate) fn new(
        base: Arc<dyn ProcessSpawner>,
        logs: LogFactory,
        chat_id: String,
        book: Arc<ProcessBook>,
        generation: u64,
    ) -> SessionSpawner {
        SessionSpawner {
            base,
            logs,
            protocol_logging: true,
            chat_id,
            book,
            generation,
        }
    }
}

impl SessionSpawner {
    pub(crate) fn with_protocol_logging(mut self, enabled: bool) -> Self {
        self.protocol_logging = enabled;
        self
    }
}

impl AgentSpawner for SessionSpawner {
    fn spawn(&self, spec: SpawnSpec) -> BoxFuture<'static, Result<SpawnedProcess, SpawnError>> {
        let spawn_id = new_id();
        let log = if self.protocol_logging {
            self.logs.open(&self.chat_id, &spawn_id)
        } else {
            aura_process::ProtocolLog::disabled_with_id(spawn_id)
        };
        let spawned = self.base.spawn(spec, log);
        let book = Arc::clone(&self.book);
        let generation = self.generation;
        async move {
            let process = spawned.await?;
            if !book.record(generation, process.control.clone()) {
                process.control.kill_tree();
                return Err(SpawnError::Spawn {
                    program: process.spawn_id,
                    source: std::io::Error::other(
                        "the session was force-stopped while this process started",
                    ),
                });
            }
            Ok(process)
        }
        .boxed()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use aura_process::testing::{FakeCall, FakeSpawner};
    use aura_process::{EnvMap, EnvSource, LaunchSpec, ProcessCwd, Redactor, ResolvedEnv};
    use tokio::runtime::Handle;

    use super::*;

    fn spec() -> SpawnSpec {
        SpawnSpec {
            launch: LaunchSpec {
                label: "fake".into(),
                program: PathBuf::from("/bin/fake"),
                args: Vec::new(),
                cwd: ProcessCwd::ChatFolder,
                set_env: Vec::new(),
                daemons: Vec::new(),
                startup_timeout: Duration::from_secs(5),
            },
            folder: PathBuf::from("/work"),
            env: Arc::new(ResolvedEnv {
                vars: EnvMap::new(),
                source: EnvSource::Fallback {
                    reason: "test".into(),
                },
                warnings: Vec::new(),
                resolved_at_ms: 0,
            }),
            max_line_bytes: 1024,
        }
    }

    #[tokio::test]
    async fn disabled_protocol_logging_keeps_spawn_identity_without_creating_a_log() {
        let dir = tempfile::tempdir().unwrap();
        let (base, _ends) = FakeSpawner::new();
        let logs = LogFactory::new(
            dir.path().to_path_buf(),
            Arc::new(Redactor::standard()),
            Handle::current(),
        );
        let spawner = SessionSpawner::new(
            base,
            logs,
            "account-chat".into(),
            Arc::new(ProcessBook::default()),
            1,
        )
        .with_protocol_logging(false);
        let process = spawner.spawn(spec()).await.unwrap();
        assert!(!process.spawn_id.is_empty());
        assert_eq!(process.log.spawn_id(), process.spawn_id);
        assert!(process.log.path().is_none());
        process
            .log
            .command(serde_json::json!({"prompt":"synthetic private prompt"}));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn spawns_are_recorded_and_a_closed_generation_kills_late_ones() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (base, _ends) = FakeSpawner::new();
        let logs = LogFactory::new(
            dir.path().to_path_buf(),
            Arc::new(Redactor::standard()),
            Handle::current(),
        );
        let book = Arc::new(ProcessBook::default());
        let first = SessionSpawner::new(
            base.clone(),
            logs.clone(),
            "chat".into(),
            Arc::clone(&book),
            1,
        );
        let process = first.spawn(spec()).await.expect("spawn");
        assert_ne!(process.spawn_id, "");
        assert_eq!(book.all().len(), 1);

        let closed = book.close(1);
        assert_eq!(closed.len(), 1);
        let late = first.spawn(spec()).await;
        assert!(late.is_err(), "a force-stopped generation spawns nothing");
        let controls = base.controls();
        assert_eq!(
            controls[1].calls().first(),
            Some(&FakeCall::KillTree),
            "killed at once"
        );

        let second = SessionSpawner::new(base.clone(), logs, "chat".into(), Arc::clone(&book), 2);
        second.spawn(spec()).await.expect("a new generation spawns");
        book.clear(1);
        assert_eq!(book.all().len(), 1, "generation 2 stays recorded");
        book.kill_all();
        assert!(
            controls[0].calls().is_empty(),
            "generation 1's process is no longer recorded"
        );
        assert!(base.controls()[2].calls().contains(&FakeCall::KillTree));
    }
}
