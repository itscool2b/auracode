//! A GUI-subsystem stand-in for the Tauri app, which has no console of its own. That missing
//! console is exactly what makes Windows give console children a window, so it is the parent the
//! hidden spawn has to be proven against.
//!
//! - `gui-host --report <hidden|plain|detached> --probe <path to spawn-probe>`: starts
//!   `spawn-probe console --grandchild` in one style and prints the child and grandchild console
//!   reports to stdout. The tests run this on CI.
//! - `gui-host` with no arguments (double-click it in Explorer): runs git through cmd the way an
//!   agent's shell does, kills a cmd -> ping tree, and shows the results in a message box. No
//!   console window may appear while it runs.
//! - `gui-host --compare`: the same git run started plainly, to show the flash the spike prevents.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    #[cfg(windows)]
    {
        host::main()
    }
    #[cfg(not(windows))]
    {
        eprintln!(
            "gui-host only demonstrates Windows console behaviour; there is nothing to show here"
        );
        ExitCode::SUCCESS
    }
}

#[cfg(windows)]
mod host {
    use std::{
        error::Error,
        io::{self, Write},
        os::windows::process::CommandExt,
        path::Path,
        process::ExitCode,
        time::Duration,
    };

    use windows::{
        Win32::{
            System::Threading::DETACHED_PROCESS,
            UI::WindowsAndMessaging::{
                MB_ICONINFORMATION, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND, MessageBoxW,
            },
        },
        core::PCWSTR,
    };
    use windows_spawn::{
        inspect::{WatchedProcess, wait_for_child},
        spawn_hidden,
    };

    type HostResult<T> = Result<T, Box<dyn Error>>;

    const PROBE_ARGS: [&str; 2] = ["console", "--grandchild"];
    const TIMEOUT: Duration = Duration::from_secs(60);

    /// The agent-shaped workload: a shell (cmd) that runs git three times over a few seconds,
    /// with pauses so a flashing window would be impossible to miss.
    const GIT_CHAIN: [&str; 22] = [
        "/d",
        "/c",
        "git",
        "--version",
        "&",
        "ping",
        "-n",
        "2",
        "127.0.0.1",
        ">nul",
        "&",
        "git",
        "--version",
        "&",
        "ping",
        "-n",
        "2",
        "127.0.0.1",
        ">nul",
        "&",
        "git",
        "--version",
    ];

    #[derive(Clone, Copy)]
    enum Style {
        Hidden,
        Plain,
    }

