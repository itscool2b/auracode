//! Explicit GitHub clones. Reviews are inert; every write belongs to a fresh directory and journal.
//! Recovery never deletes, replaces or resumes writes into an interrupted destination.
mod files;
mod process;
mod validate;

use aura_process::{EnvKey, ResolvedEnv, find_exe};
use aura_protocol::setup_actions::{CloneInput, CloneRecord, CloneReview, CloneState};
use cap_std::fs::Dir;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tokio::sync::watch;

type Result<T> = std::result::Result<T, CloneError>;
#[derive(Debug, thiserror::Error)]
pub enum CloneError {
    #[error("{0}")]
    Message(String),
    #[error(
        "The clone folder or recovery record could not be accessed. Its existing contents were retained."
    )]
    Io(#[from] std::io::Error),
}
impl CloneError {
    pub(crate) fn message(value: &str) -> Self {
        Self::Message(value.into())
    }
}

pub(crate) struct Prepared {
    pub(crate) view: CloneReview,
    pub(crate) parent: PathBuf,
    parent_handle: Dir,
    name: String,
    program: PathBuf,
    env: Arc<ResolvedEnv>,
    expires: Instant,
}
pub(crate) struct Job {
    owner: String,
    record: Mutex<CloneRecord>,
    canceled: watch::Sender<bool>,
}
impl Job {
    pub(crate) fn snapshot(&self) -> CloneRecord {
        lock(&self.record).clone()
    }
    pub(crate) fn finish(&self, state: CloneState, detail: &str) {
        let mut record = lock(&self.record);
        record.state = state;
        record.detail = detail.into();
    }
}

#[derive(Default)]
pub struct Clones {
    pending: Mutex<HashMap<String, (String, Prepared)>>,
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}
impl Drop for Clones {
    fn drop(&mut self) {
        self.cancel_all();
    }
}
impl Clones {
    pub async fn review(
        &self,
        owner: &str,
        input: CloneInput,
        env: Arc<ResolvedEnv>,
    ) -> Result<CloneReview> {
        let prepared = tokio::task::spawn_blocking(move || prepare(input, env))
            .await
            .map_err(|_| CloneError::message("Clone inspection failed."))??;
        let mut pending = lock(&self.pending);
        pending.retain(|_, (_, value)| value.expires > Instant::now());
        if pending.len() >= 8 {
            return Err(CloneError::message(
                "Close another clone review before preparing one.",
            ));
        }
        let view = prepared.view.clone();
        pending.insert(view.id.clone(), (owner.into(), prepared));
        Ok(view)
    }
    pub fn cancel_review(&self, owner: &str, id: &str) {
        let mut pending = lock(&self.pending);
        if pending.get(id).is_some_and(|(known, _)| known == owner) {
            pending.remove(id);
        }
    }
    pub(crate) fn take(&self, owner: &str, id: &str) -> Result<(Prepared, Arc<Job>)> {
        let mut pending = lock(&self.pending);
        if !pending
            .get(id)
            .is_some_and(|(known, value)| known == owner && value.expires > Instant::now())
        {
            return Err(CloneError::message(
                "This clone review expired or belongs to another window.",
            ));
        }
        let mut jobs = lock(&self.jobs);
        if jobs
            .values()
            .filter(|job| {
                matches!(
                    job.snapshot().state,
                    CloneState::Running | CloneState::CleanupPending
                )
            })
            .count()
            >= 2
        {
            return Err(CloneError::message(
                "Wait for an existing clone to stop before starting another.",
            ));
        }
        if jobs.len() >= 32 {
            jobs.retain(|_, job| {
                matches!(
                    job.snapshot().state,
                    CloneState::Running | CloneState::CleanupPending
                )
            });
        }
        let (_, prepared) = pending
            .remove(id)
            .ok_or_else(|| CloneError::message("Review the clone again."))?;
        let record = CloneRecord {
            id: id.into(),
            remote: prepared.view.remote.clone(),
            parent: prepared.view.parent.clone(),
            destination: prepared.view.destination.clone(),
            journal: prepared
                .parent
                .join(format!(".auracode-clone-{id}"))
                .to_string_lossy()
                .into_owned(),
            state: CloneState::Running,
            detail: "Preparing the owned clone.".into(),
        };
        let job = Arc::new(Job {
            owner: owner.into(),
            record: Mutex::new(record),
            canceled: watch::channel(false).0,
        });
        jobs.insert(id.into(), Arc::clone(&job));
        Ok((prepared, job))
    }
    pub fn status(&self, owner: &str, id: &str) -> Result<CloneRecord> {
        lock(&self.jobs).get(id).filter(|job| job.owner == owner).map(|job| job.snapshot()).ok_or_else(|| CloneError::message("This clone is no longer open. Choose its parent folder to inspect retained recovery records."))
    }
    pub fn cancel(&self, owner: &str, id: &str) {
        self.cancel_review(owner, id);
        if let Some(job) = lock(&self.jobs).get(id).filter(|job| job.owner == owner) {
            job.canceled.send_replace(true);
        }
    }
    pub fn drop_owner(&self, owner: &str) {
        lock(&self.pending).retain(|_, (known, _)| known != owner);
        for job in lock(&self.jobs).values().filter(|job| job.owner == owner) {
            job.canceled.send_replace(true);
        }
    }
    pub fn cancel_all(&self) {
        lock(&self.pending).clear();
        for job in lock(&self.jobs).values() {
            job.canceled.send_replace(true);
        }
    }
    pub async fn history(&self, parent: PathBuf) -> Result<Vec<CloneRecord>> {
        let mut records = tokio::task::spawn_blocking(move || files::history(&parent))
            .await
            .map_err(|_| CloneError::message("Clone recovery inspection failed."))??;
        let jobs = lock(&self.jobs);
        for record in &mut records {
            if let Some(job) = jobs.get(&record.id) {
                *record = job.snapshot();
            }
        }
        Ok(records)
    }
}

