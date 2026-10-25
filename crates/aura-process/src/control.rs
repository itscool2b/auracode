//! Controlling a running agent: stdin, kills, the shutdown chain, and its exit.
//!
//! [`ProcessControl`] is a cheap, cloneable handle that forwards to a [`ControlImpl`]: the real one
//! that `spawn` builds, or `testing::FakeControl`. The session keeps every control a driver spawned,
//! so force stop and quit reach the processes even when a driver is wedged. When the last handle
//! drops, the whole tree is killed.
//!
//! Exit detection waits on the direct child on every OS, never on its group or its job: a crashed
//! adapter whose descendant lingers must still look exited.

use std::fmt;
use std::sync::Arc;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::shutdown::{ShutdownPlan, ShutdownReport};

/// What a [`ProcessControl`] forwards to.
pub trait ControlImpl: Send + Sync + 'static {
    fn pid(&self) -> u32;
    fn close_stdin(&self);
    /// Immediate and callable from any thread, with or without a runtime: a run-event callback at
    /// quit has none. Unix: `killpg(SIGKILL)` inline plus a best-effort walk for escaped
    /// descendants; Windows: a request to terminate the job.
    fn kill_tree(&self);
    /// The shutdown chain. Idempotent and shared: a second call joins the first chain.
    fn shutdown(&self, plan: ShutdownPlan) -> BoxFuture<'static, ShutdownReport>;
    /// The direct child's exit on every OS: never a job-wide or group-wide wait.
    fn exited(&self) -> BoxFuture<'static, ExitInfo>;
    fn try_exited(&self) -> Option<ExitInfo>;
    /// Unix: one process-table snapshot (on a blocking thread) recording, in the leftover registry,
    /// the descendants that left the agent's group, minus declared daemons. Windows: nothing.
    fn record_escaped(&self) -> BoxFuture<'static, ()>;
    /// The last `max_bytes` of stderr: lossy, ANSI stripped, NOT redacted.
    fn stderr_tail(&self, max_bytes: usize) -> String;
}

/// A handle to a running agent. Methods forward to its [`ControlImpl`]; the last handle dropped
/// kills the tree.
#[derive(Clone)]
pub struct ProcessControl(Arc<KillOnLastDrop>);

/// Shared by every clone of one [`ProcessControl`]; dropping the last clone drops this.
struct KillOnLastDrop(Arc<dyn ControlImpl>);

impl Drop for KillOnLastDrop {
    fn drop(&mut self) {
        self.0.kill_tree();
    }
}

impl ProcessControl {
    pub fn new(imp: Arc<dyn ControlImpl>) -> ProcessControl {
        ProcessControl(Arc::new(KillOnLastDrop(imp)))
    }

    fn imp(&self) -> &dyn ControlImpl {
        self.0.0.as_ref()
    }

    pub fn pid(&self) -> u32 {
        self.imp().pid()
    }

    pub fn close_stdin(&self) {
        self.imp().close_stdin();
    }

    /// See [`ControlImpl::kill_tree`].
    pub fn kill_tree(&self) {
        self.imp().kill_tree();
    }

    /// See [`ControlImpl::shutdown`].
    pub fn shutdown(&self, plan: ShutdownPlan) -> BoxFuture<'static, ShutdownReport> {
        self.imp().shutdown(plan)
    }

    pub fn exited(&self) -> BoxFuture<'static, ExitInfo> {
        self.imp().exited()
    }

    pub fn try_exited(&self) -> Option<ExitInfo> {
        self.imp().try_exited()
    }

    /// See [`ControlImpl::record_escaped`].
    pub fn record_escaped(&self) -> BoxFuture<'static, ()> {
        self.imp().record_escaped()
    }

    /// See [`ControlImpl::stderr_tail`].
    pub fn stderr_tail(&self, max_bytes: usize) -> String {
        self.imp().stderr_tail(max_bytes)
    }
}

impl fmt::Debug for ProcessControl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProcessControl")
            .field("pid", &self.pid())
            .field("exited", &self.try_exited())
            .finish()
    }
}

/// How a process ended. `signal` is set (Unix) when a signal ended it; `at_ms` is Unix ms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExitInfo {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub at_ms: i64,
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};

    use futures::FutureExt;

    use super::*;

    #[derive(Default)]
    struct Counting {
        kills: AtomicU32,
        closes: AtomicU32,
        plans: Mutex<Vec<ShutdownPlan>>,
    }

    impl ControlImpl for Counting {
        fn pid(&self) -> u32 {
            42
        }
        fn close_stdin(&self) {
            self.closes.fetch_add(1, Ordering::SeqCst);
        }
        fn kill_tree(&self) {
            self.kills.fetch_add(1, Ordering::SeqCst);
        }
        fn shutdown(&self, plan: ShutdownPlan) -> BoxFuture<'static, ShutdownReport> {
            self.plans.lock().expect("lock").push(plan);
            async { ShutdownReport::default() }.boxed()
        }
        fn exited(&self) -> BoxFuture<'static, ExitInfo> {
            futures::future::pending().boxed()
        }
        fn try_exited(&self) -> Option<ExitInfo> {
            None
        }
        fn record_escaped(&self) -> BoxFuture<'static, ()> {
            async {}.boxed()
        }
        fn stderr_tail(&self, _max_bytes: usize) -> String {
            String::new()
        }
    }

    #[test]
    fn only_the_last_handle_kills_the_tree() {
        let imp = Arc::new(Counting::default());
        let control = ProcessControl::new(imp.clone());
        let clone = control.clone();
        assert_eq!(control.pid(), 42);
        drop(control);
        assert_eq!(
            imp.kills.load(Ordering::SeqCst),
            0,
            "a clone is still alive"
        );
        clone.close_stdin();
        assert_eq!(imp.closes.load(Ordering::SeqCst), 1);
        drop(clone);
        assert_eq!(imp.kills.load(Ordering::SeqCst), 1, "the last drop kills");
    }

    #[tokio::test]
    async fn methods_forward_to_the_implementation() {
        let imp = Arc::new(Counting::default());
        let control = ProcessControl::new(imp.clone());
        control.shutdown(ShutdownPlan::FORCE).await;
        control.kill_tree();
        assert_eq!(
            imp.plans.lock().expect("lock").as_slice(),
            [ShutdownPlan::FORCE]
        );
        assert_eq!(imp.kills.load(Ordering::SeqCst), 1);
        assert!(format!("{control:?}").contains("42"));
    }
}
