# Models by role

Owner, 19 November 2026: "sometimes people wanna use different models for different things like fable for planning, gpt 6 astra for implementation or mixing and matching. Create the best way for that."

Settings > General > Models by role names an agent, and optionally its model and thinking level, for each kind of work. A role left on its first entry changes nothing, so a profile that never opens the section behaves as before.

| Role | When it applies | What happens |
|---|---|---|
| Planning | Plan is turned on in a chat of that agent | The chat's model and thinking level change to the role's. The picker shows the change as any other. A chat of another agent is left alone: choose the planner as the chat's agent when you start it. |
| Building | A plan is waiting for review | The plan card offers "Accept and build with <role>" before Accept plan. Accept plan still lets the chat's own agent implement it. |
| Coordinator | A coordinated project's coordinator is started without naming an agent | The coordinator starts on the role's agent, model and thinking level. |
| Workers | A coordinated project's coordinator starts a worker without naming an agent | The worker runs on the role's agent, model and thinking level. The coordinator can still name another agent or model for a task, which is how it mixes them. |

## Accept and build with

- **The chat's own agent** (plan with one model, build with another of the same agent): the model and thinking level are set, then the plan is accepted. Nothing else changes. The offer shows only when the role would change something.
- **Another agent** (plan with Claude Code, build with Codex): the planner is stopped, which closes its request; the chat is handed to the builder with the same handoff the agent picker's switch uses; the builder's model and thinking level are set; and it is sent the plan as written, with a line saying who wrote it and that the person accepted it. The chat keeps its history, and each turn keeps the agent that ran it.

The offer needs the role's agent to be ready on this computer. If it stops being ready between the card showing and the press, the card says so and Accept plan remains.

## Where it is saved and read

- `general.roles` in the profile's setup preferences (`crates/o7-core/src/onboarding.rs`: `RoleModels`, `RoleModel`, `ModelRole`, action `role_model`). An agent is saved as the agent, not a connection of it, as the default agent is. Each value is checked as an identifier.
- The window applies Planning and Building (`apps/desktop/src/lib/roles.ts`, `ChatView.tsx`). They use only what the pickers and the agent switch already do: `chat_set_option`, `respond_permission`, `chat_stop`, `continuation_preview` and `continuation_apply`, `composer_send`.
- Rust reads Coordinator and Workers (`crates/o7-core/src/session/coordinator.rs`, `role_for`).

## Limits

- A model an agent has not listed yet (it has never run here) cannot be chosen in Settings and is not set; the agent's own default is used.
- Thinking levels are listed per model once the agent has run that model.
- A role changes what a chat runs on. It does not change access: a builder runs with the chat's access level.

## Verification

- `cargo test -p o7-core onboarding` (the preference: saved, normalized, refused when not an identifier, absent in older profiles).
- `pnpm --filter @o7/desktop exec vitest run src/lib/roles.test.ts src/components/chat/PlanCard.test.tsx`.
- `node apps/desktop/scripts/check-settings.mjs` (the rows, in both engines and appearances, with the page's search).
