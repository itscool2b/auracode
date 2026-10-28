use super::*;
use aura_protocol::agents::{AgentInstallationCandidate, AgentInstallations};
use futures::{StreamExt, stream};
use std::path::Path;

impl Detector {
    /// Explicit inspection probes bounded candidates without changing the chosen executable.
    pub async fn installations(&self, id: &str) -> Result<AgentInstallations, String> {
        let Mode::Live(live) = &self.mode else {
            return Err("This catalog has no selectable executables.".into());
        };
        let spec = self
            .connection_for(id)
            .ok_or("The agent is not in the catalog.")?;
        let _selection = live.selection_gate.lock().await;
        inventory(live, &spec).await
    }

    /// An explicit choice applies to new sessions only. Aliases of one provider share it.
    /// Null restores the environment override/PATH default. A disappeared choice never falls back.
    pub async fn select_installation(
        &self,
        id: &str,
        selected: Option<String>,
    ) -> Result<AgentInstallations, String> {
        let Mode::Live(live) = &self.mode else {
            return Err("This catalog has no selectable executables.".into());
        };
        let spec = self
            .connection_for(id)
            .ok_or("The agent is not in the catalog.")?;
        if matches!(spec.recipe, Recipe::Builtin) {
            return Err("The built-in agent has no executable choice.".into());
        }
        let path = live
            .preferences
            .clone()
            .ok_or("This detector does not persist executable choices.")?;
        let _selection = live.selection_gate.lock().await;
        let env = live.env.get().await;
        let selected = selected.map(PathBuf::from);
        if let Some(selected) = &selected {
            let (choices, _) = crate::candidates::paths(&spec, &env.vars, cfg!(windows));
            let known = choices
                .iter()
                .any(|choice| same_path(&choice.path, selected))
                || lock(&live.state)
                    .selections
                    .get(crate::installation::provider_namespace(id))
                    .is_some_and(|saved| same_path(saved, selected));
            if !known {
                return Err(
                    "This executable is not in the discovered list. Refresh installations first."
                        .into(),
                );
            }
            let detected = probe::detect_at(
                &spec,
                &env,
                &live.registry,
                &live.adapters_dir,
                Some(selected),
            )
            .await;
            if !matches!(detected.availability, Availability::Ready { .. }) {
                return Err(match detected.availability {
                    Availability::Missing { reason } | Availability::Broken { reason } => reason,
                    _ => "The executable is not ready.".into(),
                });
            }
        }
        let provider = crate::installation::provider_namespace(id).to_owned();
        if lock(&live.state).maintenance.contains(&provider) {
            return Err("This agent is being updated. Wait before changing its executable.".into());
        }
        let selections = tokio::task::spawn_blocking(move || {
            crate::preferences::save(&path, &provider, selected.as_deref())
        })
        .await
        .map_err(|_| "The executable preference could not be saved.")??;
        replace_selections(live, Ok(selections));
        // Invalidated results are never returned as readiness for a new start.
        live.detect_every(true).await;
        inventory(live, &spec).await
    }

    /// Metadata-only polling hook, also usable by tests. Starts probes only when something changed.
    pub async fn refresh_changed_installations(&self) {
        if let Mode::Live(live) = &self.mode {
            refresh_metadata(live).await;
        }
    }
}

