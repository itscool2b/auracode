//! spawn_hidden and kill_tree against the real OS. Runs on macOS and Linux locally and on
//! windows-latest and ubuntu-latest in CI; OS-specific cases are cfg-gated.
//!
//! The `control_` tests deliberately open console windows on Windows, to prove what the hidden
//! spawn prevents. Skip them (`--skip control_`) when watching for flashes by hand.

use std::{error::Error, path::PathBuf, process::Stdio, time::Duration};

use tokio::time::timeout;
use windows_spawn::{
    CAPTURE_LIMIT, EnvOverride, HiddenChild, Pipe, SpawnError, inspect::WatchedProcess, kill_tree,
    spawn_hidden,
};

type TestResult = Result<(), Box<dyn Error>>;

/// Cargo bakes in the helper binaries' absolute build-machine paths. When the test exe has been
/// copied elsewhere (a CI artifact for the manual Windows check), look next to it instead.
fn helper_binary(built: &str) -> PathBuf {
    let built = PathBuf::from(built);
    if built.exists() {
        return built;
    }
    let beside_test = std::env::current_exe()
        .ok()
        .zip(built.file_name())
        .and_then(|(exe, name)| Some(exe.parent()?.join(name)));
    match beside_test {
        Some(path) if path.exists() => path,
        _ => built,
    }
}

fn probe() -> PathBuf {
    helper_binary(env!("CARGO_BIN_EXE_spawn-probe"))
}

/// Generous: a loaded CI machine with antivirus scanning can take seconds to start a process.
const STARTUP: Duration = Duration::from_secs(30);
/// The spike's bar for "the tree is dead".
const GONE_WITHIN: Duration = Duration::from_secs(5);
const MIB: usize = 1024 * 1024;

/// Kills a watched process when dropped, so a failed assertion never leaves a 60-second sleeper
/// running after the test.
struct Reaper(WatchedProcess);

impl Drop for Reaper {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}

#[cfg(unix)]
fn first_line(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|&byte| byte == b'\n')?;
    Some(String::from_utf8_lossy(&bytes[..end]).trim().to_owned())
}

#[cfg(unix)]
async fn read_first_line(child: &mut HiddenChild) -> Result<String, Box<dyn Error>> {
    let line = timeout(STARTUP, child.wait_for_output(Pipe::Stdout, first_line)).await?;
    Ok(line.ok_or("stdout ended before a full line arrived")?)
}

/// Starts a shell whose long-running grandchild is what kill_tree has to reach. With
/// `shell_waits` the shell waits for the grandchild; without it the shell exits at once and leaves
/// the grandchild running, the way an agent leaves a dev server behind.
#[cfg(unix)]
async fn shell_with_grandchild(shell_waits: bool) -> Result<(HiddenChild, Reaper), Box<dyn Error>> {
    let script = if shell_waits {
        "sleep 60 & echo $!; wait"
    } else {
        "sleep 60 & echo $!"
    };
    let mut shell = spawn_hidden("sh", ["-c", script], None, &[])?;
    let pid: u32 = read_first_line(&mut shell).await?.parse()?;
    Ok((shell, Reaper(WatchedProcess::open(pid)?)))
}

/// Starts a shell whose long-running grandchild is what kill_tree has to reach. With
/// `shell_waits` the shell waits for the grandchild; without it the shell exits at once and leaves
/// the grandchild running, the way an agent leaves a dev server behind.
#[cfg(windows)]
async fn shell_with_grandchild(shell_waits: bool) -> Result<(HiddenChild, Reaper), Box<dyn Error>> {
    // cmd has no `$!`, so the grandchild is found by its parent pid instead. `start /b` runs ping
    // in the background of the same (hidden) console and lets cmd exit.
    let launcher: &[&str] = if shell_waits {
        &["/d", "/c"]
    } else {
        &["/d", "/c", "start", "/b"]
    };
    let args = launcher.iter().chain(&["ping", "-n", "60", "127.0.0.1"]);
    let shell = spawn_hidden("cmd", args, None, &[])?;
    let pid = windows_spawn::inspect::wait_for_child(shell.id(), "ping.exe", STARTUP)
        .await?
        .ok_or("cmd never started ping")?;
    Ok((shell, Reaper(WatchedProcess::open(pid)?)))
}

