use super::*;
use aura_process::{LaunchSpec, ProcessCwd, ShutdownPlan, SpawnSpec, Spawner};
use std::ffi::OsString;
use tokio::io::{AsyncRead, AsyncReadExt};

pub(crate) async fn execute(prepared: Prepared, job: Arc<Job>, spawner: Arc<Spawner>) {
    if *job.canceled.borrow() {
        job.finish(CloneState::Canceled, "Canceled before creating a folder.");
        return;
    }
    let initial = job.snapshot();
    let destination =
        match tokio::task::spawn_blocking(move || files::begin(prepared, &initial)).await {
            Ok(Ok(destination)) => destination,
            Ok(Err(error)) => {
                job.finish(CloneState::Failed, &error.to_string());
                return;
            }
            Err(_) => {
                job.finish(
                    CloneState::Interrupted,
                    "Clone preparation stopped unexpectedly. Any recovery files were retained.",
                );
                return;
            }
        };
    let outcome = run(&destination, &job, &spawner, Duration::from_secs(600)).await;
    let (state, detail) = match outcome {
        Ok(value) => value,
        Err(error) => (CloneState::Failed, error.to_string()),
    };
    let mut record = job.snapshot();
    record.state = state;
    record.detail = detail.clone();
    if !matches!(
        tokio::task::spawn_blocking(move || files::finish(destination, &record)).await,
        Ok(Ok(()))
    ) {
        job.finish(CloneState::Interrupted, "Git stopped, but its final recovery record could not be saved. Inspect the retained destination before using or retrying it.");
    } else {
        job.finish(state, &detail);
    }
}

