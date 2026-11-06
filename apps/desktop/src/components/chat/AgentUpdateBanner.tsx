import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AgentMaintenance } from "../../bindings";
import type { AgentUpdate } from "../../lib/agentUpdates";
import { errorMessage } from "../../lib/errors";

/** What the notice needs from the shell: the vendor's update command and a fresh detection. */
export interface AgentUpdateActions {
  maintenance(agentId: string): Promise<AgentMaintenance>;
  update(agentId: string): Promise<void>;
  /** Detects every agent again, so a finished update shows its new version. */
  refresh(): Promise<void>;
  /** Settings > Agents, where every agent's update and installation details are. */
  openAgents?: () => void;
}

type Run =
  | { readonly state: "idle" }
  | { readonly state: "updating" }
  | { readonly state: "failed"; readonly message: string }
  /** The vendor's update finished, yet detection still finds the version it had. */
  | { readonly state: "unchanged" };

/**
 * One agent's newer release, as a window notice: it stays until its X, and while the agent's chats
 * have a turn under way it waits for them instead of offering Update. An agent whose installation
 * auracode cannot update (another tool owns it) says why and points to Settings > Agents.
 */
export function AgentUpdateBanner({
  update,
  working,
  actions,
  onDismiss,
}: {
  readonly update: AgentUpdate;
  /** The agent's chats with a turn under way now. */
  readonly working: number;
  readonly actions: AgentUpdateActions;
  readonly onDismiss: () => void;
}) {
  const text = useId();
  const [maintenance, setMaintenance] = useState<AgentMaintenance | "failed" | null>(null);
  const [run, setRun] = useState<Run>({ state: "idle" });

  // What this installation can do, asked again for each release and installation. A new version
  // means the last run's outcome no longer applies.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Another version or path asks again.
  useEffect(() => {
    let live = true;
    setMaintenance(null);
    setRun({ state: "idle" });
    actions.maintenance(update.agentId).then(
      (answer) => {
        if (live) setMaintenance(answer);
      },
      () => {
        if (live) setMaintenance("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [actions, update.agentId, update.version, update.path]);

  const start = async () => {
    setRun({ state: "updating" });
    try {
      await actions.update(update.agentId);
    } catch (reason) {
      setRun({ state: "failed", message: errorMessage(reason) });
      return;
    }
    // A successful update makes the notice go once detection sees the new version. Until the
    // refresh answers it reads as still updating; if the old version is still what auracode
    // finds, the update went to another copy than the one it runs.
    await actions.refresh().catch(() => {});
    setRun({ state: "unchanged" });
  };

  const updatable =
    maintenance !== null && maintenance !== "failed" && !maintenance.update_unavailable;
  const blocked =
    maintenance === "failed"
      ? "auracode couldn't check how to update it."
      : (maintenance?.update_unavailable ?? null);
  const waiting =
    working > 0
      ? `Update once its ${working === 1 ? "working chat finishes" : `${working} working chats finish`}.`
      : null;
  const detail =
    run.state === "unchanged"
      ? `The update finished, but auracode still finds ${update.version}${
          update.path ? ` at ${update.path}` : ""
        }. Another copy may come first on your PATH.`
      : (blocked ?? waiting);

  return (
    <li className="chat-banner" data-testid="agent-update-banner" data-agent={update.agentId}>
      <span id={text} role="status">
        {update.name} {update.latest} is available. You have {update.version}.
        {detail ? ` ${detail}` : null}
        {run.state === "failed" ? (
          <span role="alert" className="ui-error">
            {" "}
            The update failed: {run.message}
          </span>
        ) : null}
      </span>
      {updatable && working === 0 && run.state !== "unchanged" ? (
        <button
          type="button"
          className="g-button g-button-28"
          aria-describedby={text}
          disabled={run.state === "updating"}
          onClick={() => void start()}
        >
          {run.state === "updating" ? "Updating…" : run.state === "failed" ? "Try again" : "Update"}
        </button>
      ) : null}
      {(blocked !== null || run.state === "unchanged") && actions.openAgents ? (
        <button
          type="button"
          className="g-button g-button-28"
          aria-describedby={text}
          onClick={actions.openAgents}
        >
          Agents settings
        </button>
      ) : null}
      <button
        type="button"
        className="g-button g-button-ghost g-button-28 g-button-icon"
        aria-label={`Dismiss the ${update.name} update notice`}
        title="Dismiss until auracode starts again"
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