/// Starts `spawn-probe orphan`, which owns a hidden 60-second sleeper, and returns the owner plus
/// a watch on the sleeper. The owner has been told to exit abruptly when this returns.
async fn crashing_owner() -> Result<(tokio::process::Child, Reaper), Box<dyn Error>> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    // A plain spawn on purpose: the owner must not be in a job or group of ours, so only the
    // owner's own handle on the sleeper's tree can clean it up.
    let mut owner = tokio::process::Command::new(probe())
        .args(["orphan", "60"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = owner.stdout.take().ok_or("owner stdout was not piped")?;
    let line = timeout(STARTUP, BufReader::new(stdout).lines().next_line())
        .await??
        .ok_or("the owner exited before printing the sleeper's pid")?;
    let sleeper = Reaper(WatchedProcess::open(line.trim().parse()?)?);

    let mut stdin = owner.stdin.take().ok_or("owner stdin was not piped")?;
    stdin.write_all(b"go\n").await?;
    stdin.flush().await?;
    Ok((owner, sleeper))
}

#[tokio::test]
async fn captures_git_version_from_stdout() -> TestResult {
    let child = spawn_hidden("git", ["--version"], None, &[])?;
    let output = timeout(STARTUP, child.wait_with_output()).await??;
    assert!(output.status.success(), "git --version failed: {output:?}");
    assert!(
        output.stdout.text().starts_with("git version "),
        "stdout: {:?}",
        output.stdout.text()
    );
    assert!(output.stdout.complete && output.stderr.complete);
    Ok(())
}

#[tokio::test]
async fn kill_tree_kills_the_grandchild() -> TestResult {
    let (mut shell, grandchild) = shell_with_grandchild(true).await?;
    assert!(grandchild.0.is_running()?);
    let status = kill_tree(&mut shell).await?;
    assert!(
        !status.success(),
        "the shell was killed, so it cannot have succeeded: {status:?}"
    );
    assert!(
        grandchild.0.wait_gone(GONE_WITHIN).await?,
        "grandchild {} survived kill_tree",
        grandchild.0.pid()
    );
    Ok(())
}

#[tokio::test]
async fn kill_tree_reaches_grandchildren_that_outlive_their_shell() -> TestResult {
    let (mut shell, grandchild) = shell_with_grandchild(false).await?;
    let status = timeout(STARTUP, shell.wait()).await??;
    assert!(
        status.success(),
        "the shell should exit on its own: {status:?}"
    );
    assert!(
        grandchild.0.is_running()?,
        "the grandchild should outlive its shell"
    );

    let after_kill = kill_tree(&mut shell).await?;
    assert_eq!(
        after_kill.code(),
        status.code(),
        "kill_tree reports the shell's own exit status"
    );
    assert!(
        grandchild.0.wait_gone(GONE_WITHIN).await?,
        "grandchild {} outlived kill_tree",
        grandchild.0.pid()
    );
    Ok(())
}

#[tokio::test]
async fn dropping_the_handle_kills_the_tree() -> TestResult {
    let (shell, grandchild) = shell_with_grandchild(true).await?;
    drop(shell);
    assert!(
        grandchild.0.wait_gone(GONE_WITHIN).await?,
        "grandchild {} survived its handle being dropped",
        grandchild.0.pid()
    );
    Ok(())
}

#[tokio::test]
async fn a_full_stderr_pipe_never_blocks_a_stdout_reader() -> TestResult {
    // The probe writes 1 MiB to stderr before any stdout. A caller reading only stdout, as an
    // agent driver reads its protocol stream, would deadlock if stderr were not drained as well.
    let size = MIB.to_string();
    let mut child = spawn_hidden(probe(), ["spew", size.as_str(), size.as_str()], None, &[])?;
    let stdout_len = timeout(
        STARTUP,
        child.wait_for_output(Pipe::Stdout, |bytes| {
            (bytes.len() >= MIB).then_some(bytes.len())
        }),
    )
    .await?;
    assert_eq!(stdout_len, Some(MIB));

    let output = timeout(STARTUP, child.wait_with_output()).await??;
    assert!(output.status.success(), "probe failed: {:?}", output.status);
    assert_eq!(output.stderr.total_len, MIB as u64);
    assert_eq!(output.stderr.bytes.len(), MIB);
    assert!(output.stderr.bytes.iter().all(|&byte| byte == b'e'));
    assert_eq!(output.stdout.total_len, MIB as u64);
    assert!(output.stdout.complete && output.stderr.complete);
    Ok(())
}

#[tokio::test]
async fn huge_output_is_capped_in_memory_but_read_to_the_end() -> TestResult {
    let total = 2 * CAPTURE_LIMIT + MIB;
    let size = total.to_string();
    let child = spawn_hidden(probe(), ["spew", "0", size.as_str()], None, &[])?;
    let output = timeout(STARTUP, child.wait_with_output()).await??;
    assert!(output.status.success(), "probe failed: {:?}", output.status);
    assert_eq!(output.stdout.total_len, total as u64);
    assert_eq!(output.stdout.bytes.len(), CAPTURE_LIMIT);
    assert!(output.stdout.is_truncated() && output.stdout.complete);
    Ok(())
}

#[tokio::test]
async fn stdin_is_piped_and_dropping_it_sends_end_of_file() -> TestResult {
    use tokio::io::AsyncWriteExt;

    let mut child = spawn_hidden(probe(), ["echo-stdin"], None, &[])?;
    let mut stdin = child.take_stdin().ok_or("stdin was not piped")?;
    stdin.write_all(b"hello from auracode\n").await?;
    stdin.flush().await?;
    drop(stdin);
    let output = timeout(STARTUP, child.wait_with_output()).await??;
    assert!(output.status.success(), "probe failed: {:?}", output.status);
    assert_eq!(output.stdout.text(), "hello from auracode\n");
    Ok(())
}

#[tokio::test]
async fn a_missing_program_is_an_error_not_a_panic() -> TestResult {
    let program = "aura-spike-no-such-program";
    match spawn_hidden(program, ["--version"], None, &[]) {
        Err(SpawnError::ProgramNotFound {
            program: reported, ..
        }) => assert_eq!(reported, program),
        Err(other) => return Err(format!("expected ProgramNotFound, got {other:?}").into()),
        Ok(child) => {
            return Err(
                format!("started a program that does not exist (pid {})", child.id()).into(),
            );
        }
    }
    Ok(())
}

#[tokio::test]
async fn a_missing_working_directory_is_an_error() -> TestResult {
    let dir = tempfile::tempdir()?;
    let missing = dir.path().join("deleted-project");
    match spawn_hidden("git", ["--version"], Some(&missing), &[]) {
        Err(SpawnError::InvalidCwd { path }) => assert_eq!(path, missing),
        Err(other) => return Err(format!("expected InvalidCwd, got {other:?}").into()),
        Ok(_) => return Err("started a process in a directory that does not exist".into()),
    }
    Ok(())
}

#[test]
fn spawning_outside_a_tokio_runtime_is_an_error() {
    let result = spawn_hidden("git", ["--version"], None, &[]);
    assert!(
        matches!(result, Err(SpawnError::NoRuntime)),
        "got {result:?}"
    );
}

#[tokio::test]
async fn the_child_runs_in_the_requested_directory() -> TestResult {
    let dir = tempfile::tempdir()?;
    let child = spawn_hidden(probe(), ["cwd"], Some(dir.path()), &[])?;
    let output = timeout(STARTUP, child.wait_with_output()).await??;
    assert!(output.status.success(), "probe failed: {:?}", output.status);
    // Canonicalize both sides: macOS reports /private/var for /var, and Windows CI temp paths use
    // 8.3 short names.
    let reported = std::fs::canonicalize(output.stdout.text().trim())?;
    assert_eq!(reported, std::fs::canonicalize(dir.path())?);
    Ok(())
}

#[tokio::test]
async fn env_overrides_set_and_remove_variables_in_order() -> TestResult {
    // PATH stands in for the scrubbed agent variables (CLAUDECODE and friends): every OS and CI
    // runner sets it, so removing it proves an inherited variable can be dropped.
    assert!(
        std::env::var_os("PATH").is_some(),
        "the test process should have PATH"
    );
    let overrides = [
        EnvOverride::set("AURA_SPIKE_SET", "hello"),
        EnvOverride::set("AURA_SPIKE_LAST_WINS", "first"),
        EnvOverride::remove("AURA_SPIKE_LAST_WINS"),
        EnvOverride::remove("PATH"),
    ];
    let names = ["env", "AURA_SPIKE_SET", "AURA_SPIKE_LAST_WINS", "PATH"];
    let child = spawn_hidden(probe(), names, None, &overrides)?;
    let output = timeout(STARTUP, child.wait_with_output()).await??;
    let text = output.stdout.text();
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    assert_eq!(
        lines,
        [
            "AURA_SPIKE_SET=hello",
            "AURA_SPIKE_LAST_WINS unset",
            "PATH unset"
        ]
    );
    Ok(())
}

#[tokio::test]
async fn kill_tree_after_the_child_exited_is_not_an_error() -> TestResult {
    // Exited and already reaped.
    let mut child = spawn_hidden("git", ["--version"], None, &[])?;
    let status = timeout(STARTUP, child.wait()).await??;
    assert!(status.success());
    assert_eq!(kill_tree(&mut child).await?.code(), status.code());

    // Exited but not reaped yet: a zombie on Unix, and macOS answers EPERM when signalling a
    // process group that only holds zombies.
    let mut child = spawn_hidden("git", ["--version"], None, &[])?;
    timeout(STARTUP, child.wait_for_output(Pipe::Stdout, |_| None::<()>)).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    kill_tree(&mut child).await?;
    Ok(())
}

#[cfg(windows)]
#[tokio::test]
async fn the_job_kills_the_tree_when_its_owner_dies_without_cleanup() -> TestResult {
    // The owner exits without running a destructor, like a crash. The kernel closes its handles,
    // the job's last handle goes with them, and KILL_ON_JOB_CLOSE takes the sleeper down.
    let (mut owner, sleeper) = crashing_owner().await?;
    let status = timeout(STARTUP, owner.wait()).await??;
    assert!(status.success(), "owner: {status:?}");
    assert!(
        sleeper.0.wait_gone(GONE_WITHIN).await?,
        "sleeper {} outlived its owner, so the job did not close",
        sleeper.0.pid()
    );
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn unix_has_no_kernel_cleanup_when_the_owner_crashes() -> TestResult {
    // The documented gap: nothing in the Unix kernel ties a process group to auracode's lifetime,
    // so a crash leaves the tree running and M1a's startup sweep of recorded pids has to find it.
    let (mut owner, sleeper) = crashing_owner().await?;
    let status = timeout(STARTUP, owner.wait()).await??;
    assert!(status.success(), "owner: {status:?}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        sleeper.0.is_running()?,
        "expected the sleeper to survive its owner on Unix"
    );
    Ok(())
}

#[cfg(windows)]
mod windows_console {
    use windows_spawn::inspect::ConsoleReport;

    use super::*;

    fn gui_host() -> PathBuf {
        helper_binary(env!("CARGO_BIN_EXE_gui-host"))
    }

    /// Parses what `spawn-probe console --grandchild` prints: the child's report, then the
    /// grandchild's.
    fn child_and_grandchild(
        stdout: &[u8],
    ) -> Result<(ConsoleReport, ConsoleReport), Box<dyn Error>> {
        let text = String::from_utf8_lossy(stdout);
        let reports = text
            .lines()
            .map(|line| line.parse::<ConsoleReport>())
            .collect::<Result<Vec<_>, _>>()?;
        match reports.as_slice() {
            [child, grandchild] => Ok((*child, *grandchild)),
            _ => Err(format!("expected two console reports, got {text:?}").into()),
        }
    }

    /// Runs the probe from the GUI-subsystem host, the same kind of parent as the Tauri app.
    async fn via_gui_host(style: &str) -> Result<(ConsoleReport, ConsoleReport), Box<dyn Error>> {
        let output = timeout(
            STARTUP,
            tokio::process::Command::new(gui_host())
                .args(["--report", style, "--probe"])
                .arg(probe())
                .stdin(Stdio::null())
                .output(),
        )
        .await??;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gui-host --report {style} failed: {stderr}").into());
        }
        child_and_grandchild(&output.stdout)
    }

    fn assert_hidden(child: ConsoleReport, grandchild: ConsoleReport) {
        assert!(
            child.attached() && child.shows_no_window(),
            "child: {child}"
        );
        assert!(
            grandchild.attached() && grandchild.shows_no_window(),
            "grandchild: {grandchild}"
        );
        assert!(
            grandchild.console_processes >= 2,
            "the grandchild should share the child's hidden console: {grandchild}"
        );
    }

    #[tokio::test]
    async fn hidden_child_and_grandchild_share_a_windowless_console() -> TestResult {
        let child = spawn_hidden(probe(), ["console", "--grandchild"], None, &[])?;
        let output = timeout(STARTUP, child.wait_with_output()).await??;
        assert!(
            output.status.success(),
            "probe failed: {}",
            output.stderr.text()
        );
        let (child, grandchild) = child_and_grandchild(&output.stdout.bytes)?;
        assert_hidden(child, grandchild);
        Ok(())
    }

    #[tokio::test]
    async fn gui_parent_hidden_spawn_shows_no_console_window() -> TestResult {
        let (child, grandchild) = via_gui_host("hidden").await?;
        assert_hidden(child, grandchild);
        Ok(())
    }

    #[tokio::test]
    async fn control_gui_parent_plain_spawn_gets_a_console_window() -> TestResult {
        // The flash itself: without CREATE_NO_WINDOW, a console child of a GUI app gets a console
        // with a window, and its own console children share that window.
        let (child, grandchild) = via_gui_host("plain").await?;
        assert!(child.attached() && child.has_window, "child: {child}");
        assert!(
            grandchild.console_processes >= 2 && grandchild.has_window,
            "grandchild: {grandchild}"
        );
        Ok(())
    }

    #[tokio::test]
    async fn control_detached_process_pushes_the_window_down_to_the_grandchild() -> TestResult {
        // Why not DETACHED_PROCESS: the child has no console at all, so every console program it
        // starts (bash, git) allocates a new one, with a window.
        let (child, grandchild) = via_gui_host("detached").await?;
        assert!(!child.attached() && !child.has_window, "child: {child}");
        assert!(
            grandchild.attached() && grandchild.has_window,
            "grandchild: {grandchild}"
        );
        Ok(())
    }
}
