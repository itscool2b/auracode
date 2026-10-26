//! Ephemeral terminal ownership. No output, input or exit state is written to the chat store.
//! A caller reserves a page-owned slot before asynchronous preparation, so reload/close also
//! cancels a launch that has not produced a process yet.
use aura_process::{
    ByteSink, SpawnSpec, Spawner,
    pty::{PtyControl, PtyOutput, PtySize},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, watch};

const MAX_TERMINALS: usize = 4;
const MAX_INPUT: usize = 16 * 1024;
const READ_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("This terminal is closed or belongs to another window.")]
    Closed,
    #[error("A terminal is already open in this window.")]
    AlreadyOpen,
    #[error("Close another terminal before opening one.")]
    Full,
    #[error("A terminal read is already pending.")]
    ReadPending,
    #[error("Terminal input is limited to 16 KiB per write.")]
    InputTooLarge,
    #[error("The terminal cannot accept input yet. Try again after it catches up.")]
    InputBlocked,
    #[error("The terminal could not start: {0}")]
    Start(String),
    #[error("The terminal size is invalid or the terminal is closed.")]
    Resize,
}

/// One bounded pull. An empty nonterminal chunk means only that the read wait elapsed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct TerminalChunk {
    pub bytes: Vec<u8>,
    pub done: bool,
    pub exit_code: Option<i32>,
    pub truncated: bool,
}

