//! Clone checks with a synthetic Git, and real clones from a local bare repository. The real-Git
//! cases use an isolated, empty Git configuration and are skipped when Git is not installed.
use super::*;
use aura_process::{EnvMap, EnvSource, LeftoverRegistry, Spawner};
use std::process::Command;

fn env_with(vars: EnvMap) -> Arc<ResolvedEnv> {
    Arc::new(ResolvedEnv {
        vars,
        source: EnvSource::Fallback {
            reason: "test".into(),
        },
        warnings: vec![],
        resolved_at_ms: 0,
    })
}

/// A PATH holding only a file named git that is never run.
fn synthetic_git(folder: &Path) -> Arc<ResolvedEnv> {
    let bin = folder.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let git = bin.join(if cfg!(windows) { "git.exe" } else { "git" });
    std::fs::write(&git, "synthetic executable, never run").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut vars = EnvMap::new();
    vars.insert("PATH".into(), bin.as_os_str().to_owned());
    env_with(vars)
}

fn input(remote: &str, parent: Option<&Path>, name: Option<&str>) -> CloneInput {
    CloneInput {
        remote: remote.into(),
        parent: parent.map(|path| path.to_string_lossy().into_owned()),
        name: name.map(str::to_owned),
    }
}

fn entries(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn a_check_is_inert_and_puts_each_problem_beside_its_field() {
    let temp = tempfile::tempdir().unwrap();
    let env = synthetic_git(temp.path());
    let parent = temp.path().join("code");
    std::fs::create_dir(&parent).unwrap();
    let service = Clones::default();
    let check = |value: CloneInput, env: Arc<ResolvedEnv>| service.check("main", value, env);

    let found = check(
        input("file:///srv/repo.git", Some(&parent), None),
        Arc::clone(&env),
    )
    .await
    .unwrap();
    assert_eq!(found.problem.unwrap().field, CloneField::Remote);
    assert!(found.review.is_none() && found.repository.is_none());

    let found = check(
        input("https://github.com/owner/repo", None, None),
        Arc::clone(&env),
    )
    .await
    .unwrap();
    assert_eq!(found.problem.unwrap().field, CloneField::Parent);
    assert_eq!(found.repository.as_deref(), Some("owner/repo"));
    assert_eq!(found.name.as_deref(), Some("repo"));

    std::fs::create_dir(parent.join("taken")).unwrap();
    let found = check(
        input(
            "https://github.com/owner/repo",
            Some(&parent),
            Some("taken"),
        ),
        Arc::clone(&env),
    )
    .await
    .unwrap();
    let problem = found.problem.unwrap();
    assert_eq!(problem.field, CloneField::Name);
    assert!(problem.message.contains("already has a taken folder"));

    let found = check(
        input("https://github.com/owner/repo", Some(&parent), Some("..")),
        Arc::clone(&env),
    )
    .await
    .unwrap();
    assert_eq!(found.problem.unwrap().field, CloneField::Name);

    let found = check(
        input("https://github.com/owner/repo", Some(&parent), None),
        env_with(EnvMap::new()),
    )
    .await
    .unwrap();
    assert_eq!(found.problem.unwrap().field, CloneField::Git);

    let found = check(
        input("git@github.com:owner/repo.git", Some(&parent), None),
        Arc::clone(&env),
    )
    .await
    .unwrap();
    assert!(found.problem.is_none());
    let review = found.review.unwrap();
    let destination = plain_path(&std::fs::canonicalize(&parent).unwrap()).join("repo");
    let destination = destination.to_string_lossy().into_owned();
    assert_eq!(review.destination, destination);
    assert_eq!(
        review.arguments,
        [
            "clone",
            "--progress",
            "--",
            "git@github.com:owner/repo.git",
            destination.as_str()
        ]
    );
    assert_eq!(
        review.command,
        format!("git clone --progress -- git@github.com:owner/repo.git {destination}")
    );
    assert_eq!(
        entries(&parent),
        ["taken"],
        "checking never creates a folder or runs Git"
    );

    // A typed name with a space is quoted for display only.
    let spaced = check(
        input(
            "https://github.com/owner/repo",
            Some(&parent),
            Some("My repo"),
        ),
        Arc::clone(&env),
    )
    .await
    .unwrap()
    .review
    .unwrap();
    assert!(spaced.command.ends_with("My repo\""));
    assert!(spaced.arguments[4].ends_with("My repo"));

    // Reviews belong to their window and start once.
    assert!(service.take("other", &review.id).is_err());
    service.cancel("main", &review.id);
    assert!(service.take("main", &review.id).is_err());
    let review = check(
        input("https://github.com/owner/repo", Some(&parent), None),
        Arc::clone(&env),
    )
    .await
    .unwrap()
    .review
    .unwrap();
    let (prepared, job) = service.take("main", &review.id).unwrap();
    assert!(service.take("main", &review.id).is_err());
    // Canceled before Git starts: nothing is created.
    service.drop_owner("main");
    execute(
        prepared,
        Arc::clone(&job),
        Spawner::new(
            LeftoverRegistry::disabled(),
            tokio::runtime::Handle::current(),
        ),
    )
    .await;
    assert_eq!(job.snapshot().state, CloneState::Canceled);
    assert_eq!(entries(&parent), ["taken"]);
}

#[tokio::test]
async fn typing_keeps_only_the_newest_reviews_per_window() {
    let temp = tempfile::tempdir().unwrap();
    let env = synthetic_git(temp.path());
    let service = Clones::default();
    let mut ids = Vec::new();
    for index in 0..12 {
        let review = service
            .check(
                "main",
                input(
                    &format!("https://github.com/owner/repo{index}"),
                    Some(temp.path()),
                    None,
                ),
                Arc::clone(&env),
            )
            .await
            .unwrap()
            .review
            .unwrap();
        ids.push(review.id);
    }
    assert_eq!(lock(&service.pending).len(), 8);
    assert!(!lock(&service.pending).contains_key(&ids[0]));
    assert!(lock(&service.pending).contains_key(&ids[11]));
}

#[test]
fn the_owned_folder_is_removed_with_read_only_files_and_a_replaced_one_is_kept() {
    let temp = tempfile::tempdir().unwrap();
    let env = synthetic_git(temp.path());
    let remote = validate::remote("https://github.com/owner/repo").unwrap();
    let prepared = plan(remote.clone(), "repo".into(), temp.path().to_str(), &env).unwrap();
    let destination = files::begin(prepared).map_err(|(_, error)| error).unwrap();
    let pack = temp.path().join("repo/.git/objects/pack");
    std::fs::create_dir_all(&pack).unwrap();
    std::fs::write(pack.join("pack-1.pack"), "read-only like Git's packs").unwrap();
    let mut permissions = std::fs::metadata(pack.join("pack-1.pack"))
        .unwrap()
        .permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(pack.join("pack-1.pack"), permissions).unwrap();
    assert!(files::remove(destination));
    assert!(!temp.path().join("repo").exists());

    // A folder put in its place is someone else's: it stays.
    let prepared = plan(remote, "repo".into(), temp.path().to_str(), &env).unwrap();
    let destination = files::begin(prepared).map_err(|(_, error)| error).unwrap();
    if std::fs::rename(temp.path().join("repo"), temp.path().join("moved")).is_ok() {
        std::fs::create_dir(temp.path().join("repo")).unwrap();
        std::fs::write(temp.path().join("repo/user.txt"), "keep").unwrap();
        assert!(!files::remove(destination));
        assert_eq!(
            std::fs::read(temp.path().join("repo/user.txt")).unwrap(),
            b"keep"
        );
    }
}

/// Git with an empty configuration of its own, so this computer's settings play no part.
fn real_git(temp: &Path) -> Option<Arc<ResolvedEnv>> {
    let mut vars = aura_process::process_env();
    for key in REPOSITORY_VARIABLES {
        vars.remove(&EnvKey::from(*key));
    }
    let config = temp.join("empty-gitconfig");
    std::fs::write(&config, "").unwrap();
    vars.insert("GIT_CONFIG_GLOBAL".into(), config.into_os_string());
    vars.insert("GIT_CONFIG_NOSYSTEM".into(), "1".into());
    find_exe("git", &vars)?;
    Some(env_with(vars))
}

fn git(env: &ResolvedEnv, folder: &Path, args: &[&str]) {
    let program = find_exe("git", &env.vars).unwrap();
    let status = Command::new(program)
        .args(args)
        .current_dir(folder)
        .env_clear()
        .envs(env.vars.iter().map(|(key, value)| (key.as_os_str(), value)))
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

/// A bare repository with one commit, reachable by a file:// URL.
fn bare_repository(temp: &Path, env: &ResolvedEnv) -> String {
    let work = temp.join("work");
    std::fs::create_dir(&work).unwrap();
    git(env, &work, &["init", "-q"]);
    std::fs::write(work.join("README.md"), "hello from the fixture\n").unwrap();
    git(env, &work, &["add", "README.md"]);
    git(
        env,
        &work,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.com",
            "commit",
            "-q",
            "-m",
            "First",
        ],
    );
    git(env, temp, &["clone", "-q", "--bare", "work", "source.git"]);
    file_url(&temp.join("source.git"))
}

fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    }
}

