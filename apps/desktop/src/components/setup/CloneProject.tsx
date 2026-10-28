import { FolderOpen, GitBranch } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CloneApi, cloneApi } from "../../lib/setup-actions/api";
import type { CloneRecord, CloneReview } from "../../lib/setup-actions/bindings";
import { DialogClose, dialogClassName } from "../chat/Modal";

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
        className="g-button g-button-ghost g-button-28 setup-clone"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <GitBranch size={14} aria-hidden="true" />
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

/**
 * Clone in three states on one dialog (Vercel's transfer dialog): the form, the reviewed command
 * as rows, then the running or finished clone. Nothing starts before Start clone.
 */
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
  const hint = useId();
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
      className={dialogClassName("md", "setup-dialog setup-clone-dialog")}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="g-dialog-header">
        <h2 id={title} className="g-dialog-title">
          Clone from GitHub
        </h2>
        <DialogClose label="Close clone" onClick={close} />
      </header>
      {!review && !record ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <p className="setup-dialog-lead">
            Copy a repository into a new folder. Use a public HTTPS address or SSH access you
            already set up; no sign-in runs here.
          </p>
          <label className="setup-field">
            GitHub repository
            <input
              className="g-input"
              required
              maxLength={256}
              value={remote}
              disabled={busy || fixedRemote !== undefined}
              placeholder="https://github.com/owner/repository"
              onChange={(event) => setRemote(event.currentTarget.value)}
            />
          </label>
          <div className="setup-field">
            <span aria-hidden="true">Location</span>
            <button type="button" className="setup-picker" disabled={busy} onClick={choose}>
              <FolderOpen size={16} aria-hidden="true" />
              <span>
                <strong>Choose parent folder</strong>
                {parent ? <small className="setup-path">{parent}</small> : null}
              </span>
            </button>
          </div>
          <div className="setup-field">
            <label htmlFor={`${hint}-name`}>New folder name</label>
            <input
              id={`${hint}-name`}
              className="g-input"
              required
              maxLength={100}
              value={name}
              disabled={busy}
              placeholder="my-project"
              aria-describedby={hint}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <small id={hint} className="setup-hint">
              Existing folders are never reused. A canceled clone keeps its partial files.
            </small>
          </div>
          {error ? (
            <p role="alert" className="setup-alert">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions setup-dialog-actions">
            <button type="button" className="g-button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="g-button g-button-primary"
              disabled={busy || !parent || !remote || !name}
            >
              {busy ? "Preparing…" : "Review clone"}
            </button>
          </div>
        </form>
      ) : null}
      {review ? (
        <section className="setup-clone-review" aria-label="Clone review">
          <p className="setup-dialog-lead">Check where the repository will be cloned.</p>
          <dl className="setup-rows">
            <dt>Repository</dt>
            <dd>{review.remote}</dd>
            <dt>Destination</dt>
            <dd>{review.destination}</dd>
          </dl>
          <ul className="setup-notices">
            {review.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="setup-alert">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions setup-dialog-actions">
            <button type="button" className="g-button" disabled={busy} onClick={back}>
              Back
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={start}
            >
              {busy ? "Starting…" : "Start clone"}
            </button>
          </div>
        </section>
      ) : null}
      {record ? (
        <section className="setup-clone-result" aria-label="Clone progress">
          <p role="status" className="setup-clone-status" data-state={record.state}>
            {record.detail}
          </p>
          <dl className="setup-rows">
            <dt>Folder</dt>
            <dd>{record.destination}</dd>
            <dt>Recovery record</dt>
            <dd>{record.journal}</dd>
          </dl>
          {error ? (
            <p role="alert" className="setup-alert">
              {error}
            </p>
          ) : null}
          <div className="g-dialog-actions setup-dialog-actions">
            {active ? (
              <button
                type="button"
                className="g-button"
                disabled={busy}
                onClick={() => void run(() => api.cancel(record.id))}
              >
                Cancel clone
              </button>
            ) : (
              <>
                <button type="button" className="g-button" onClick={back}>
                  Review another clone
                </button>
                {record.state === "ready" ? (
                  <button
                    type="button"
                    className="g-button g-button-primary"
                    onClick={() => chooseFolder(record.destination)}
                  >
                    Use this folder
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}
      {!review && !record && history.length > 0 ? (
        <section className="setup-clone-history" aria-label="Previous clones">
          <h3>Previous clones here</h3>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.state === "ready" ? "Ready" : "Kept for review"}</strong>
                  <span className="setup-path">{item.destination}</span>
                  <small>{item.detail}</small>
                </div>
                {item.state === "ready" ? (
                  <button
                    type="button"
                    className="g-button g-button-outline g-button-28"
                    onClick={() => chooseFolder(item.destination)}
                  >
                    Use folder
                  </button>
                ) : null}
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