    pub fn main() -> ExitCode {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let interactive = !matches!(args.first().map(String::as_str), Some("--report"));
        let result = match args.first().map(String::as_str) {
            Some("--report") => report(&args[1..]),
            Some("--compare") => demo(Style::Plain),
            None => demo(Style::Hidden),
            Some(other) => Err(format!("unknown argument {other:?}").into()),
        };
        match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                if interactive {
                    show_message(&format!("The spike demo failed:\n\n{err}"), true);
                } else {
                    eprintln!("gui-host: {err}");
                }
                ExitCode::FAILURE
            }
        }
    }

    fn runtime() -> io::Result<tokio::runtime::Runtime> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
    }

    fn report(args: &[String]) -> HostResult<()> {
        let (style, probe) = match args {
            [style, flag, probe] if flag == "--probe" => (style.as_str(), Path::new(probe)),
            _ => {
                return Err(
                    "usage: gui-host --report <hidden|plain|detached> --probe <path>".into(),
                );
            }
        };
        let stdout = match style {
            "hidden" => runtime()?.block_on(async {
                let child = spawn_hidden(probe, PROBE_ARGS, None, &[])?;
                let output = tokio::time::timeout(TIMEOUT, child.wait_with_output()).await??;
                if !output.status.success() {
                    return Err(format!("probe failed: {}", output.stderr.text()).into());
                }
                HostResult::Ok(output.stdout.bytes)
            })?,
            // What a naive GUI app does: a console child gets a fresh console, window and all.
            "plain" => plain_output(std::process::Command::new(probe).args(PROBE_ARGS))?,
            // No console for the child, so each console program it starts allocates its own.
            "detached" => plain_output(
                std::process::Command::new(probe)
                    .args(PROBE_ARGS)
                    .creation_flags(DETACHED_PROCESS.0),
            )?,
            other => return Err(format!("unknown style {other:?}").into()),
        };
        let mut out = io::stdout().lock();
        out.write_all(&stdout)?;
        out.flush()?;
        Ok(())
    }

    fn plain_output(command: &mut std::process::Command) -> HostResult<Vec<u8>> {
        let output = command.output()?;
        if !output.status.success() {
            return Err(
                format!("probe failed: {}", String::from_utf8_lossy(&output.stderr)).into(),
            );
        }
        Ok(output.stdout)
    }

    fn demo(style: Style) -> HostResult<()> {
        let summary = runtime()?.block_on(async move {
            let mut summary = String::new();
            match style {
                Style::Hidden => {
                    summary.push_str(
                        "Hidden spawn (what auracode uses).\n\nNo console window should have \
                         appeared while this ran. If one did, the check failed.\n\n",
                    );
                    let child = spawn_hidden("cmd", GIT_CHAIN, None, &[])?;
                    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output()).await??;
                    summary.push_str(&format!(
                        "cmd ran git three times (exit {}):\n{}\n",
                        output.status,
                        output.stdout.text().trim()
                    ));
                    summary.push_str(&kill_check().await?);
                }
                Style::Plain => {
                    summary.push_str(
                        "Plain spawn (for comparison).\n\nA console window should have appeared \
                         for a few seconds: that is the flash the hidden spawn prevents.\n\n",
                    );
                    let output = tokio::time::timeout(
                        TIMEOUT,
                        tokio::process::Command::new("cmd").args(GIT_CHAIN).output(),
                    )
                    .await??;
                    summary.push_str(&format!(
                        "cmd ran git three times (exit {}):\n{}\n",
                        output.status,
                        String::from_utf8_lossy(&output.stdout).trim()
                    ));
                }
            }
            HostResult::Ok(summary)
        })?;
        show_message(&summary, false);
        Ok(())
    }

    /// Starts cmd -> ping (60 s), kills the tree, and reports whether ping died with it.
    async fn kill_check() -> HostResult<String> {
        let mut shell = spawn_hidden(
            "cmd",
            ["/d", "/c", "ping", "-n", "60", "127.0.0.1"],
            None,
            &[],
        )?;
        let pid = wait_for_child(shell.id(), "ping.exe", TIMEOUT)
            .await?
            .ok_or("cmd never started ping")?;
        let ping = WatchedProcess::open(pid)?;
        shell.kill_tree().await?;
        let gone = ping.wait_gone(Duration::from_secs(5)).await?;
        if !gone {
            ping.kill()?;
        }
        Ok(format!(
            "\nkill_tree on a cmd -> ping tree: ping (pid {pid}) exited within 5 s: {}\n",
            if gone { "yes" } else { "NO (the check failed)" }
        ))
    }

    #[allow(unsafe_code)]
    fn show_message(text: &str, is_error: bool) {
        let wide = |s: &str| {
            s.encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<u16>>()
        };
        let text = wide(text);
        let caption = wide("auracode spawn spike");
        let icon = if is_error {
            MB_ICONWARNING
        } else {
            MB_ICONINFORMATION
        };
        // SAFETY: both buffers are NUL-terminated UTF-16 that outlive the call, and a null owner
        // window is allowed.
        let _ = unsafe {
            MessageBoxW(
                None,
                PCWSTR(text.as_ptr()),
                PCWSTR(caption.as_ptr()),
                MB_OK | icon | MB_SETFOREGROUND,
            )
        };
    }
}