/// A review for an address the form would refuse (file://, http://), as only a test can make.
fn review_for(service: &Clones, url: &str, parent: &Path, env: &ResolvedEnv) -> String {
    let remote = validate::Remote {
        url: url.into(),
        repository: "fixture/source".into(),
        name: "source".into(),
    };
    let prepared = plan(remote, "clone".into(), parent.to_str(), env).unwrap();
    let id = prepared.view.id.clone();
    lock(&service.pending).insert(
        id.clone(),
        Pending {
            owner: "main".into(),
            prepared,
            created: Instant::now(),
        },
    );
    id
}

fn spawner() -> Arc<Spawner> {
    Spawner::new(
        LeftoverRegistry::disabled(),
        tokio::runtime::Handle::current(),
    )
}

#[tokio::test]
async fn a_real_clone_from_a_local_bare_repository_becomes_a_folder_with_its_files() {
    let temp = tempfile::tempdir().unwrap();
    let Some(env) = real_git(temp.path()) else {
        eprintln!("Git is not installed; skipped.");
        return;
    };
    let url = bare_repository(temp.path(), &env);
    let parent = temp.path().join("projects");
    std::fs::create_dir(&parent).unwrap();
    let service = Clones::default();
    let id = review_for(&service, &url, &parent, &env);
    let (prepared, job) = service.take("main", &id).unwrap();
    execute(prepared, Arc::clone(&job), spawner()).await;
    let record = service.status("main", &id, None).await.unwrap();
    assert_eq!(record.state, CloneState::Ready, "{}", record.detail);
    assert!(!record.removed);
    assert_eq!(
        std::fs::read_to_string(parent.join("clone/README.md")).unwrap(),
        "hello from the fixture\n"
    );
    assert!(parent.join("clone/.git").is_dir());
    if let Some(progress) = record.progress {
        assert_eq!(progress.percent, 100);
    }
    assert!(record.revision > 1, "progress and states were published");
}