struct Running {
    input: ByteSink,
    output: AsyncMutex<PtyOutput>,
    control: PtyControl,
}
struct Slot {
    owner: String,
    claimed: AtomicBool,
    canceled: watch::Sender<bool>,
    running: Mutex<Option<Arc<Running>>>,
}
impl Slot {
    fn cancel(&self) {
        self.canceled.send_replace(true);
        if let Some(running) = lock(&self.running).as_ref() {
            running.control.kill();
        }
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[derive(Default)]
struct Inner {
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    stopped: AtomicBool,
}
impl Drop for Inner {
    fn drop(&mut self) {
        for slot in lock(&self.slots).values() {
            slot.cancel();
        }
    }
}

/// Clones share ownership; one terminal per window, at most four in this app instance.
#[derive(Clone, Default)]
pub struct Terminals(Arc<Inner>);

pub struct TerminalTicket {
    terminals: Terminals,
    id: String,
    slot: Arc<Slot>,
    committed: bool,
}
impl Drop for TerminalTicket {
    fn drop(&mut self) {
        if !self.committed {
            lock(&self.terminals.0.slots).remove(&self.id);
            self.slot.cancel();
        }
    }
}
impl TerminalTicket {
    /// Return the reservation before beginning any vendor work. A close can now name and cancel
    /// it even if a later start handler has not begun yet.
    pub fn pending(mut self) -> String {
        self.slot.claimed.store(false, Ordering::Release);
        self.committed = true;
        self.id.clone()
    }
    pub async fn start(
        mut self,
        spawner: &Spawner,
        spec: SpawnSpec,
        size: PtySize,
    ) -> Result<String, TerminalError> {
        if *self.slot.canceled.borrow() {
            return Err(TerminalError::Closed);
        }
        let process = tokio::time::timeout(Duration::from_secs(15), spawner.spawn_pty(spec, size))
            .await
            .map_err(|_| TerminalError::Start("Startup timed out.".into()))?
            .map_err(|error| TerminalError::Start(error.to_string()))?;
        let mut running = lock(&self.slot.running);
        if *self.slot.canceled.borrow() {
            return Err(TerminalError::Closed);
        }
        *running = Some(Arc::new(Running {
            input: process.input,
            output: AsyncMutex::new(process.output),
            control: process.control,
        }));
        self.committed = true;
        Ok(self.id.clone())
    }
}

impl Terminals {
    pub fn reserve(&self, owner: &str) -> Result<TerminalTicket, TerminalError> {
        let mut slots = lock(&self.0.slots);
        if self.0.stopped.load(Ordering::Acquire) {
            return Err(TerminalError::Closed);
        }
        if slots.values().any(|slot| slot.owner == owner) {
            return Err(TerminalError::AlreadyOpen);
        }
        if slots.len() >= MAX_TERMINALS {
            return Err(TerminalError::Full);
        }
        let id = uuid::Uuid::now_v7().to_string();
        let (canceled, _) = watch::channel(false);
        let slot = Arc::new(Slot {
            owner: owner.into(),
            claimed: AtomicBool::new(true),
            canceled,
            running: Mutex::new(None),
        });
        slots.insert(id.clone(), Arc::clone(&slot));
        Ok(TerminalTicket {
            terminals: self.clone(),
            id,
            slot,
            committed: false,
        })
    }

    pub fn claim(&self, owner: &str, id: &str) -> Result<TerminalTicket, TerminalError> {
        let slot = self.slot(owner, id)?;
        if slot.claimed.swap(true, Ordering::AcqRel) {
            return Err(TerminalError::AlreadyOpen);
        }
        Ok(TerminalTicket {
            terminals: self.clone(),
            id: id.into(),
            slot,
            committed: false,
        })
    }

    fn slot(&self, owner: &str, id: &str) -> Result<Arc<Slot>, TerminalError> {
        lock(&self.0.slots)
            .get(id)
            .filter(|slot| slot.owner == owner)
            .cloned()
            .ok_or(TerminalError::Closed)
    }
    fn running(&self, owner: &str, id: &str) -> Result<(Arc<Slot>, Arc<Running>), TerminalError> {
        let slot = self.slot(owner, id)?;
        let running = lock(&slot.running).clone().ok_or(TerminalError::Closed)?;
        if *slot.canceled.borrow() {
            return Err(TerminalError::Closed);
        }
        Ok((slot, running))
    }
    pub async fn read(&self, owner: &str, id: &str) -> Result<TerminalChunk, TerminalError> {
        let (slot, running) = self.running(owner, id)?;
        let mut output = running
            .output
            .try_lock()
            .map_err(|_| TerminalError::ReadPending)?;
        let mut canceled = slot.canceled.subscribe();
        let next = tokio::select! {
            biased;
            _ = canceled.wait_for(|closed| *closed) => return Err(TerminalError::Closed),
            next = output.next() => Some(next),
            _ = tokio::time::sleep(READ_WAIT) => None,
        };
        let done = matches!(next, Some(None));
        Ok(TerminalChunk {
            bytes: next.flatten().unwrap_or_default(),
            done,
            exit_code: running.control.try_exited().and_then(|exit| exit.code),
            truncated: output.truncated(),
        })
    }
    pub fn write(&self, owner: &str, id: &str, bytes: Vec<u8>) -> Result<(), TerminalError> {
        if bytes.len() > MAX_INPUT {
            return Err(TerminalError::InputTooLarge);
        }
        let (_, running) = self.running(owner, id)?;
        running
            .input
            .try_write(bytes)
            .map_err(|_| TerminalError::InputBlocked)
    }
    pub fn resize(&self, owner: &str, id: &str, size: PtySize) -> Result<(), TerminalError> {
        let (_, running) = self.running(owner, id)?;
        running
            .control
            .resize(size)
            .map_err(|_| TerminalError::Resize)
    }
    pub fn close(&self, owner: &str, id: &str) -> Result<(), TerminalError> {
        let mut slots = lock(&self.0.slots);
        if let Some(slot) = slots.get(id) {
            if slot.owner != owner {
                return Err(TerminalError::Closed);
            }
            slot.cancel();
            slots.remove(id);
        }
        Ok(())
    }
    pub fn drop_owner(&self, owner: &str) {
        lock(&self.0.slots).retain(|_, slot| {
            if slot.owner == owner {
                slot.cancel();
                false
            } else {
                true
            }
        });
    }
    pub fn stop_all(&self) {
        self.0.stopped.store(true, Ordering::Release);
        self.close_all();
    }
    pub fn close_all(&self) {
        let mut slots = lock(&self.0.slots);
        for slot in slots.values() {
            slot.cancel();
        }
        slots.clear();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_process::{EnvSource, LaunchSpec, LeftoverRegistry, ProcessCwd, ResolvedEnv};
    use std::io::Write;

    // A harmless test-harness subprocess. The ordinary unit test returns immediately; only the
    // explicit PTY test below supplies this marker and invokes this exact test name.
    #[test]
    fn terminal_child() {
        if std::env::var_os("AURACODE_TERMINAL_TEST_CHILD").is_none() {
            return;
        }
        println!("local-terminal-ready");
        std::io::stdout().flush().unwrap();
        let mut line = String::new();
        std::io::stdin().read_line(&mut line).unwrap();
        println!("local-terminal-input:{}", line.trim());
        std::io::stdout().flush().unwrap();
        std::thread::sleep(Duration::from_secs(60));
    }

    fn local_spec(folder: &std::path::Path) -> SpawnSpec {
        SpawnSpec {
            launch: LaunchSpec {
                label: "local terminal test".into(),
                program: std::env::current_exe().unwrap(),
                args: ["--exact", "terminal::tests::terminal_child", "--nocapture"]
                    .map(Into::into)
                    .into(),
                cwd: ProcessCwd::ChatFolder,
                set_env: vec![("AURACODE_TERMINAL_TEST_CHILD".into(), "1".into())],
                daemons: Vec::new(),
                startup_timeout: Duration::from_secs(15),
            },
            folder: folder.into(),
            env: Arc::new(ResolvedEnv {
                vars: aura_process::process_env(),
                source: EnvSource::Fallback {
                    reason: "test".into(),
                },
                warnings: Vec::new(),
                resolved_at_ms: 0,
            }),
            max_line_bytes: aura_process::MAX_LINE_BYTES,
        }
    }

    async fn read_until(terminals: &Terminals, id: &str, marker: &str) {
        tokio::time::timeout(Duration::from_secs(30), async {
            let mut output = Vec::new();
            loop {
                let chunk = terminals.read("main", id).await.unwrap();
                assert!(chunk.bytes.len() <= 8192);
                output.extend(chunk.bytes);
                assert!(output.len() < 100_000);
                if String::from_utf8_lossy(&output).contains(marker) {
                    break;
                }
                assert!(!chunk.done);
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn owned_local_terminal_rejects_other_windows_and_close_cancels_reads() {
        let folder = tempfile::tempdir().unwrap();
        let terminals = Terminals::default();
        let id = terminals.reserve("main").unwrap().pending();
        let spawner = Spawner::new(
            LeftoverRegistry::disabled(),
            tokio::runtime::Handle::current(),
        );
        terminals
            .claim("main", &id)
            .unwrap()
            .start(
                &spawner,
                local_spec(folder.path()),
                PtySize {
                    rows: 24,
                    cols: 100,
                },
            )
            .await
            .unwrap();
        read_until(&terminals, &id, "local-terminal-ready").await;
        assert!(matches!(
            terminals.read("other", &id).await,
            Err(TerminalError::Closed)
        ));
        assert!(matches!(
            terminals.write("other", &id, b"no\r".to_vec()),
            Err(TerminalError::Closed)
        ));
        terminals.write("main", &id, b"hello\r".to_vec()).unwrap();
        read_until(&terminals, &id, "local-terminal-input:hello").await;
        let (_, running) = terminals.running("main", &id).unwrap();
        let output = running.output.lock().await;
        assert!(matches!(
            terminals.read("main", &id).await,
            Err(TerminalError::ReadPending)
        ));
        drop(output);
        let pending = async {
            loop {
                if let Err(error) = terminals.read("main", &id).await {
                    return error;
                }
            }
        };
        tokio::pin!(pending);
        // Any final console rendering is harmless. When a read waits, closing wakes it without
        // waiting the read timeout, and reaches the owned process despite outstanding controls.
        assert!(matches!(
            futures::poll!(&mut pending),
            std::task::Poll::Pending
        ));
        terminals.drop_owner("main");
        let result = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap();
        assert!(matches!(result, TerminalError::Closed));
        tokio::time::timeout(Duration::from_secs(5), running.control.exited())
            .await
            .unwrap();
    }

    #[test]
    fn reservations_bound_concurrency_and_cancellation_releases_the_slot() {
        let terminals = Terminals::default();
        let first = terminals.reserve("main").unwrap();
        assert!(matches!(
            terminals.reserve("main"),
            Err(TerminalError::AlreadyOpen)
        ));
        let other: Vec<_> = (0..3)
            .map(|i| terminals.reserve(&i.to_string()).unwrap())
            .collect();
        assert!(matches!(
            terminals.reserve("overflow"),
            Err(TerminalError::Full)
        ));
        drop(first);
        let next = terminals.reserve("main").unwrap();
        assert!(matches!(
            terminals.close("wrong-window", &next.id),
            Err(TerminalError::Closed)
        ));
        assert!(!*next.slot.canceled.borrow());
        terminals.drop_owner("main");
        assert!(*next.slot.canceled.borrow());
        assert!(other.iter().all(|ticket| !*ticket.slot.canceled.borrow()));
        assert!(terminals.reserve("main").is_ok());
    }

    #[test]
    fn stop_cancels_pending_launches_and_refuses_new_work() {
        let terminals = Terminals::default();
        let ticket = terminals.reserve("main").unwrap();
        terminals.stop_all();
        assert!(*ticket.slot.canceled.borrow());
        assert!(matches!(
            terminals.reserve("main"),
            Err(TerminalError::Closed)
        ));
        assert!(matches!(
            terminals.write("main", &ticket.id, vec![0; MAX_INPUT + 1]),
            Err(TerminalError::InputTooLarge)
        ));
    }

    #[test]
    fn close_before_start_cannot_launch_and_duplicate_claim_cannot_replace_it() {
        let terminals = Terminals::default();
        let id = terminals.reserve("main").unwrap().pending();
        assert!(matches!(
            terminals.claim("other", &id),
            Err(TerminalError::Closed)
        ));
        let ticket = terminals.claim("main", &id).unwrap();
        assert!(matches!(
            terminals.claim("main", &id),
            Err(TerminalError::AlreadyOpen)
        ));
        terminals.close("main", &id).unwrap();
        assert!(*ticket.slot.canceled.borrow());
        assert!(matches!(
            terminals.claim("main", &id),
            Err(TerminalError::Closed)
        ));
    }
}
