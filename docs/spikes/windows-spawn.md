# Spike: spawning agents on Windows

M0 spike 2 ("Windows spawning: hidden console, git child").
Code: `docs/spikes/windows-spawn/`, a standalone Cargo project with its own lockfile (the root
workspace excludes `docs/spikes`). A tool call that runs git must never pop a window, and stopping
an agent must stop everything it started.

**Status:** pending Windows verification. The design below was drawn on 2026-10-24 from sources
and from runs on macOS; its Windows code paths compile but have never run on Windows. The
windows-2025 results in [What the tests prove](#what-the-tests-prove) and the
[manual checklist](#manual-checklist-the-users-windows-pc) are what turn it into a decision.

## Decision

Spawn every agent through `process-wrap` 10.0.1 (features `tokio1`, `creation-flags`,
`job-object`, `kill-on-drop`, `process-group`; default features off).

| | Windows | macOS, Linux |
|---|---|---|
| Console | `CREATE_NO_WINDOW` on the agent | not applicable |
| Process tree | Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigned while the agent is still suspended | the agent leads a new process group (`process_group(0)`) |
| `kill_tree` | `TerminateJobObject` | `killpg(SIGKILL)` |
| Handle dropped | the job handle closes and the kernel kills the tree | `Drop` sends `killpg(SIGKILL)` |
| auracode crashes or is killed | the kernel closes the job handle, so the tree dies | the tree keeps running (startup sweep needed) |
| stdio | all three piped; stdout and stderr drained by background tasks | same |

`DETACHED_PROCESS` is rejected; see below. The whole wrapper stack:

```rust
let mut command = CommandWrap::from(tokio_command); // stdin, stdout, stderr piped
command.wrap(KillOnDrop);                            // also turns on KILL_ON_JOB_CLOSE
#[cfg(windows)]
command.wrap(CreationFlags(CREATE_NO_WINDOW)).wrap(JobObject);
#[cfg(unix)]
command.wrap(ProcessGroup::leader());
```

## Why process-wrap and not hand-written windows-sys

- **The race.** A process inherits job membership only if its parent was already in the job when
  it was created. Spawning normally and then calling `AssignProcessToJobObject` leaves a window in
  which a fast agent starts a grandchild outside the job. The fix is to create the agent with
  `CREATE_SUSPENDED`, assign it, then resume it, but std's `Child` never exposes the main thread
  handle needed to resume it. process-wrap does exactly this (it resumes through a Toolhelp thread
  snapshot) and keeps our `CREATE_NO_WINDOW` next to its temporary `CREATE_SUSPENDED`. By hand it
  means the same Toolhelp walk, or calling `CreateProcessW` ourselves with
  `PROC_THREAD_ATTRIBUTE_JOB_LIST`, which std only reaches through the unstable `raw_attribute`.
- **One API for both platforms.** The same `CommandWrap` gives process groups, the group kill, and
  group reaping on Unix.
- **Maintained and tested.** It is watchexec's process layer and ships Windows tests for the
  flags-plus-job combination and for kill-on-drop.
- **Costs.** It pulls in the `windows` 0.62 crate (plus `futures` and `indexmap`, and `nix` on
  Unix), and the thread snapshot walks every thread on the machine once per spawn, which does not
  matter at the rate agents start. Its Tokio `KillOnDrop` only kills the direct child on Unix, so
  `HiddenChild` adds its own group kill on drop.
- The spawn path has no `unsafe`. The only `unsafe` in the spike is in the process-inspection
  helpers the tests use and in the demo's message box, each block with a SAFETY comment.

## Flags (Windows)

| Flag | Used | Why |
|---|---|---|
| `CREATE_NO_WINDOW` (0x08000000) | yes, on the agent | a console with no window, which console descendants inherit |
| `CREATE_SUSPENDED` (0x4) | briefly, by process-wrap | the job is assigned before the agent runs; resumed right after |
| `DETACHED_PROCESS` (0x8) | never | no console at all, so every console program below it gets its own window |
| `CREATE_NEW_CONSOLE` (0x10) | never | a visible console window |
| `CREATE_NEW_PROCESS_GROUP` (0x200) | no | only steers Ctrl+C inside a shared console; the agent has its own console, and shutdown does not use console control events |
| `CREATE_BREAKAWAY_FROM_JOB`, `JOB_OBJECT_LIMIT_BREAKAWAY_OK` | no | nothing may leave the job (see below) |

## Why CREATE_NO_WINDOW and not DETACHED_PROCESS

The Tauri app is a GUI-subsystem process, so it has no console. Windows picks a new process's
console when it is created:

1. Console program, parent has a console, no flags: it shares the parent's console.
2. Console program, parent has no console (a GUI app), no flags: a new console with a window. This
   is the flash.
3. `CREATE_NO_WINDOW`: a new console without a window.
4. `DETACHED_PROCESS`: no console at all.

Agents start shells and shells start git with no flags, so descendants land in case 1 or 2. Under
`CREATE_NO_WINDOW` the agent owns a windowless console, every descendant hits case 1 and shares it,
and nothing in the tree can flash. Under `DETACHED_PROCESS` the agent has no console, so every
console program it starts hits case 2: the flash moves one level down instead of going away. The
`control_` tests check both outcomes from a GUI-subsystem parent; like every Windows test here, they
have not run on Windows yet.

Limit: a descendant that passes its own `DETACHED_PROCESS` or `CREATE_NEW_CONSOLE` re-creates the
problem for its own children (Node's `spawn` with `detached: true` uses `DETACHED_PROCESS`); no flag
on our side reaches that far. Node's `windowsHide` adds `CREATE_NO_WINDOW` (when none of the
child's stdio is inherited) and is harmless.

## The Job Object

- `CreateJobObjectW(NULL, NULL)`: the handle is not inheritable, so no descendant can keep the job
  alive. process-wrap attaches a completion port, and registering `KillOnDrop` makes it set
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
- `kill_tree` is `TerminateJobObject`: every process in the job, including descendants whose parent
  already exited (the dev server an agent leaves behind) and jobs nested under ours.
- A process's handles close when it exits, crash and Task Manager kill included, so the job's last
  handle goes with auracode and `KILL_ON_JOB_CLOSE` kills the tree. Nothing outlives the app on
  Windows, and no startup sweep is needed there.
- Nested jobs (Windows 8 and later) let tools put children in jobs of their own inside ours; libuv
  does this for every child Node does not detach. Libuv's job allows silent breakaway, but a
  breakaway stops at the first enclosing job that forbids it, which is ours, so everything stays in.
- Breakaway is forbidden on purpose. Consequence: a vendor daemon that an agent starts during a
  session stays in our job and dies with it (Node's `detached: true` does not request breakaway),
  while on Unix a daemon that calls `setsid` survives the group kill. If a vendor daemon ever has
  to outlive sessions, the only fix is `JOB_OBJECT_LIMIT_BREAKAWAY_OK` plus a daemon that asks for
  `CREATE_BREAKAWAY_FROM_JOB`. auracode never touches processes outside its own jobs, so daemons
  that were already running are safe either way.
- If auracode itself runs inside a job that forbids nesting (one with UI restrictions), assignment
  fails: process-wrap kills the half-started child and `spawn_hidden` returns `SpawnError::Spawn`.
  No common launcher does this; M1a can decide whether to fall back to a spawn without a job.
- There is no SIGTERM for a process attached to another console. Graceful shutdown on Windows is
  the protocol interrupt plus closing stdin; `TerminateJobObject` is the last step.

## Unix

- The agent leads a new process group, and `killpg(SIGKILL)` reaches every member.
- Escapes: a descendant that calls `setsid` or `setpgid` leaves the group (daemons, and shells with
  job control such as `bash -i` or `set -m`, which put each background job in its own group). The
  plan's "walk descendants by parent pid" covers those still parented under the agent; walk before
  killing, because orphans are reparented to init.
- No crash cleanup: nothing in the kernel ties a group to auracode's lifetime. `PR_SET_PDEATHSIG`
  is per thread on Linux and covers only the direct child, which makes it unsafe with Tokio's
  worker threads, and macOS has nothing comparable. The plan's startup sweep (pid plus start time,
  own leftovers only) is required on macOS and Linux.
- Descendants running as another user (`sudo`) cannot be signalled.
- macOS: `killpg` returns `EPERM`, not `ESRCH`, when the group holds only zombies (checked on macOS
  26.6). `kill_tree` treats that as "gone" only once the agent itself has exited.
- Once every member is dead the group id can be recycled, so a very late `killpg` could in theory
  hit an unrelated group. PIDs are allocated sequentially, so that needs a pid wraparound between
  the agent's exit and the kill; accepted.

## Output

- stdin, stdout and stderr are piped. Background tasks read stdout and stderr continuously into
  buffers that keep the newest 4 MiB per stream and count every byte, so the child never blocks on
  a full pipe (a pipe holds a few KiB to 64 KiB). Without that, a caller that reads only stdout
  deadlocks once the child fills stderr: with the stderr drain removed, the stdout reader in
  `a_full_stderr_pipe_never_blocks_a_stdout_reader` hung until its 30 s timeout.
- Descendants inherit the pipes (std passes `bInheritHandles = TRUE` on Windows; fds 0 to 2 on
  Unix), so end-of-file only arrives once the whole tree is gone. `wait_with_output` therefore kills
  leftovers once the agent exits and then drains to end-of-file, with a 2 s grace for a Unix daemon
  that escaped the group and still holds a pipe.
- `wait_for_output` re-checks the capture as bytes arrive, which is how a caller reads a line while
  the child keeps running. M1a replaces the stdout capture with its line framer; the stderr tail
  stays.

## API (what M1a ports into aura-core)

```rust
pub fn spawn_hidden<I, S>(
    program: impl AsRef<OsStr>,
    args: I,
    cwd: Option<&Path>,
    env_overrides: &[EnvOverride],
) -> Result<HiddenChild, SpawnError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>;
pub async fn kill_tree(child: &mut HiddenChild) -> io::Result<ExitStatus>;

pub enum EnvOverride { Set(OsString, OsString), Remove(OsString) } // EnvOverride::set / ::remove
pub enum SpawnError {
    ProgramNotFound { program: String, source: io::Error },
    InvalidCwd { path: PathBuf },
    NoRuntime,
    Spawn { program: String, source: io::Error },
}
pub enum Pipe { Stdout, Stderr }
pub struct Captured { pub bytes: Vec<u8>, pub total_len: u64, pub complete: bool } // is_truncated(), text()
pub struct Output { pub status: ExitStatus, pub stdout: Captured, pub stderr: Captured }
pub const CAPTURE_LIMIT: usize = 4 * 1024 * 1024;
pub const PIPE_EOF_GRACE: Duration = Duration::from_secs(2);

impl HiddenChild { // Drop kills the tree
    pub fn id(&self) -> u32;
    pub fn take_stdin(&mut self) -> Option<ChildStdin>;
    pub fn captured(&self, pipe: Pipe) -> Captured;
    pub async fn wait_for_output<T>(&mut self, pipe: Pipe, parse: impl FnMut(&[u8]) -> Option<T>) -> Option<T>;
    pub async fn wait(&mut self) -> io::Result<ExitStatus>;
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    pub async fn kill_tree(&mut self) -> io::Result<ExitStatus>;
    pub async fn wait_with_output(self) -> io::Result<Output>;
}
```

`spawn_hidden` needs a Tokio runtime with IO and timers enabled; outside one it returns
`SpawnError::NoRuntime` instead of panicking.

## What the tests prove

`cargo test --manifest-path docs/spikes/windows-spawn/Cargo.toml` runs the whole suite locally.
ci.yml's rust job runs it on windows-2025 and ubuntu-24.04 in steps: it builds the spike, runs
the unit tests, stages the integration tests beside their helpers
(`.github/scripts/stage-spawn-spike.sh`) and runs them from that folder, which also proves the
folder works on its own, and on Windows uploads the folder as the `windows-spawn-spike-<sha>`
artifact for the [manual checklist](#manual-checklist-the-users-windows-pc). None of that has run:
the workflows are pushed, but GitHub Actions is blocked for the account by a billing problem, so
the first CI run on `m0-scaffold` ran no job. Until one gets through, the evidence is macOS only.
The suite passes there (25 consecutive runs with no leftover processes when it was written, and
one more run while this doc was revised), and the Windows paths type-check and lint clean
(`cargo clippy --target x86_64-pc-windows-gnu --all-targets -- -D warnings`), which proves that
they compile, not that they work.

When a CI run finishes, replace each pending cell with pass or fail and link the run here.

| Test | Proves | macOS result | ubuntu-24.04 result | windows-2025 result |
|---|---|---|---|---|
| `captures_git_version_from_stdout` | a hidden spawn runs real git and captures its stdout | pass | pending | pending |
| `kill_tree_kills_the_grandchild` | a 60 s grandchild of a shell (`sh -c 'sleep 60 & echo $!; wait'`; `cmd /d /c ping -n 60 127.0.0.1`, found by parent pid) is gone within 5 s of `kill_tree` | pass | pending | pending |
| `kill_tree_reaches_grandchildren_that_outlive_their_shell` | the same after the shell already exited (`&` without `wait`; `start /b`) | pass | pending | pending |
| `dropping_the_handle_kills_the_tree` | dropping the handle without `kill_tree` kills the tree | pass | pending | pending |
| `a_full_stderr_pipe_never_blocks_a_stdout_reader` | 1 MiB on stderr before any stdout: a stdout-only reader still gets its 1 MiB | pass | pending | pending |
| `huge_output_is_capped_in_memory_but_read_to_the_end` | 9 MiB of output: memory capped at 4 MiB, every byte read | pass | pending | pending |
| `stdin_is_piped_and_dropping_it_sends_end_of_file` | stdin is writable and closing it ends the child's input | pass | pending | pending |
| `a_missing_program_is_an_error_not_a_panic` | `SpawnError::ProgramNotFound` | pass | pending | pending |
| `a_missing_working_directory_is_an_error` | `SpawnError::InvalidCwd` | pass | pending | pending |
| `spawning_outside_a_tokio_runtime_is_an_error` | `SpawnError::NoRuntime`, no panic | pass | pending | pending |
| `the_child_runs_in_the_requested_directory` | `cwd` is honoured | pass | pending | pending |
| `env_overrides_set_and_remove_variables_in_order` | set, remove an inherited variable (`PATH`), last entry wins | pass | pending | pending |
| `kill_tree_after_the_child_exited_is_not_an_error` | reaped and unreaped exits, including the macOS `EPERM` case | pass | pending | pending |
| `the_job_kills_the_tree_when_its_owner_dies_without_cleanup` | an owner that exits without running destructors takes its tree with it | n/a (Windows only) | n/a (Windows only) | pending |
| `unix_has_no_kernel_cleanup_when_the_owner_crashes` | the gap: the tree survives its owner | pass | pending | n/a (Unix only) |
| `windows_console::hidden_child_and_grandchild_share_a_windowless_console` | the hidden child has a console but no visible window, and its plain-spawned grandchild shares that console | n/a (Windows only) | n/a (Windows only) | pending |
| `windows_console::gui_parent_hidden_spawn_shows_no_console_window` | the same from a GUI-subsystem parent, like the Tauri app | n/a (Windows only) | n/a (Windows only) | pending |
| `windows_console::control_gui_parent_plain_spawn_gets_a_console_window` | control: without the flag, the child gets a console window | n/a (Windows only) | n/a (Windows only) | pending |
| `windows_console::control_detached_process_pushes_the_window_down_to_the_grandchild` | control: with `DETACHED_PROCESS` the child has no console and its grandchild gets a window | n/a (Windows only) | n/a (Windows only) | pending |

"No console window" is checked from inside each process: `GetConsoleProcessList` is above zero (it
has a console), `GetConsoleWindow` returns no window or a hidden one, and the grandchild's console
lists two or more processes (it shares the child's console instead of getting its own). The GUI
parent is `gui-host`, a GUI-subsystem binary in the spike. Mutation checks on macOS: removing the
process group, the `Drop` kill, the stderr drain, or the `EPERM` handling each fails its test.

CI cannot prove what is drawn on a real desktop (it reads window handles, not pixels), Windows 10,
or Windows Terminal set as the default terminal; the manual checklist covers those. Real agent
stacks (node, Git Bash) come with the real agents in M1a and M1e.

## Manual checklist (the user's Windows PC)

It runs two ways, with the same steps and pass criteria. Either way the PC needs Git for Windows on
its PATH, since the tests and `gui-host.exe` run real git.

- **Without Rust, from CI's artifact.** Every Windows run of ci.yml's rust job uploads the artifact
  `windows-spawn-spike-<sha>` (`<sha>` is the full commit hash; uploaded even when the tests fail,
  kept for 7 days). None exists yet, since GitHub Actions is blocked for the account by a billing
  problem. Once one does, download it from the run's page or with
  `gh run download <run id> --name windows-spawn-spike-<sha>`, and keep its three executables
  (`windows-spawn-tests.exe`, `spawn-probe.exe`, `gui-host.exe`) together in any folder; they need
  no Visual C++ Redistributable, and the README.txt beside them repeats step 1. Step 1 then runs
  from a terminal in that folder as `.\windows-spawn-tests.exe --skip control_`, and steps 2 and 3
  use the folder's `gui-host.exe`.
- **With Rust** (rustup, with the MSVC build tools it offers to install): run the commands in the
  table from the repo root.

Write pass or fail into each row, with the Windows build number.

| # | Step | Pass when | Result |
|---|---|---|---|
| 1 | `cargo test --manifest-path docs/spikes/windows-spawn/Cargo.toml -- --skip control_` (from the artifact: `.\windows-spawn-tests.exe --skip control_`) | every test passes and no console window appears (the two `control_` tests flash windows on purpose, so they are skipped here) | pending |
| 2 | Double-click `gui-host.exe`: the artifact's, or with Rust `docs\spikes\windows-spawn\target\debug\gui-host.exe` (step 1 builds it) | for about 4 seconds nothing appears while cmd runs git three times, then a message box lists three `git version` lines and "ping ... exited within 5 s: yes"; any console window flashing is a fail | pending |
| 3 | Run `gui-host.exe --compare` | a console window does appear for a few seconds: the flash the hidden spawn prevents (a control, so seeing the window is the pass) | pending |
| 4 | After step 2, open Task Manager's Details tab | no `PING.EXE` is left | pending |
| 5 | If Windows Terminal is installed, make it the default terminal app (Settings > System > For developers > Terminal) and repeat step 2 | still nothing appears | pending |
| 6 | On a Windows 10 machine, if one is available, repeat steps 1, 2 and 4 | the same results as on Windows 11 | n/a until a Windows 10 machine is available |

## Carry-over for M1a and M1e

- Port the wrapper stack, the drains, and the `Drop` group kill into aura-core's process
  lifecycle. Keep `CREATE_NO_WINDOW`; never `DETACHED_PROCESS`.
- The startup sweep of recorded pids is needed on macOS and Linux only.
- Graceful shutdown on Windows: protocol interrupt, close stdin, wait, then `kill_tree`.
- Windows program resolution: std only appends `.exe` when searching, so `claude` does not find
  npm's `claude.cmd` shim, and spawning a `.cmd` by its full name goes through cmd.exe with std's
  batch-file escaping, which refuses some arguments. M1e launches the package's real entry point or
  bundled exe, as planned.
- Unix process groups miss job-control shells and `setsid` daemons; do the descendant walk before
  the kill.