#[tokio::test]
async fn a_failed_clone_removes_only_the_folder_it_created() {
    let temp = tempfile::tempdir().unwrap();
    let Some(env) = real_git(temp.path()) else {
        eprintln!("Git is not installed; skipped.");
        return;
    };
    let parent = temp.path().join("projects");
    std::fs::create_dir(&parent).unwrap();
    std::fs::write(parent.join("notes.txt"), "the person's file").unwrap();
    let service = Clones::default();
    let missing = file_url(&temp.path().join("missing.git"));
    let id = review_for(&service, &missing, &parent, &env);
    let (prepared, job) = service.take("main", &id).unwrap();
    execute(prepared, Arc::clone(&job), spawner()).await;
    let record = job.snapshot();
    assert_eq!(record.state, CloneState::Failed);
    assert!(record.removed, "{}", record.detail);
    assert!(
        record
            .detail
            .ends_with("The unfinished folder was removed.")
    );
    assert!(
        !record.output.is_empty(),
        "Git's own message is kept for the person"
    );
    assert_eq!(entries(&parent), ["notes.txt"]);

    // A folder someone else made after the check is never reused or removed.
    let id = review_for(&service, &missing, &parent, &env);
    let (prepared, job) = service.take("main", &id).unwrap();
    std::fs::create_dir(parent.join("clone")).unwrap();
    std::fs::write(parent.join("clone/mine.txt"), "keep").unwrap();
    execute(prepared, Arc::clone(&job), spawner()).await;
    let record = job.snapshot();
    assert_eq!(record.state, CloneState::Failed);
    assert!(!record.removed);
    assert!(record.detail.contains("already has a clone folder"));
    assert_eq!(
        std::fs::read(parent.join("clone/mine.txt")).unwrap(),
        b"keep"
    );
}

#[tokio::test]
async fn cancel_stops_git_and_removes_the_unfinished_folder() {
    let temp = tempfile::tempdir().unwrap();
    let Some(env) = real_git(temp.path()) else {
        eprintln!("Git is not installed; skipped.");
        return;
    };
    // A server that accepts Git's request and never answers, so the clone waits until canceled.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (connected, accepted) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming().flatten() {
            held.push(stream);
            let _ = connected.send(());
        }
    });
    let parent = temp.path().join("projects");
    std::fs::create_dir(&parent).unwrap();
    let service = Arc::new(Clones::default());
    let id = review_for(
        &service,
        &format!("http://127.0.0.1:{port}/repo.git"),
        &parent,
        &env,
    );
    let (prepared, job) = service.take("main", &id).unwrap();
    let running = tokio::spawn(execute(prepared, Arc::clone(&job), spawner()));
    tokio::task::spawn_blocking(move || accepted.recv_timeout(Duration::from_secs(30)))
        .await
        .unwrap()
        .expect("Git connected");
    assert!(
        parent.join("clone").is_dir(),
        "the owned folder exists while Git runs"
    );
    service.cancel("main", &id);
    tokio::time::timeout(Duration::from_secs(60), running)
        .await
        .expect("cancel stops the clone")
        .unwrap();
    let record = job.snapshot();
    assert_eq!(record.state, CloneState::Canceled);
    assert!(record.removed, "{}", record.detail);
    assert_eq!(
        record.detail,
        "Clone canceled. The unfinished folder was removed."
    );
    assert!(entries(&parent).is_empty());
}
