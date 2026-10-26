import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CloneApi, cloneApi } from "../../lib/setup-actions/api";
import type { CloneRecord, CloneReview } from "../../lib/setup-actions/bindings";

export function CloneProject({
  pickParent,
  onFolder,
  disabled = false,
  api = cloneApi,
  remote,
  label = "Clone from GitHub",
}: {
  readonly pickParent: () => Promise<string | null>;
  readonly onFolder: (path: string) => void;
  readonly disabled?: boolean;
  readonly api?: CloneApi;
  readonly remote?: string;
  readonly label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="setup-text-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <CloneDialog
          api={api}
          pickParent={pickParent}
          onClose={() => setOpen(false)}
          onFolder={onFolder}
          fixedRemote={remote}
        />
      ) : null}
    </>
  );
}

function CloneDialog({
  api,
  pickParent,
  onClose,
  onFolder,
  fixedRemote,
}: {
  api: CloneApi;
  pickParent: () => Promise<string | null>;
  onClose: () => void;
  onFolder: (path: string) => void;
  fixedRemote?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const prepared = useRef<string | null>(null);
  const started = useRef<string | null>(null);
  const pending = useRef(false);
  const title = useId();
  const [remote, setRemote] = useState(fixedRemote ?? "");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [review, setReview] = useState<CloneReview | null>(null);
  const [record, setRecord] = useState<CloneRecord | null>(null);
  const [history, setHistory] = useState<CloneRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = record?.state === "running" || record?.state === "cleanup_pending";
  const jobId = record?.id;
  const cancel = useCallback(() => {
    const id = started.current ?? prepared.current;
    if (id) void api.cancel(id).catch(() => {});
    prepared.current = null;
    started.current = null;
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
      cancel();
      dialog.current?.close();
    };
  }, [cancel]);

  useEffect(() => {
    if (!jobId || !active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.status(jobId);
        if (!live) return;
        setRecord(next);
        if (next.state === "running" || next.state === "cleanup_pending")
          timer = setTimeout(poll, 500);
      } catch (reason) {
        if (live) {
          setError(message(reason));
          void api.cancel(jobId).catch(() => {});
          timer = setTimeout(poll, 2000);
        }
      }
    };
    timer = setTimeout(poll, 100);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, jobId, active]);

  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      if (mounted.current) setError(message(reason));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const close = () => {
    cancel();
    onClose();
  };
  const choose = () =>
    void run(async () => {
      const path = await pickParent();
      if (!mounted.current || !path) return;
      setParent(path);
      setHistory([]);
      const previous = await api.history(path);
      if (mounted.current) setHistory(previous);
    });
  const prepare = () =>
    void run(async () => {
      const value = await api.review({ remote, parent, name });
      if (!mounted.current) {
        await api.cancelReview(value.id);
        return;
      }
      prepared.current = value.id;
      setReview(value);
    });
  const start = () =>
    void run(async () => {
      if (!review) return;
      started.current = review.id;
      const value = await api.start(review.id);
      if (!mounted.current) {
        await api.cancel(review.id);
        return;
      }
      prepared.current = null;
      setReview(null);
      setRecord(value);
    });
  const back = () => {
    if (prepared.current) void api.cancelReview(prepared.current).catch(() => {});
    prepared.current = null;
    started.current = null;
    setReview(null);
    setRecord(null);
    setError("");
  };
  const chooseFolder = (path: string) => {
    onFolder(path);
    close();
  };
  const content = (
    <dialog
      ref={dialog}
      className="orbit-theme setup-clone-dialog"
      data-theme="dark"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <span className="setup-eyebrow">FIRST PROJECT</span>
          <h2 id={title}>Clone from GitHub</h2>
        </div>
        <button type="button" className="setup-text-button" onClick={close}>
          Close clone
        </button>
      </header>
      {!review && !record ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <p>
            Use a public HTTPS repository or SSH access you have already set up. No sign-in runs
            here.
          </p>
          <label className="setup-field">
            GitHub repository
            <input
              required
              maxLength={256}
              value={remote}
              disabled={busy || fixedRemote !== undefined}
              placeholder="https://github.com/owner/repository"
              onChange={(event) => setRemote(event.currentTarget.value)}
            />
          </label>
          <button type="button" className="setup-folder" disabled={busy} onClick={choose}>
            <span>
              <strong>Choose parent folder</strong>
              <small>{parent || "Pick where the new folder will be created"}</small>
            </span>
          </button>
          <label className="setup-field">
            New folder name
            <input
              required
              maxLength={100}
              value={name}
              disabled={busy}
              placeholder="my-project"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <p className="setup-footnote">
            Existing folders are never reused. A canceled clone keeps its partial files.
          </p>
          <button
            type="submit"
            className="setup-button"
            disabled={busy || !parent || !remote || !name}
          >
            {busy ? "Preparing…" : "Review clone"}
          </button>
        </form>
      ) : null}
      {review ? (
        <section className="setup-clone-review">
          <dl>
            <dt>Repository</dt>
            <dd>{review.remote}</dd>
            <dt>Destination</dt>
            <dd>{review.destination}</dd>
          </dl>
          <ul>
            {review.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
          <footer>
            <button type="button" className="setup-text-button" disabled={busy} onClick={back}>
              Back
            </button>
            <button type="button" className="setup-button" disabled={busy} onClick={start}>
              {busy ? "Starting…" : "Start clone"}
            </button>
          </footer>
        </section>
      ) : null}
      {record ? (
        <section className="setup-clone-result">
          <p role="status">{record.detail}</p>
          <p className="setup-path">{record.destination}</p>
          {active ? (
            <button
              type="button"
              className="setup-button"
              disabled={busy}
              onClick={() => void run(() => api.cancel(record.id))}
            >
              Cancel clone
            </button>
          ) : (
            <>
              {record.state === "ready" ? (
                <button
                  type="button"
                  className="setup-button"
                  onClick={() => chooseFolder(record.destination)}
                >
                  Use this folder
                </button>
              ) : null}
              <button type="button" className="setup-text-button" onClick={back}>
                Review another clone
              </button>
            </>
          )}
          <p className="setup-footnote">
            Recovery record: <span className="setup-path">{record.journal}</span>
          </p>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="setup-error">
          {error}
        </p>
      ) : null}
      {!review && !record && history.length > 0 ? (
        <section className="setup-clone-history">
          <h3>Previous clones in this parent</h3>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <strong>{item.state === "ready" ? "Ready" : "Retained for review"}</strong>
                <p className="setup-path">{item.destination}</p>
                <p>{item.detail}</p>
                {item.state === "ready" ? (
                  <button
                    type="button"
                    className="setup-text-button"
                    onClick={() => chooseFolder(item.destination)}
                  >
                    Use folder
                  </button>
                ) : null}
                <small className="setup-path">{item.journal}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </dialog>
  );
  return createPortal(content, document.body);
}
function message(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "The clone action could not continue. Existing files were retained.";
}
