//! Helpers the unit tests of several modules share.

use std::process::Command;

/// Runs the test `name` again in a child process, with the environment `configure` sets, and
/// fails unless the child's run of it passed. The environment of this process is never changed:
/// that is unsafe in edition 2024 and races with other test threads.
pub fn run_child(name: &str, configure: impl FnOnce(&mut Command)) {
    let mut child = Command::new(std::env::current_exe().expect("test binary path"));
    child.args(["--exact", name, "--test-threads", "1"]);
    configure(&mut child);
    let output = child.output().expect("run the child test");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "stdout {stdout}\nstderr {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