async fn inventory(live: &Arc<Live>, spec: &AgentSpec) -> Result<AgentInstallations, String> {
    let env = live.env.get().await;
    let (preferred, notice) = {
        let state = lock(&live.state);
        (
            state
                .selections
                .get(crate::installation::provider_namespace(spec.id))
                .cloned(),
            state.preference_error.clone(),
        )
    };
    let (mut paths, truncated) = crate::candidates::paths(spec, &env.vars, cfg!(windows));
    let default = match &spec.recipe {
        Recipe::NativeBinary { user_binary, .. } | Recipe::NpmAdapter { user_binary, .. } => {
            match probe::locate_user_binary(user_binary, &env.vars, cfg!(windows)) {
                probe::UserBinaryLookup::Found(path) | probe::UserBinaryLookup::ShimOnly(path) => {
                    Some(path)
                }
                _ => None,
            }
        }
        Recipe::Binary { program, .. } | Recipe::QualifiedBinary { program, .. } => {
            find_program(program, &env.vars)
        }
        Recipe::Builtin => None,
    };
    let selected = preferred.as_ref().or(default.as_ref());
    if let Some(preferred) = &preferred
        && !paths
            .iter()
            .any(|candidate| same_path(&candidate.path, preferred))
    {
        paths.push(crate::candidates::Candidate {
            path: preferred.clone(),
            source: "Saved choice",
        });
    }
    let candidates = stream::iter(paths.into_iter().map(|candidate| {
        let env = Arc::clone(&env);
        async move {
            let detected = probe::detect_at(
                spec,
                &env,
                &live.registry,
                &live.adapters_dir,
                Some(&candidate.path),
            )
            .await;
            AgentInstallationCandidate {
                selected: selected.is_some_and(|selected| same_path(selected, &candidate.path)),
                path: candidate.path.display().to_string(),
                source: candidate.source.into(),
                availability: detected.availability,
                installation: detected.installation,
            }
        }
    }))
    .buffered(4)
    .collect()
    .await;
    Ok(AgentInstallations {
        agent_id: spec.id.into(),
        preferred_path: preferred.map(|p| p.display().to_string()),
        candidates,
        truncated,
        notice,
    })
}

fn same_path(a: &Path, b: &Path) -> bool {
    crate::candidates::key(a, cfg!(windows)) == crate::candidates::key(b, cfg!(windows))
}

fn replace_selections(
    live: &Live,
    choices: Result<crate::preferences::Selections, String>,
) -> bool {
    let (choices, error) = match choices {
        Ok(choices) => (choices, None),
        Err(error) => (Default::default(), Some(error)),
    };
    let mut state = lock(&live.state);
    if state.selections == choices && state.preference_error == error {
        return false;
    }
    state.selections = choices;
    state.preference_error = error;
    state.configuration_revision += 1;
    state.generation += 1;
    let floor = state.generation;
    for spec in &live.specs {
        state.minimum_generation.insert(
            crate::installation::provider_namespace(spec.id).into(),
            floor,
        );
    }
    state.results.clear();
    state.probes.clear();
    state.releases.clear();
    true
}

pub(super) async fn refresh_preferences(live: &Arc<Live>) -> bool {
    let _selection = live.selection_gate.lock().await;
    if let Some(path) = live.preferences.clone() {
        let result = tokio::task::spawn_blocking(move || crate::preferences::read(&path))
            .await
            .unwrap_or_else(|_| Err("Executable preferences could not be read.".into()));
        return replace_selections(live, result);
    }
    false
}

async fn refresh_metadata(live: &Arc<Live>) {
    let preference_changed = refresh_preferences(live).await;
    let env = live.env.get().await;
    let selected = lock(&live.state).selections.clone();
    let specs = live.specs.clone();
    let observed = tokio::task::spawn_blocking(move || {
        crate::candidates::fingerprint(&specs, &env.vars, &selected)
    })
    .await
    .ok();
    let changed = {
        let mut state = lock(&live.state);
        let changed =
            state.metadata_fingerprint.is_some() && observed != state.metadata_fingerprint;
        state.metadata_fingerprint = observed;
        changed
    };
    if changed || preference_changed {
        live.detect_every(true).await;
    }
}

pub(super) fn observe(live: &Arc<Live>) {
    let weak = Arc::downgrade(live);
    live.rt.spawn(async move {
        loop {
            {
                let Some(live) = weak.upgrade() else {
                    break;
                };
                refresh_metadata(&live).await;
            }
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}