fn prepare(input: CloneInput, env: Arc<ResolvedEnv>) -> Result<Prepared> {
    let remote = validate::remote(&input.remote)?;
    validate::name(&input.name)?;
    let raw = PathBuf::from(&input.parent);
    if !raw.is_absolute() {
        return Err(CloneError::message("Choose an absolute parent folder."));
    }
    let parent = std::fs::canonicalize(raw)?;
    if parent.to_str().is_none() {
        return Err(CloneError::message(
            "Choose a parent folder whose path can be displayed without replacement characters.",
        ));
    }
    let parent_handle = Dir::open_ambient_dir(&parent, cap_std::ambient_authority())?;
    files::absent(&parent_handle, &input.name)?;
    let destination = parent.join(&input.name);
    if cfg!(windows)
        && destination
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .count()
            > 220
    {
        return Err(CloneError::message(
            "Choose a shorter parent folder or name. Windows clone paths need room for Git's files.",
        ));
    }
    let mut env = (*env).clone();
    env.vars.retain(|key, _| {
        !key.as_os_str()
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
    });
    for key in ["SSH_ASKPASS", "SSH_ASKPASS_REQUIRE"] {
        env.vars.remove(&EnvKey::from(key));
    }
    let program = find_exe("git", &env.vars).ok_or_else(|| {
        CloneError::message("Install Git and refresh the environment before cloning.")
    })?;
    let view = CloneReview { id: uuid::Uuid::now_v7().to_string(), remote, parent: parent.to_string_lossy().into_owned(), destination: destination.to_string_lossy().into_owned(), notices: vec![
        "Creates a new folder. Any existing destination, including an empty folder, is refused.".into(),
        "HTTPS supports public repositories. Private repositories require SSH access already configured in your own tools. No login or credential prompt runs here.".into(),
        "Git uses isolated configuration and no hooks, templates, submodule recursion or custom filters. SSH keeps strict host verification and cannot ask for a password.".into(),
        "The clone stops after ten minutes or when canceled. Partial files and a recovery record stay in the chosen parent; retry uses a new folder.".into(),
    ] };
    Ok(Prepared {
        view,
        parent,
        parent_handle,
        name: input.name,
        program,
        env: Arc::new(env),
        expires: Instant::now() + Duration::from_secs(600),
    })
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) use process::execute;

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn review_is_inert_one_use_owner_scoped_and_cancel_can_precede_start() {
        let temp = tempfile::tempdir().unwrap();
        let git = temp
            .path()
            .join(if cfg!(windows) { "git.exe" } else { "git" });
        std::fs::write(&git, "synthetic executable, never run").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut vars = aura_process::EnvMap::new();
        vars.insert("PATH".into(), temp.path().as_os_str().to_owned());
        let env = Arc::new(ResolvedEnv {
            vars,
            source: aura_process::EnvSource::Fallback {
                reason: "test".into(),
            },
            warnings: vec![],
            resolved_at_ms: 0,
        });
        let service = Clones::default();
        let input = CloneInput {
            remote: "https://github.com/owner/repo".into(),
            parent: temp.path().to_string_lossy().into(),
            name: "repo".into(),
        };
        let review = service
            .review("main", input.clone(), Arc::clone(&env))
            .await
            .unwrap();
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
        assert!(service.take("other", &review.id).is_err());
        service.cancel("main", &review.id);
        assert!(service.take("main", &review.id).is_err());
        let review = service.review("main", input, env).await.unwrap();
        let (prepared, job) = service.take("main", &review.id).unwrap();
        assert!(service.take("main", &review.id).is_err());
        service.drop_owner("main");
        execute(
            prepared,
            Arc::clone(&job),
            aura_process::Spawner::new(
                aura_process::LeftoverRegistry::disabled(),
                tokio::runtime::Handle::current(),
            ),
        )
        .await;
        assert_eq!(job.snapshot().state, CloneState::Canceled);
        assert_eq!(
            std::fs::read_dir(temp.path()).unwrap().count(),
            1,
            "no process or destination after canceled admission"
        );
    }
}
