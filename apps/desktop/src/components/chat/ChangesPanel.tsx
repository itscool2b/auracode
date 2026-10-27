import { FileDiff, RefreshCw, RotateCcw, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import type {
  AgentEntry,
  ChangeDiff,
  ChangesSnapshot,
  RevertPreview,
  RevertResult,
  SessionStatus,
} from "../../bindings";
import type { ChangesTransport } from "../../lib/changes";
import type { ChatState } from "../../lib/chat/chatStore";
import { hasProcess, type Transcript } from "../../lib/chat/transcript";
import type { ComposerTransport } from "../../lib/composer";
import { errorMessage } from "../../lib/errors";
import { ContextContents, type ContextTab } from "./ContextContents";
import { DiffBlock } from "./DiffBlock";
import { Modal } from "./Modal";

export function ChangesPanel({
  chatId,
  api,
  status,
  transcript,
  onClose,
  onStop,
  state,
  composer,
  agent,
}: {
  readonly chatId: string;
  readonly api: ChangesTransport;
  readonly status: SessionStatus;
  readonly transcript: Transcript;
  readonly onClose: () => void;
  readonly onStop: () => void;
  readonly state: ChatState;
  readonly composer?: ComposerTransport;
  readonly agent: AgentEntry | null;
}) {
  const title = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const [scope, setScope] = useState("");
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ChangesSnapshot | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [path, setPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<ChangeDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [preview, setPreview] = useState<RevertPreview | null>(null);
  const [result, setResult] = useState<RevertResult | null>(null);
  const [width, setWidth] = useState(380);
  const [tab, setTab] = useState<ContextTab>("Changes");
  const live = hasProcess(status);

  useEffect(() => {
    // A status transition or explicit refresh scans the current files once.
    void status;
    void revision;
    let stale = false;
    setBusy(true);
    setError(null);
    void api
      .snapshot(chatId, scope || null)
      .then((value) => {
        if (stale) return;
        setSnapshot(value);
        setSelected(
          (current) =>
            new Set([...current].filter((path) => value.files.some((file) => file.path === path))),
        );
        setPath((current) =>
          value.files.some((file) => file.path === current)
            ? current
            : (value.files[0]?.path ?? null),
        );
      })
      .catch((error) => {
        if (!stale) {
          setSnapshot(null);
          setPath(null);
          setSelected(new Set());
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!stale) setBusy(false);
      });
    return () => {
      stale = true;
    };
  }, [api, chatId, scope, status, revision]);

  const checkpoint = snapshot?.checkpoint;
  useEffect(() => {
    let stale = false;
    setDiff(null);
    if (!checkpoint || !path) return;
    void api
      .diff(chatId, checkpoint.id, path)
      .then((value) => {
        if (!stale) setDiff(value);
      })
      .catch((error) => {
        if (!stale) setError(errorMessage(error));
      });
    return () => {
      stale = true;
    };
  }, [api, chatId, checkpoint, path]);

  const review = async () => {
    if (!checkpoint || !selected.size || acting) return;
    setActing(true);
    setError(null);
    try {
      setPreview(await api.preview(chatId, checkpoint.id, [...selected]));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setActing(false);
    }
  };
  const revert = async () => {
    if (!preview || acting) return;
    setActing(true);
    try {
      setResult(await api.revert(chatId, preview.token));
      setSelected(new Set());
      setRevision((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPreview(null);
      setActing(false);
    }
  };
  const turns = transcript.segments
    .flatMap((segment) => {
      if (!segment.turnId) return [];
      const prompt = segment.itemKeys
        .map((key) => transcript.items.get(key))
        .find((item) => item?.kind === "user");
      return [
        {
          id: segment.turnId,
          label: prompt?.kind === "user" ? prompt.text.slice(0, 70) : "Earlier turn",
        },
      ];
    })
    .reverse();

  return (
    <aside
      className="changes-panel"
      style={{ "--changes-width": `${width}px` } as CSSProperties}
      aria-labelledby={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <hr
        className="changes-resizer"
        tabIndex={0}
        aria-label="Resize Changes panel"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={560}
        aria-valuenow={width}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setWidth((value) =>
              Math.max(320, Math.min(560, value + (event.key === "ArrowLeft" ? 20 : -20))),
            );
          }
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            const edge = event.currentTarget.parentElement?.getBoundingClientRect().right;
            if (edge) setWidth(Math.max(320, Math.min(560, edge - event.clientX)));
          }
        }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      />
      <header className="changes-panel-header">
        <h2 id={title} className="sr-only">
          Chat context
        </h2>
        <div
          className="context-panel-tabs"
          role="tablist"
          aria-label="Chat context"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs: ContextTab[] = ["Changes", "Files", "Plan", "Session"];
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                    tabs.length;
            event.preventDefault();
            setTab(tabs[index] ?? "Changes");
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
          }}
        >
          {(["Changes", "Files", "Plan", "Session"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${title}-${item}`}
              aria-controls={`${title}-content`}
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => setTab(item)}
            >
              {item}
              {item === "Changes" && snapshot?.files.length ? (
                <small>{snapshot.files.length}</small>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-28"
          title="Refresh changes"
          aria-label="Refresh changes"
          disabled={busy || acting}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          className="g-button g-button-ghost g-button-icon g-button-28"
          aria-label="Close Changes"
          ref={closeButton}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div
        className="context-tab-content"
        role="tabpanel"
        id={`${title}-content`}
        aria-labelledby={`${title}-${tab}`}
      >
        {tab !== "Changes" ? (
          <ContextContents tab={tab} state={state} api={composer} agent={agent} />
        ) : (
          <>
            <label className="changes-scope">
              Compare current files with
              <select
                className="g-select"
                value={scope}
                onChange={(event) => {
                  setScope(event.currentTarget.value);
                  setSelected(new Set());
                  setSnapshot(null);
                  setPath(null);
                  setDiff(null);
                }}
              >
                <option value="">Before the latest turn</option>
                {turns.map((turn) => (
                  <option key={turn.id} value={turn.id}>
                    Before: {turn.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="changes-panel-scroll">
              {busy ? (
                <p className="changes-empty" role="status">
                  Reading changes…
                </p>
              ) : null}
              {error ? (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              ) : null}
              {snapshot?.unavailable_reason ? (
                <p className="changes-empty">{snapshot.unavailable_reason}</p>
              ) : null}
              {!busy && checkpoint && snapshot?.files.length === 0 ? (
                <p className="changes-empty">No file changes since this checkpoint.</p>
              ) : null}
              {checkpoint?.warnings.length ? (
                <details className="changes-warnings">
                  <summary>Checkpoint exclusions</summary>
                  {checkpoint.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </details>
              ) : null}
              <div className="changes-file-list">
                {snapshot?.files.map((file) => (
                  <div key={file.path} data-selected={file.path === path}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${file.path} for revert`}
                      checked={selected.has(file.path)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(file.path);
                          else next.delete(file.path);
                          return next;
                        })
                      }
                    />
                    <button type="button" onClick={() => setPath(file.path)} title={file.path}>
                      <FileDiff size={14} />
                      <span>{file.path}</span>
                      <small data-kind={file.kind}>
                        {file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : "M"}
                      </small>
                    </button>
                  </div>
                ))}
              </div>
              {diff ? (
                diff.binary ? (
                  <p className="changes-empty">
                    Binary file.{" "}
                    {snapshot?.files.find((file) => file.path === diff.path)?.after_bytes ?? 0}{" "}
                    bytes after this change.
                  </p>
                ) : (
                  <>
                    {diff.truncated ? (
                      <p className="changes-warning">
                        This preview is shortened. Reverting restores the complete checkpoint file.
                      </p>
                    ) : null}
                    <DiffBlock
                      wholeFile={!diff.truncated}
                      key={`${checkpoint?.id}:${diff.path}`}
                      path={diff.path}
                      oldText={diff.before ?? ""}
                      newText={diff.after ?? ""}
                      disclosureKey={`changes:${chatId}:${checkpoint?.id}:${diff.path}`}
                    />
                  </>
                )
              ) : path && !error ? (
                <p className="changes-empty" role="status">
                  Opening file diff…
                </p>
              ) : null}
              {result ? (
                <section className="changes-result" aria-label="Revert result">
                  <p role="status">
                    Reverted {result.applied.length}{" "}
                    {result.applied.length === 1 ? "file" : "files"}.
                  </p>
                  {result.error ? (
                    <p role="alert" className="ui-error">
                      {result.error}
                    </p>
                  ) : null}
                  {result.recovery_paths.length ? (
                    <details>
                      <summary>Saved originals</summary>
                      {result.recovery_paths.map((path) => (
                        <p className="ui-mono" key={path}>
                          {path}
                        </p>
                      ))}
                    </details>
                  ) : null}
                </section>
              ) : null}
            </div>
            <footer className="changes-panel-footer">
              <span>{selected.size ? `${selected.size} selected` : "Select files to revert"}</span>
              {live ? (
                <button type="button" className="g-button g-button-28" onClick={onStop}>
                  Stop session to revert
                </button>
              ) : (
                <button
                  type="button"
                  className="g-button g-button-28"
                  disabled={!selected.size || busy || acting || error !== null}
                  onClick={() => void review()}
                >
                  <RotateCcw size={13} />
                  Review revert
                </button>
              )}
            </footer>
          </>
        )}
      </div>
      {preview ? (
        <Modal
          title="Revert selected files?"
          onClose={() => {
            if (!acting) setPreview(null);
          }}
        >
          <p className="changes-confirm-copy">
            Restore these files to their state before the selected turn.
          </p>
          <ul className="changes-confirm-files">
            {preview.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span>{file.kind}</span>
              </li>
            ))}
          </ul>
          {preview.warnings.map((warning) => (
            <p className="changes-warning" key={warning}>
              {warning}
            </p>
          ))}
          <div className="chat-dialog-actions">
            <button
              type="button"
              className="g-button"
              disabled={acting}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="g-button g-button-danger"
              disabled={acting}
              onClick={() => void revert()}
            >
              {acting
                ? "Reverting…"
                : `Revert ${preview.files.length} ${preview.files.length === 1 ? "file" : "files"}`}
            </button>
          </div>
        </Modal>
      ) : null}
    </aside>
  );
}