async fn run(
    destination: &files::Destination,
    job: &Job,
    spawner: &Spawner,
    timeout: Duration,
) -> Result<(CloneState, String)> {
    if *job.canceled.borrow() {
        return Ok((
            CloneState::Canceled,
            "Canceled before Git started. The empty destination and recovery record are retained."
                .into(),
        ));
    }
    files::matches(
        &destination.prepared.parent_handle,
        &destination.prepared.parent,
    )?;
    files::matches(
        &destination.directory,
        std::path::Path::new(&destination.prepared.view.destination),
    )?;
    if destination.directory.entries()?.next().is_some() {
        return Err(CloneError::message(
            "The new destination changed before Git started. Its contents were left unchanged.",
        ));
    }
    let spec = spec(destination);
    let raw = tokio::time::timeout(Duration::from_secs(15), spawner.spawn_raw(spec)).await
        .map_err(|_| CloneError::message("Git did not start within fifteen seconds. The destination and recovery record are retained."))?
        .map_err(|_| CloneError::message("Git could not start. Install Git or check folder access, then retry into a new folder."))?;
    raw.stdin.close();
    let stdout = tokio::spawn(discard(raw.stdout));
    let stderr = tokio::spawn(tail(raw.stderr));
    let mut canceled = job.canceled.subscribe();
    enum Stop {
        Exited(Option<i32>),
        Canceled,
        Timeout,
    }
    let stopped = tokio::select! {
        biased;
        _ = canceled.wait_for(|value| *value) => Stop::Canceled,
        exit = raw.control.exited() => Stop::Exited(exit.code),
        _ = tokio::time::sleep(timeout) => Stop::Timeout,
    };
    // Always clean up the owned tree, including helpers left after the Git leader exits. An
    // unconfirmed stop retains both process ownership and the caller's folder reservation.
    loop {
        let report = raw
            .control
            .retry_unconfirmed_shutdown(ShutdownPlan::FORCE)
            .await;
        if report.exit.is_some() && report.leftovers.is_empty() {
            break;
        }
        job.finish(CloneState::CleanupPending, "Waiting to confirm that this owned Git process stopped. Its destination and recovery record remain reserved.");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let mut stderr = stderr;
    let error_output = tokio::time::timeout(Duration::from_secs(2), &mut stderr)
        .await
        .ok()
        .and_then(|result| result.ok())
        .unwrap_or_default();
    stderr.abort();
    stdout.abort();
    if matches!(stopped, Stop::Exited(Some(0))) {
        files::matches(
            &destination.prepared.parent_handle,
            &destination.prepared.parent,
        )?;
        files::matches(
            &destination.directory,
            std::path::Path::new(&destination.prepared.view.destination),
        )?;
        use cap_fs_ext::DirExt;
        destination.directory.open_dir_nofollow(".git")?;
    }
    Ok(match stopped {
        Stop::Exited(Some(0)) => (CloneState::Ready, "Repository cloned. Choose Use this folder to add it to your project.".into()),
        Stop::Exited(_) => (CloneState::Failed, failure(&error_output).into()),
        Stop::Canceled => (CloneState::Canceled, "Clone canceled. Its partial folder and recovery record were retained. Retry into another new folder.".into()),
        Stop::Timeout => (CloneState::Failed, "The clone reached its ten-minute limit. Check the connection or repository size, then retry into a new folder. Partial files were retained.".into()),
    })
}

fn spec(destination: &files::Destination) -> SpawnSpec {
    let prepared = &destination.prepared;
    let journal =
        PathBuf::from(&prepared.view.parent).join(format!(".auracode-clone-{}", prepared.view.id));
    let mut arguments: Vec<OsString> = vec!["--no-pager".into()];
    for option in [
        format!(
            "core.hooksPath={}",
            path_argument(&journal.join("empty-hooks")).display()
        ),
        format!(
            "init.templateDir={}",
            path_argument(&journal.join("empty-template")).display()
        ),
        "core.fsmonitor=false".into(),
        "core.fsync=all".into(),
        "credential.helper=".into(),
        "credential.interactive=false".into(),
        "protocol.allow=never".into(),
        "protocol.https.allow=always".into(),
        "protocol.ssh.allow=always".into(),
        "http.followRedirects=false".into(),
        "submodule.recurse=false".into(),
    ] {
        arguments.extend(["-c".into(), option.into()]);
    }
    arguments.extend([
        "clone".into(),
        "--no-recurse-submodules".into(),
        "--no-local".into(),
        "--".into(),
        prepared.view.remote.clone().into(),
        ".".into(),
    ]);
    let empty = path_argument(&journal.join("empty-config")).into_os_string();
    let set_env = vec![
        ("GIT_CONFIG_GLOBAL".into(), empty.clone()),
        ("GIT_CONFIG_SYSTEM".into(), empty),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_ATTR_NOSYSTEM".into(), "1".into()),
        (
            "GIT_CEILING_DIRECTORIES".into(),
            path_argument(&prepared.parent).into_os_string(),
        ),
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
        ("GIT_ASKPASS".into(), OsString::new()),
        ("GCM_INTERACTIVE".into(), "never".into()),
        (
            "GIT_SSH_COMMAND".into(),
            "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=20".into(),
        ),
        ("GIT_SSH_VARIANT".into(), "ssh".into()),
    ];
    let folder = PathBuf::from(&prepared.view.destination);
    SpawnSpec {
        launch: LaunchSpec {
            label: "explicit GitHub clone".into(),
            program: prepared.program.clone(),
            args: arguments,
            cwd: ProcessCwd::Fixed(folder.clone()),
            set_env,
            daemons: vec![],
            startup_timeout: Duration::from_secs(15),
        },
        folder,
        env: Arc::clone(&prepared.env),
        max_line_bytes: aura_process::MAX_LINE_BYTES,
    }
}

async fn discard(mut reader: impl AsyncRead + Unpin) {
    let mut bytes = [0; 8192];
    while reader.read(&mut bytes).await.is_ok_and(|count| count > 0) {}
}
async fn tail(mut reader: impl AsyncRead + Unpin) -> Vec<u8> {
    let mut result = Vec::new();
    let mut bytes = [0; 8192];
    loop {
        let count = match reader.read(&mut bytes).await {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        result.extend_from_slice(&bytes[..count]);
        if result.len() > 16 * 1024 {
            result.drain(..result.len() - 16 * 1024);
        }
    }
    result
}
fn failure(bytes: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    if [
        "permission denied (publickey)",
        "authentication failed",
        "could not read username",
        "repository not found",
        "host key verification failed",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        "GitHub access could not be verified. Use a public HTTPS repository or configure SSH access and trusted host verification in your own tools, then retry into a new folder. No login was changed."
    } else if [
        "no space left",
        "disk full",
        "filename too long",
        "permission denied",
        "unable to create",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        "Git could not write the destination. Check free space, folder permissions and path length, then retry into a new folder. Partial files were retained."
    } else if [
        "could not resolve",
        "failed to connect",
        "connection",
        "timed out",
        "redirect",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        "Git could not reach the repository. Check the connection and exact GitHub URL, then retry into a new folder. Partial files were retained."
    } else {
        "Git could not complete the clone. Check access, connection and available disk space in your own tools, then retry into a new folder. Partial files and the recovery record were retained."
    }
}

fn path_argument(path: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let mut parts = path.components();
        let base = match parts.next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::VerbatimDisk(drive) => {
                    Some(PathBuf::from(format!("{}:\\", char::from(drive))))
                }
                Prefix::VerbatimUNC(server, share) => {
                    let mut base = OsString::from("\\\\");
                    base.push(server);
                    base.push("\\");
                    base.push(share);
                    Some(PathBuf::from(base))
                }
                _ => None,
            },
            _ => None,
        };
        if let Some(mut base) = base {
            for part in parts {
                if !matches!(part, Component::RootDir) {
                    base.push(part.as_os_str());
                }
            }
            return base;
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_classes_never_return_raw_git_output_or_tokens() {
        for bytes in [
            b"authentication failed secret=private".as_slice(),
            b"connection reset private",
            b"no space left private",
            b"unknown private",
        ] {
            let message = failure(bytes);
            assert!(!message.contains("private"));
            assert!(!message.contains("secret="));
        }
    }
}
