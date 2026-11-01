import { Check, ChevronDown, ListChecks, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { Autonomy, SessionControlChange, SessionLists, SessionStatus } from "../../bindings";
import { AUTONOMIES } from "../../lib/chat/present";
import { movePickerFocus } from "./PickerChoices";
import { closePopover, Popover } from "./Popover";

const ACCESS_LABEL: Record<Autonomy, string> = {
  ask: "Ask for approval",
  auto_edit: "Allow edits",
  full_auto: "Full access",
};
const ACCESS_DESCRIPTION: Record<Autonomy, string> = {
  ask: "Review actions the agent asks permission to perform.",
  auto_edit: "Allow file edits. Other actions follow the agent's approval policy.",
  full_auto: "Allow the agent to work without approval prompts where supported.",
};

export function AccessPicker({
  lists,
  autonomy,
  saving,
  controlSaving = null,
  transitionBlocked = false,
  status,
  error,
  onSetAutonomy,
  onSetControl,
}: {
  readonly lists: SessionLists | null;
  readonly autonomy: Autonomy;
  readonly saving: Autonomy | null;
  readonly controlSaving?: SessionControlChange | null;
  readonly transitionBlocked?: boolean;
  readonly status: SessionStatus;
  readonly error: string | null;
  readonly onSetAutonomy: (value: Autonomy) => void;
  readonly onSetControl?: (change: SessionControlChange) => void;
}) {
  const native = onSetControl ? lists?.controls : null;
  const access = native?.access;
  const workflow = native?.workflow;
  const supported = lists?.capabilities?.autonomy_levels ?? [];
  const fallback = AUTONOMIES.filter((value) => supported.includes(value));
  const hasNativeAccess = Boolean(access?.choices?.length);
  const choices =
    hasNativeAccess && access?.choices
      ? access.choices
      : fallback.map((value) => ({
          value,
          name: ACCESS_LABEL[value],
          description: ACCESS_DESCRIPTION[value],
          legacy_autonomy: value,
        }));
  const current = hasNativeAccess ? access?.effective : (lists?.autonomy.requested ?? autonomy);
  const pending =
    controlSaving?.type === "access" ? controlSaving.value : (access?.pending ?? saving);
  const workflowPending = controlSaving?.type === "workflow" || workflow?.pending != null;
  const displayed = pending ?? current;
  const label =
    lists && choices.length === 0
      ? "Access unavailable"
      : (choices.find((choice) => choice.value === displayed)?.name ??
        (hasNativeAccess
          ? "Access unavailable"
          : ACCESS_LABEL[(displayed as Autonomy) ?? autonomy]));
  const planning = workflow?.effective === "plan";
  const displayedWorkflow =
    controlSaving?.type === "workflow"
      ? controlSaving.value
      : (workflow?.pending ?? workflow?.effective);
  const workflowLabel =
    workflow?.choices?.find((choice) => choice.value === displayedWorkflow)?.name ??
    (lists ? "Mode unavailable" : "Mode");
  return (
    <div
      className="chat-access-controls"
      data-testid="picker-autonomy"
      data-test-requested={lists?.autonomy.requested ?? autonomy}
      data-test-native-mode={access?.native_mode ?? lists?.autonomy.native_mode ?? ""}
      data-test-saving={pending !== null}
      data-test-effective={current ?? ""}
    >
      <Popover
        label="Access level"
        triggerLabel={`${label}. Access level`}
        className="chat-access-popover"
        trigger={
          <>
            {current === "full_auto" || current === "legacy:full_auto" ? (
              <ShieldCheck size={14} />
            ) : (
              <ShieldQuestion size={14} />
            )}
            <span>{label}</span>
            {pending ? <span className="chat-control-pending">Saving…</span> : null}
            <ChevronDown size={12} />
          </>
        }
      >
        <header className="chat-control-heading">
          <strong>Access level</strong>
          <p>Controls the permissions used by this agent.</p>
        </header>
        <fieldset className="picker-choices" aria-label="Access level" onKeyDown={movePickerFocus}>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={current === choice.value}
              disabled={
                status !== "ready" ||
                transitionBlocked ||
                pending !== null ||
                controlSaving !== null ||
                (hasNativeAccess && planning)
              }
              data-testid="picker-access-choice"
              data-picker-value={choice.value}
              data-legacy-autonomy={choice.legacy_autonomy ?? undefined}
              onClick={(event) => {
                if (hasNativeAccess && onSetControl)
                  onSetControl({ type: "access", value: choice.value });
                else if (choice.legacy_autonomy) onSetAutonomy(choice.legacy_autonomy);
                closePopover(event.currentTarget, true);
              }}
            >
              <span className="picker-choice-copy">
                <strong>{choice.name}</strong>
                <small>{choice.description}</small>
              </span>
              {current === choice.value ? <Check size={14} aria-label="Selected" /> : null}
            </button>
          ))}
        </fieldset>
        {!choices.length ? (
          <p className="chat-picker-empty">
            {lists
              ? "This connection does not offer access controls."
              : "Access controls load when the session starts."}
          </p>
        ) : null}
        <div className="chat-picker-note">
          {hasNativeAccess && planning ? <p>Approve execution before changing access.</p> : null}
          {status === "running" || transitionBlocked ? (
            <p>Change access when the agent is idle with no queued messages or pending requests.</p>
          ) : null}
          {access?.note || lists?.autonomy.note ? (
            <p>{access?.note ?? lists?.autonomy.note}</p>
          ) : null}
          {(access?.native_mode ?? lists?.autonomy.native_mode) ? (
            <p>Native setting: {access?.native_mode ?? lists?.autonomy.native_mode}</p>
          ) : null}
          {current?.includes("full_auto") ? (
            <p>Automatic checkpoints are optional in Settings &gt; General.</p>
          ) : null}
          {error ? (
            <p className="ui-error" role="alert" data-testid="picker-error">
              {error}
            </p>
          ) : null}
        </div>
      </Popover>
      <Popover
        label="Working mode"
        className="chat-workflow-popover"
        triggerLabel={`${workflowLabel}. Working mode`}
        trigger={
          <>
            <ListChecks size={14} />
            <span>{workflowLabel}</span>
            {workflowPending ? <span className="chat-control-pending">Saving…</span> : null}
            <ChevronDown size={12} />
          </>
        }
      >
        <header className="chat-control-heading">
          <strong>Working mode</strong>
          <p>Use the agent's native planning workflow.</p>
        </header>
        <fieldset className="picker-choices" aria-label="Working mode" onKeyDown={movePickerFocus}>
          {workflow?.choices?.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={workflow?.effective === choice.value}
              disabled={
                status !== "ready" || workflowPending || controlSaving !== null || transitionBlocked
              }
              onClick={(event) => {
                onSetControl?.({
                  type: "workflow",
                  value: choice.value,
                  implementation_approved: planning && choice.value === "execute",
                });
                closePopover(event.currentTarget, true);
              }}
            >
              <span className="picker-choice-copy">
                <strong>
                  {planning && choice.value === "execute" ? "Approve and execute" : choice.name}
                </strong>
                <small>{choice.description}</small>
              </span>
              {workflow?.effective === choice.value ? (
                <Check size={14} aria-label="Selected" />
              ) : null}
            </button>
          ))}
        </fieldset>
        {!workflow?.choices?.length ? (
          <p className="chat-picker-empty">
            {lists
              ? "Native Plan mode is not available on this connection."
              : "Modes load when the session starts."}
          </p>
        ) : null}
        {workflow?.note ? <p className="chat-picker-note">{workflow?.note}</p> : null}
        {status === "running" ? (
          <p className="chat-picker-note">Change mode after the current turn finishes.</p>
        ) : null}
        {transitionBlocked ? (
          <p className="chat-picker-note">
            Resolve pending requests and queued messages before changing mode.
          </p>
        ) : null}
      </Popover>
    </div>
  );
}
