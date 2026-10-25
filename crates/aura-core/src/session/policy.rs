//! The permission policy: one function over the dialect's autonomy state decides whether a request
//! is answered on the user's behalf or shown as a card. Never `allow_always`, never `switch_mode`,
//! kind `other` or a request without a kind; questions are never auto-answered.
//!
//! 1. A request without a kind, or of kind `switch_mode` or `other`, is asked: leaving plan mode is
//!    the user's call, and agents ask questions with kind `other` (Hermes' clarify and guarded-model
//!    prompts among them).
//! 2. `AutoAnswer::Never` asks; `All` covers the eight tool kinds; `Kinds` covers the listed ones.
//! 3. The first option of kind `allow_once` is chosen; without one the request is asked
//!    (`allow_always` writes persistent rules into the user's agent settings, and an unknown kind is
//!    never chosen).

use aura_protocol::{AutoAnswer, AutonomyState, PermissionOptionKind, PermissionRequest, ToolKind};

/// What the session does with a permission request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Decision {
    /// Answer it now with this option, recorded as resolved `by: Auto`.
    AutoAllow { option_id: String },
    /// Show the card.
    Ask,
}

/// The tool kinds `AutoAnswer::All` covers.
const TOOL_KINDS: [ToolKind; 8] = [
    ToolKind::Read,
    ToolKind::Edit,
    ToolKind::Delete,
    ToolKind::Move,
    ToolKind::Search,
    ToolKind::Execute,
    ToolKind::Think,
    ToolKind::Fetch,
];

pub(crate) fn decide(state: &AutonomyState, req: &PermissionRequest) -> Decision {
    let Some(kind) = req.kind else {
        return Decision::Ask;
    };
    if matches!(kind, ToolKind::SwitchMode | ToolKind::Other) {
        return Decision::Ask;
    }
    let covered = match &state.auto_answer {
        AutoAnswer::Never => false,
        AutoAnswer::All => TOOL_KINDS.contains(&kind),
        AutoAnswer::Kinds { kinds } => kinds.contains(&kind),
    };
    if !covered {
        return Decision::Ask;
    }
    match req
        .options
        .iter()
        .find(|option| option.kind == PermissionOptionKind::AllowOnce)
    {
        Some(option) => Decision::AutoAllow {
            option_id: option.option_id.clone(),
        },
        None => Decision::Ask,
    }
}

#[cfg(test)]
mod tests {
    use aura_protocol::{Autonomy, PermissionOption};

    use super::*;

    fn state(auto_answer: AutoAnswer) -> AutonomyState {
        AutonomyState {
            requested: Autonomy::FullAuto,
            native_mode: None,
            auto_answer,
            note: None,
        }
    }

    fn option(id: &str, kind: PermissionOptionKind) -> PermissionOption {
        PermissionOption {
            option_id: id.into(),
            kind,
            label: id.into(),
        }
    }

    fn request(kind: Option<ToolKind>, options: Vec<PermissionOption>) -> PermissionRequest {
        PermissionRequest {
            request_id: "p1".into(),
            tool_call_id: None,
            title: "Do it?".into(),
            kind,
            raw_input: None,
            content: Vec::new(),
            locations: Vec::new(),
            options,
            truncated: None,
        }
    }

    fn standard_options() -> Vec<PermissionOption> {
        vec![
            option("always", PermissionOptionKind::AllowAlways),
            option("once", PermissionOptionKind::AllowOnce),
            option("no", PermissionOptionKind::RejectOnce),
        ]
    }

    fn allow(id: &str) -> Decision {
        Decision::AutoAllow {
            option_id: id.into(),
        }
    }

    #[test]
    fn policy_all_covers_the_eight_tool_kinds() {
        for kind in TOOL_KINDS {
            assert_eq!(
                decide(
                    &state(AutoAnswer::All),
                    &request(Some(kind), standard_options())
                ),
                allow("once"),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn policy_never_answers_without_a_kind_or_for_switch_mode() {
        for auto_answer in [
            AutoAnswer::All,
            AutoAnswer::Kinds {
                kinds: vec![ToolKind::SwitchMode, ToolKind::Other],
            },
        ] {
            let state = state(auto_answer);
            assert_eq!(
                decide(&state, &request(None, standard_options())),
                Decision::Ask
            );
            assert_eq!(
                decide(
                    &state,
                    &request(Some(ToolKind::SwitchMode), standard_options())
                ),
                Decision::Ask
            );
        }
    }

    /// A37: generic Full auto meets a question (kind `other` with `allow_once` choices): asked.
    #[test]
    fn policy_never_answers_kind_other() {
        let choices = vec![
            option("red", PermissionOptionKind::AllowOnce),
            option("green", PermissionOptionKind::AllowOnce),
        ];
        assert_eq!(
            decide(
                &state(AutoAnswer::All),
                &request(Some(ToolKind::Other), choices)
            ),
            Decision::Ask
        );
    }

    #[test]
    fn policy_asks_when_auto_answer_is_never() {
        assert_eq!(
            decide(
                &state(AutoAnswer::Never),
                &request(Some(ToolKind::Read), standard_options())
            ),
            Decision::Ask
        );
    }

    #[test]
    fn policy_kinds_answers_only_the_listed_kinds() {
        let hermes = state(AutoAnswer::Kinds {
            kinds: vec![ToolKind::Execute],
        });
        assert_eq!(
            decide(
                &hermes,
                &request(Some(ToolKind::Execute), standard_options())
            ),
            allow("once")
        );
        assert_eq!(
            decide(&hermes, &request(Some(ToolKind::Edit), standard_options())),
            Decision::Ask
        );
    }

    /// Never `allow_always`; and A7: an option of a kind auracode does not know is shown, never
    /// auto-selected.
    #[test]
    fn policy_only_ever_picks_the_first_allow_once() {
        let all = state(AutoAnswer::All);
        let only_always = vec![
            option("always", PermissionOptionKind::AllowAlways),
            option("no", PermissionOptionKind::RejectOnce),
        ];
        assert_eq!(
            decide(&all, &request(Some(ToolKind::Edit), only_always)),
            Decision::Ask
        );
        let unknown = vec![
            option("mystery", PermissionOptionKind::Other),
            option("no", PermissionOptionKind::RejectAlways),
        ];
        assert_eq!(
            decide(&all, &request(Some(ToolKind::Edit), unknown)),
            Decision::Ask
        );
        let two = vec![
            option("first", PermissionOptionKind::AllowOnce),
            option("second", PermissionOptionKind::AllowOnce),
        ];
        assert_eq!(
            decide(&all, &request(Some(ToolKind::Edit), two)),
            allow("first")
        );
        assert_eq!(
            decide(&all, &request(Some(ToolKind::Edit), Vec::new())),
            Decision::Ask
        );
    }

    /// An unknown option kind read from the wire lands on `Other`, which the policy never picks.
    #[test]
    fn unknown_option_kind() {
        let parsed: PermissionOption = serde_json::from_value(serde_json::json!({
            "option_id": "x",
            "kind": "allow_forever_and_ever",
            "label": "Allow forever"
        }))
        .expect("parse");
        assert_eq!(parsed.kind, PermissionOptionKind::Other);
        assert_eq!(
            decide(
                &state(AutoAnswer::All),
                &request(Some(ToolKind::Execute), vec![parsed])
            ),
            Decision::Ask
        );
    }
}
