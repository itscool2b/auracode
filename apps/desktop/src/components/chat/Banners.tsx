import { DatabaseBackup, HardDrive, Info, NotebookPen, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { EnvStatus, StorageStatus } from "../../bindings";
import { type DismissState, SHOWN } from "../../lib/dismiss";
import type { AgentEditState } from "../../lib/projectMemory";
import { dismissRecovery } from "../RecoveryNotice";

/** An agent's direct edit to project memory, as the window's toast shows it. */
export interface MemoryEditBanner {
  readonly key: string;
  /** "Project memory updated". */
  readonly title: string;
  /** "Claude Code · Fix the login flow · auracode", on one line. */
  readonly detail: string;
  /** The whole sentence, for the tooltip a shortened line leaves out. */
  readonly text: string;
  readonly state: AgentEditState;
  /** Opens Customize > Project memory on the edit, with its changes. */
  readonly onReview?: () => void;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** A memory edit's toast leaves by itself after this long, unless it is pointed at or focused. */
export const MEMORY_TOAST_MS = 12_000;
/** An undone edit's toast, which only confirms, leaves sooner. */
export const UNDONE_TOAST_MS = 6_000;

/** The sentence a storage problem shows, or `null` while saving runs. */
export function storageBanner(storage: StorageStatus | null): string | null {
  if (storage === null) return null;
  switch (storage.state.state) {
    case "ok":
      return null;
    case "paused":
      return storage.state.reason === "disk_full"
        ? "The disk is full. auracode paused saving and the agents are waiting. Free some space; nothing is lost unless you quit now."
        : "auracode's database is busy (another program is using it). auracode paused saving and the agents are waiting; nothing is lost unless you quit now.";
    case "failed":
      return storage.state.message;
  }
}

/** The sentence an environment fallback shows, or `null` when the login shell's env is in use. */
export function envBanner(env: EnvStatus | null): string | null {
  if (env?.state.state !== "fallback") return null;
  return `auracode couldn't read your shell's environment (${env.state.reason}), so agents start with a basic one and may not find their tools.`;
}

/**
 * One toast (owner, 7 November 2026, of the stack that floated above the composer: "the
 * positioning, everything. sucks"): a mark, a short title, one quieter line, its actions, and an
 * X when it can go. The window's stack sits at the pane's top right under its header, the same
 * place on every page, so it never covers the composer or the reply being written.
 */
export function Toast({
  level,
  mark,
  title,
  detail,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  dismissDisabled = false,
  tooltip,
  testId,
  live = "status",
  autoDismissMs = null,
}: {
  readonly level?: "warning" | "error";
  readonly mark: ReactNode;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
  readonly dismissDisabled?: boolean;
  readonly tooltip?: string;
  readonly testId?: string;
  /** How a screen reader hears it arrive: politely, or at once for a failure. */
  readonly live?: "status" | "alert";
  /** Leaves by itself after this long while nobody points at or focuses it; `null` stays. */
  readonly autoDismissMs?: number | null;
}) {
  const text = useId();
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const paused = held.pointer || held.focus;
  // The window re-renders often; the countdown follows only what it waits for, not each new
  // callback, and calls the newest one.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const dismissable = onDismiss !== undefined;
  useEffect(() => {
    if (autoDismissMs === null || !dismissable || paused) return;
    const timer = setTimeout(() => dismiss.current?.(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [autoDismissMs, dismissable, paused]);
  return (
    <li
      className="chat-banner ui-toast"
      data-level={level}
      data-testid={testId}
      title={tooltip}
      onPointerEnter={() => setHeld((now) => ({ ...now, pointer: true }))}
      onPointerLeave={() => setHeld((now) => ({ ...now, pointer: false }))}
      onFocus={() => setHeld((now) => ({ ...now, focus: true }))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setHeld((now) => ({ ...now, focus: false }));
      }}
    >
      <span className="ui-toast-mark" aria-hidden="true">
        {mark}
      </span>
      <div className="ui-toast-body">
        <div id={text} role={live}>
          <p className="ui-toast-title">{title}</p>
          {detail ? <p className="ui-toast-detail">{detail}</p> : null}
        </div>
        {actions ? <div className="ui-toast-actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="g-button g-button-ghost g-button-24 g-button-icon ui-toast-close"
          aria-label={dismissLabel}
          aria-describedby={text}
          title={dismissLabel}
          disabled={dismissDisabled}
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The window's notices: saving paused or failed, the environment fallback with Retry, the
 * database repair notice (dismissable for good), startup notices (dismissable for now), agents'
 * direct edits to project memory, with Review and Undo, and agents' newer releases (`updates`,
 * their toasts), each until its X for this run of auracode.
 */
export function Banners({
  storage,
  env,
  onRetryEnv,
  recoveryNotice,
  onRecoveryDismissed,
  notices,
  memoryEdits = [],
  updates = [],
}: {
  readonly storage: StorageStatus | null;
  readonly env: EnvStatus | null;
  readonly onRetryEnv: () => void;
  readonly recoveryNotice: string | null;
  readonly onRecoveryDismissed: () => void;
  readonly notices: readonly string[];
  readonly memoryEdits?: readonly MemoryEditBanner[];
  readonly updates?: readonly ReactNode[];
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const storageText = storageBanner(storage);
  const envText = envBanner(env);
  const shown = notices.filter((notice) => !dismissed.has(notice));
  if (
    storageText === null &&
    envText === null &&
    recoveryNotice === null &&
    shown.length === 0 &&
    memoryEdits.length === 0 &&
    updates.length === 0
  ) {
    return null;
  }
  const failed = storage?.state.state === "failed";
  return (
    <ul className="chat-banners ui-toasts" aria-label="Notices">
      {storageText !== null ? (
        <Toast
          level={failed ? "error" : "warning"}
          live={failed ? "alert" : "status"}
          mark={<HardDrive size={16} />}
          title={failed ? "Saving failed" : "Saving paused"}
          detail={storageText}
        />
      ) : null}
      {envText !== null ? (
        <Toast
          level="warning"
          mark={<TriangleAlert size={16} />}
          title="Agents start with a basic environment"
          detail={envText}
          actions={
            <button type="button" className="g-button g-button-24" onClick={onRetryEnv}>
              Retry
            </button>
          }
        />
      ) : null}
      {recoveryNotice !== null ? (
        <RecoveryBanner message={recoveryNotice} onDismissed={onRecoveryDismissed} />
      ) : null}
      {shown.map((notice) => (
        <Toast
          key={notice}
          mark={<Info size={16} />}
          title={notice}
          onDismiss={() => setDismissed((current) => new Set([...current, notice]))}
        />
      ))}
      {memoryEdits.map((edit) => (
        <MemoryEditBannerView key={edit.key} edit={edit} />
      ))}
      {updates}
    </ul>
  );
}

/**
 * An agent's direct edit to project memory: a calm toast that never blocks the chat and leaves by
 * itself (Customize > Project memory keeps every revision). Review opens the edit's changes; Undo
 * restores what it replaced as a new revision of the person's.
 */
export function MemoryEditBannerView({ edit }: { readonly edit: MemoryEditBanner }) {
  const { state } = edit;
  const busy = state.status === "undoing";
  return (
    <Toast
      testId="memory-edit-banner"
      mark={<NotebookPen size={16} />}
      title={edit.title}
      tooltip={edit.text}
      detail={
        <>
          <span className="ui-toast-line">{edit.detail}</span>
          {state.status === "failed" ? (
            <span role="alert" className="ui-error">
              {state.message}
            </span>
          ) : null}
        </>
      }
      autoDismissMs={
        state.status === "shown"
          ? MEMORY_TOAST_MS
          : state.status === "undone"
            ? UNDONE_TOAST_MS
            : null
      }
      onDismiss={edit.onDismiss}
      dismissDisabled={busy}
      actions={
        edit.onReview || state.status === "shown" || busy ? (
          <>
            {edit.onReview && state.status !== "undone" ? (
              <button
                type="button"
                className="g-button g-button-24"
                disabled={busy}
                onClick={edit.onReview}
              >
                Review
              </button>
            ) : null}
            {state.status === "shown" || busy ? (
              <button
                type="button"
                className="g-button g-button-24"
                disabled={busy}
                onClick={edit.onUndo}
              >
                {busy ? "Undoing…" : "Undo"}
              </button>
            ) : null}
          </>
        ) : null
      }
    />
  );
}

/**
 * The database repair notice: it shows on every launch until dismissed here, because whatever the
 * repair could not save is only in the damaged copy it names. The shell must confirm first.
 */
export function RecoveryBanner({
  message,
  onDismissed,
}: {
  readonly message: string;
  readonly onDismissed: () => void;
}) {
  const [state, setState] = useState<DismissState>(SHOWN);
  return (
    <RecoveryBannerView
      message={message}
      state={state}
      onDismiss={() => {
        void dismissRecovery(setState, onDismissed);
      }}
    />
  );
}

/** What `RecoveryBanner` shows in `state`. */
export function RecoveryBannerView({
  message,
  state,
  onDismiss,
}: {
  readonly message: string;
  readonly state: DismissState;
  readonly onDismiss: () => void;
}) {
  if (state.status === "dismissed") return null;
  return (
    <Toast
      level="warning"
      mark={<DatabaseBackup size={16} />}
      title="auracode repaired its database"
      detail={
        <>
          {message}
          {state.status === "shown" && state.problem !== null ? (
            <span role="alert" className="ui-error">
              {" "}
              {state.problem}
            </span>
          ) : null}
        </>
      }
      onDismiss={onDismiss}
      dismissLabel={state.status === "dismissing" ? "Dismissing…" : "Dismiss"}
      dismissDisabled={state.status === "dismissing"}
    />
  );
}
