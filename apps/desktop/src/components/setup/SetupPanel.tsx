import { usePrefersReducedMotion } from "@auracode/ui";
import { AgentMark, DitherField, StatusDot } from "@auracode/ui/graphite";
import type { AgentEntry } from "../../bindings";

/** Transport aliases stay visible on Agents; setup shows one row per harness. */
export function primaryAgents(agents: readonly AgentEntry[]): readonly AgentEntry[] {
  return agents.filter(
    (agent) =>
      !agent.id.endsWith("-acp") &&
      !agent.id.endsWith("-stream") &&
      agent.id !== "mock" &&
      agent.id !== "opencode-v2",
  );
}

/**
 * The pane beside setup: a calm dither field and, on an opaque card so the type stays crisp, what
 * this computer has: one row per agent with its version, or that it was not found. Rows resolve in
 * place as detection finishes.
 */
export function SetupPanel({ agents }: { readonly agents: readonly AgentEntry[] }) {
  const reduced = usePrefersReducedMotion();
  const roster = primaryAgents(agents);
  return (
    <aside className="setup-panel" aria-label="Agents on this computer">
      <DitherField
        className="setup-panel-field"
        palette="quiet"
        density={0.52}
        accent={0.006}
        interactive
        still={reduced}
      />
      <div className="setup-panel-card">
        <p className="setup-panel-lead">
          Agents run on this machine.
          <span>auracode never sees their keys.</span>
        </p>
        {roster.length > 0 ? (
          <ul className="setup-panel-roster">
            {roster.map((agent) => {
              const state = agent.availability.state;
              return (
                <li key={agent.id} className="setup-panel-agent" data-state={state}>
                  {/* The row's words say everything the mark shows. */}
                  <span className="setup-panel-mark" aria-hidden="true">
                    <AgentMark
                      agent={agent.id}
                      size={24}
                      state={state === "checking" ? "thinking" : "idle"}
                      ghost={state === "missing" || state === "broken"}
                    />
                  </span>
                  <span className="setup-panel-name">{agent.name}</span>
                  <span className="setup-panel-meta">
                    {agent.availability.state === "ready"
                      ? (agent.availability.version ?? "Built in")
                      : state === "checking"
                        ? "Looking"
                        : state === "broken"
                          ? "Unavailable"
                          : "Not found"}
                  </span>
                  <span className="setup-panel-status">
                    {state === "ready" ? <StatusDot tone="green" /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="setup-panel-empty" role="status">
            Looking for agents on this computer.
          </p>
        )}
      </div>
    </aside>
  );
}
