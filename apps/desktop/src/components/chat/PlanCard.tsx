import { useId, useState } from "react";
import type { PermissionOption, PermissionRequest } from "../../bindings";
import type { RequestState } from "../../lib/chat/chatStore";
import { permissionResolutionLabel } from "../../lib/chat/present";
import type { PermissionItem } from "../../lib/chat/transcript";
import { errorMessage } from "../../lib/errors";
import { Answer } from "../Markdown";

/** The plan an agent asks to leave plan mode with, and the options that accept or decline it. */
export interface PlanApproval {
  readonly plan: string;
  readonly accept: PermissionOption;
  readonly decline: PermissionOption;
}

/**
 * A request to leave plan mode with a written plan (Claude Code's ExitPlanMode): a mode switch
 * whose input carries the plan, offering both an allow and a reject option. Anything else stays
 * an ordinary permission card.
 */
export function planApproval(request: PermissionRequest): PlanApproval | null {
  if (request.kind !== "switch_mode") return null;
  const input = request.raw_input;
  const plan =
    input && typeof input === "object" && !Array.isArray(input) && "plan" in input
      ? input.plan
      : null;
  if (typeof plan !== "string" || !plan.trim()) return null;
  const accept = request.options.find((option) => option.kind === "allow_once");
  const decline = request.options.find((option) => option.kind === "reject_once");
  return accept && decline ? { plan, accept, decline } : null;
}

/** What "Add to the plan" sends the agent with the declined plan. */
export function planFeedback(note: string): string {
  return `Before implementing, add this to the plan and show me the updated plan:\n\n${note.trim()}`;
}

/**
 * The plan, set as prose, with the two ways on (owner, 2 November 2026): Accept plan lets the
 * agent start implementing; Add to the plan sends a note, and the agent keeps planning with it.
 */
export function PlanCard({
  item,
  approval,
  request,
  agentName,
  onRespond,
  onAddToPlan,
  build,
}: {
  readonly item: PermissionItem;
  readonly approval: PlanApproval;
  readonly request: RequestState | undefined;
  readonly agentName: string;
  readonly onRespond: (optionId: string | null) => void;
  /** Declines the plan with a note for the agent; resolves once the note is on its way. */
  readonly onAddToPlan?: (declineOptionId: string, note: string) => Promise<void>;
  /**
   * The chat's Build with, when accepting can hand the plan to it (lib/roles.ts): its name,
   * and the hand-over, which resolves once the builder has the plan.
   */
  readonly build?: { readonly label: string; readonly onBuild: () => Promise<void> };
}) {
  const noteId = useId();
  const [handing, setHanding] = useState(false);
  const [handFailure, setHandFailure] = useState<string | null>(null);
  const hand = async () => {
    if (!build) return;
    setHanding(true);
    setHandFailure(null);
    try {
      await build.onBuild();
    } catch (failure) {
      setHandFailure(errorMessage(failure));
    } finally {
      setHanding(false);
    }
  };
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const { request: ask, resolution } = item;
  const closed = resolution !== null || request?.gone === true;
  const busy = request?.busy === true || sending || handing;
  const send = async () => {
    if (!onAddToPlan || !note.trim()) return;
    setSending(true);
    try {
      await onAddToPlan(approval.decline.option_id, note);
      setAdding(false);
      setNote("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className="chat-block chat-plan"
      data-kind="plan-approval"
      data-resolved={closed}
      data-testid="item"
      data-test-kind="permission"
      data-test-request-id={ask.request_id}
      data-test-resolved-by={resolution?.by ?? ""}
      data-test-decision={
        resolution === null
          ? ""
          : resolution.decision.type === "cancelled"
            ? "cancelled"
            : resolution.decision.option_id
      }
      data-test-gone={String(request?.gone === true)}
    >
      <div className="chat-block-head">
        <span className="chat-block-title" data-testid="permission-title">
          {closed ? "Plan" : "Plan ready for review"}
        </span>
      </div>
      <div className="chat-plan-body" data-testid="plan-body">
        <Answer text={approval.plan} />
      </div>
      {resolution !== null ? (
        <p className="chat-resolution" data-testid="permission-resolution">
          {resolution.decision.type === "selected" &&
          resolution.decision.option_id === approval.accept.option_id
            ? "Plan accepted."
            : resolution.decision.type === "selected" &&
                resolution.decision.option_id === approval.decline.option_id
              ? "Sent back to keep planning."
              : permissionResolutionLabel(resolution, ask.options)}
        </p>
      ) : request?.gone ? (
        <p className="chat-resolution" data-testid="permission-resolution">
          This plan is no longer waiting for an answer.
        </p>
      ) : adding ? (
        <form
          className="chat-plan-note"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={noteId}>What should the plan add or change?</label>
          <textarea
            id={noteId}
            className="g-textarea"
            rows={3}
            value={note}
            disabled={busy}
            // biome-ignore lint/a11y/noAutofocus: the person just asked to write this note.
            autoFocus
            onChange={(event) => setNote(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setAdding(false);
              }
            }}
          />
          <div className="ui-row">
            <button
              type="submit"
              className="g-button g-button-primary"
              data-testid="plan-send-note"
              disabled={busy || !note.trim()}
            >
              {sending ? "Sending…" : "Send to plan"}
            </button>
            <button
              type="button"
              className="g-button g-button-ghost"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="chat-plan-actions">
          <div className="ui-row">
            {build ? (
              <button
                type="button"
                className="g-button g-button-primary"
                data-testid="plan-build"
                disabled={busy}
                onClick={() => void hand()}
              >
                {handing ? "Handing over…" : `Accept and build with ${build.label}`}
              </button>
            ) : null}
            <button
              type="button"
              className={build ? "g-button" : "g-button g-button-primary"}
              data-testid="permission-option"
              data-test-option-id={approval.accept.option_id}
              data-test-option-kind={approval.accept.kind}
              disabled={busy}
              onClick={() => onRespond(approval.accept.option_id)}
            >
              Accept plan
            </button>
            {onAddToPlan ? (
              <button
                type="button"
                className="g-button"
                data-testid="plan-add"
                disabled={busy}
                onClick={() => setAdding(true)}
              >
                Add to the plan…
              </button>
            ) : (
              <button
                type="button"
                className="g-button"
                data-testid="permission-option"
                data-test-option-id={approval.decline.option_id}
                data-test-option-kind={approval.decline.kind}
                disabled={busy}
                onClick={() => onRespond(approval.decline.option_id)}
              >
                Keep planning
              </button>
            )}
          </div>
          <p className="chat-plan-hint">
            {build
              ? `Accept and build hands the plan to ${build.label}, this chat's Build with. Accept plan lets ${agentName} implement it.`
              : `Accepting lets ${agentName} start implementing.`}
            {onAddToPlan ? " Adding sends your note, and it keeps planning with it." : ""}
          </p>
        </div>
      )}
      {request?.error ? (
        <span role="alert" className="ui-error" data-testid="permission-error">
          {request.error}
        </span>
      ) : null}
      {handFailure ? (
        <span role="alert" className="ui-error" data-testid="plan-build-error">
          {handFailure}
        </span>
      ) : null}
    </div>
  );
}
