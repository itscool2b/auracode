//! Settings' General page reaches Rust here: the defaults for new chats go to the session manager,
//! and the notification, keep-awake and close-to-tray switches to the native shell. The values
//! live in the profile's setup preferences (`aura_core::onboarding`).

use aura_core::onboarding::GeneralPreferences;
use aura_core::session::NewChatDefaults;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

/// Applies saved General preferences to the running app.
pub fn apply(app: &AppHandle, general: &GeneralPreferences) {
    if let Some(chats) = app.try_state::<AppState>().and_then(|state| state.chats()) {
        apply_to_manager(&chats.manager, general);
    }
    crate::native_shell::apply_preferences(app, general);
}

pub(crate) fn apply_to_manager(
    manager: &aura_core::session::SessionManager,
    general: &GeneralPreferences,
) {
    manager.set_new_chat_defaults(defaults(general));
    manager.set_automatic_checkpoints(general.automatic_checkpoints);
}

/// Initialize before publishing a runtime, so its first actor sees the saved profile policy.
pub(crate) fn initialize(
    manager: &aura_core::session::SessionManager,
    service: &crate::onboarding::SetupService,
) {
    let general = match service.preferences() {
        Ok(preferences) => preferences.general,
        Err(error) => {
            tracing::warn!(%error, "settings could not be read; using the defaults");
            GeneralPreferences::default()
        }
    };
    apply_to_manager(manager, &general);
}

/// Applies the active profile's saved preferences, or the defaults when there is no readable
/// profile (a locked account profile, a failed startup). Smoke launches keep the defaults.
pub fn refresh(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if state.launch.is_smoke() {
        return;
    }
    if let Some(service) = state.setup_service() {
        match service.apply_current_preferences(|preferences| apply(app, &preferences.general)) {
            Ok(()) => return,
            Err(error) => {
                tracing::warn!(%error, "settings could not be read; using the defaults");
            }
        }
    }
    apply(app, &GeneralPreferences::default());
}

fn defaults(general: &GeneralPreferences) -> NewChatDefaults {
    NewChatDefaults {
        autonomy: general.default_autonomy,
        agent: general.default_agent.clone(),
        model: general.default_model.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_protocol::Autonomy;

    #[test]
    fn full_auto_stays_the_default_and_a_model_keeps_its_agent() {
        assert_eq!(
            defaults(&GeneralPreferences::default()),
            NewChatDefaults::default()
        );
        assert_eq!(NewChatDefaults::default().autonomy, Autonomy::FullAuto);
        let chosen = defaults(&GeneralPreferences {
            default_agent: Some("codex".into()),
            default_model: Some("gpt-5.5-codex".into()),
            default_autonomy: Autonomy::AutoEdit,
            ..GeneralPreferences::default()
        });
        assert_eq!(chosen.autonomy, Autonomy::AutoEdit);
        assert_eq!(chosen.agent.as_deref(), Some("codex"));
        assert_eq!(chosen.model.as_deref(), Some("gpt-5.5-codex"));
    }
}
