import { GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  GitWorkspace,
  IsolationPreview,
  ManagedWorktree,
  WorktreeActionPreview,
  WorktreeActionResult,
  WorktreeRecoveryAction,
  WorktreeRecoveryPreview,
} from "../../bindings";
import { errorMessage } from "../../lib/errors";
import type { GitWorkspaceApi } from "../../lib/gitWorkspace";
import { Modal } from "./Modal";
import "./git-dialog.css";

type Preview =
  | { type: "isolate"; value: IsolationPreview }
  | { type: "action"; value: WorktreeActionPreview }
  | { type: "recovery"; value: WorktreeRecoveryPreview };

function Repository({ workspace }: { readonly workspace: GitWorkspace }) {
  return (
    <section className="git-repository" aria-label="Repository state">
      <div className="git-branch">
        <GitBranch size={15} />
        <strong>{workspace.branch ?? "Detached HEAD"}</strong>
        <code>{workspace.head?.slice(0, 12) ?? "No commits"}</code>
      </div>
      <p className="git-path">{workspace.root}</p>
      <div className="git-status">
        <span>
          {workspace.files.length === 0
            ? "Working tree clean"
            : `${workspace.files.length} changed paths`}
        </span>
        {workspace.is_linked_worktree ? <span>Linked worktree</span> : null}
        {workspace.has_submodules ? <span>Contains submodules</span> : null}
      </div>
      {workspace.files.length > 0 ? (
        <details>
          <summary>Changed files</summary>
          <ul className="git-files">
            {workspace.files.map((file) => (
              <li key={file.path}>
                <code>
                  {file.index}
                  {file.worktree}
                </code>
                <span>{file.path}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {workspace.blockers.map((blocker) => (
        <p className="git-warning" key={blocker}>
          {blocker}
        </p>
      ))}
    </section>
  );
}

export function GitDialog({
  chatId,
  title,
  api,
  live,
  onStop,
  onClose,
  onChanged,
  allowIsolation = false,
}: {
  readonly chatId: string;
  readonly title: string;
  readonly api: GitWorkspaceApi;
  readonly live: boolean;
  readonly onStop: () => Promise<void>;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly allowIsolation?: boolean;
}) {
  const [workspace, setWorkspace] = useState<GitWorkspace | null>(null);
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<WorktreeActionResult | null>(null);
  const [slug, setSlug] = useState(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 36)
      .replace(/^-+|-+$/g, "") || "work",
  );
  const [message, setMessage] = useState(`Merge ${title || "isolated work"}`);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false);
  const acting = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    void revision;
    const current = ++request.current;
    setLoading(true);
    void Promise.allSettled([api.inspect(chatId), api.list(chatId)]).then(([inspection, owned]) => {
      if (!alive.current || current !== request.current) return;
      if (inspection.status === "fulfilled") setWorkspace(inspection.value);
      else {
        setWorkspace(null);
        setError(errorMessage(inspection.reason));
      }
      if (owned.status === "fulfilled") setWorktrees(owned.value);
      else setError(errorMessage(owned.reason));
      setLoading(false);
    });
  }, [api, chatId, revision]);
  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    request.current++;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      if (alive.current) {
        setError(errorMessage(failure));
        setPreview(null);
      }
    } finally {
      acting.current = false;
      if (alive.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  };
  const reviewIsolation = () =>
    run(async () => {
      const value = await api.isolationPreview(chatId, { slug, bring_changes: false });
      if (alive.current) {
        setPreview({ type: "isolate", value });
        setResult(null);
      }
    });
  const reviewAction = (tree: ManagedWorktree, type: "merge" | "discard") =>
    run(async () => {
      const value = await api.actionPreview(
        chatId,
        tree.id,
        type === "merge" ? { type, message } : { type },
      );
      if (alive.current) {
        setPreview({ type: "action", value });
        setResult(null);
      }
    });
  const apply = () =>
    run(async () => {
      if (!preview) return;
      const chosen = preview;
      setPreview(null);
      try {
        if (chosen.type === "isolate") {
          const value = await api.isolationApply(chatId, chosen.value.token);
          if (alive.current)
            setResult({
              worktree: value.worktree,
              recovery: value.warning ?? "The isolated worktree is ready.",
              commit: null,
              error:
                value.worktree.state === "ready"
                  ? null
                  : (value.warning ?? "Review this worktree's recovery state."),
            });
        } else if (chosen.type === "recovery") {
          const value = await api.recoveryApply(
            chatId,
            chosen.value.worktree.id,
            chosen.value.token,
          );
          if (alive.current) setResult(value);
        } else {
          const value = await api.actionApply(chatId, chosen.value.token);
          if (alive.current) setResult(value);
        }
      } finally {
        if (alive.current) {
          onChanged();
          setRevision((value) => value + 1);
        }
      }
    });
  const reviewRecovery = (tree: ManagedWorktree, action: WorktreeRecoveryAction) =>
    run(async () => {
      const value = await api.recoveryPreview(chatId, tree.id, action);
      if (alive.current) {
        setPreview({ type: "recovery", value });
        setResult(null);
      }
    });
  const blocked = busy || loading || live;
  const conflict = preview?.type === "action" && preview.value.conflicts.length > 0;
  return (
    <Modal
      title="Git workspace"
      className="git-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="git-dialog-body">
        {live ? (
          <div className="git-notice">
            <p>
              Stop this session before changing its workspace. Other chats using either folder must
              also be stopped.
            </p>
            <button
              type="button"
              className="ui-button"
              disabled={busy}
              onClick={() => void run(onStop)}
            >
              Stop session
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="git-warning">
            {error}
          </p>
        ) : null}
        {loading ? <p role="status">Reading repository state…</p> : null}
        {workspace ? <Repository workspace={workspace} /> : null}
        {preview ? (
          <section className="git-review" aria-label="Review Git operation">
            <h3>
              {preview.type === "isolate"
                ? "Review isolation"
                : preview.type === "recovery"
                  ? preview.value.action === "restore"
                    ? "Review restoration"
                    : "Review recovery"
                  : preview.value.action.type === "merge"
                    ? "Review merge"
                    : "Review retirement"}
            </h3>
            {preview.type === "isolate" ? (
              <dl>
                <dt>Branch</dt>
                <dd>{preview.value.branch}</dd>
                <dt>New folder</dt>
                <dd>{preview.value.path}</dd>
                <dt>Starting commit</dt>
                <dd>{preview.value.source.head}</dd>
              </dl>
            ) : preview.type === "recovery" ? (
              <dl>
                <dt>Worktree</dt>
                <dd>{preview.value.worktree.branch}</dd>
                <dt>Current folder</dt>
                <dd>{preview.value.folder.root}</dd>
                <dt>Destination</dt>
                <dd>{preview.value.destination}</dd>
                {preview.value.worktree.recovery?.type === "merge" ? (
                  <>
                    <dt>Before ref</dt>
                    <dd>{preview.value.worktree.recovery.before_ref}</dd>
                    <dt>Prepared ref</dt>
                    <dd>{preview.value.worktree.recovery.prepared_ref}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <>
                <dl>
                  <dt>Worktree</dt>
                  <dd>{preview.value.worktree.branch}</dd>
                  <dt>Folder</dt>
                  <dd>{preview.value.worktree.path}</dd>
                  {preview.value.target ? (
                    <>
                      <dt>Target branch</dt>
                      <dd>{preview.value.target.branch}</dd>
                      <dt>Target folder</dt>
                      <dd>{preview.value.target.root}</dd>
                    </>
                  ) : null}
                </dl>
                <pre>{preview.value.changes || "No file changes."}</pre>
                {preview.value.conflicts.length > 0 ? (
                  <>
                    <h4>Conflicts to resolve first</h4>
                    <ul>
                      {preview.value.conflicts.map((path) => (
                        <li key={path}>
                          <code>{path}</code>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
            {preview.value.warnings.map((warning) => (
              <p className="git-warning" key={warning}>
                {warning}
              </p>
            ))}
            <p className="git-note">
              This review expires in ten minutes. Changed repository state requires a new review.
            </p>
            <div className="git-actions">
              <button
                type="button"
                className="ui-button"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-button"
                data-kind="primary"
                disabled={blocked || conflict}
                onClick={() => void apply()}
              >
                {preview.type === "isolate"
                  ? "Create isolated workspace"
                  : preview.type === "recovery"
                    ? preview.value.action === "restore"
                      ? "Restore retained worktree"
                      : "Reconcile reviewed state"
                    : preview.value.action.type === "merge"
                      ? "Merge reviewed changes"
                      : "Retire and keep files"}
              </button>
            </div>
          </section>
        ) : (
          <>
            {allowIsolation && workspace ? (
              <section className="git-section">
                <h3>Isolate this chat</h3>
                <p>
                  Work on a separate branch and folder. The source folder and its uncommitted
                  changes stay in place.
                </p>
                <label className="ui-field">
                  Branch name
                  <input
                    className="ui-input"
                    value={slug}
                    maxLength={36}
                    onChange={(event) => setSlug(event.currentTarget.value)}
                    disabled={busy}
                  />
                </label>
                <button
                  type="button"
                  className="ui-button"
                  disabled={blocked || !slug.trim() || workspace.blockers.length > 0}
                  onClick={() => void reviewIsolation()}
                >
                  Review isolation
                </button>
              </section>
            ) : null}
            {worktrees.length ? (
              <section className="git-section">
                <h3>Owned worktrees</h3>
                <label className="ui-field">
                  Merge message
                  <input
                    className="ui-input"
                    value={message}
                    maxLength={4096}
                    disabled={busy}
                    onChange={(event) => setMessage(event.currentTarget.value)}
                  />
                </label>
                <ul className="git-worktrees">
                  {worktrees.map((tree) => (
                    <li key={tree.id}>
                      <strong>{tree.branch}</strong>
                      <span className="git-state">{tree.state.replaceAll("_", " ")}</span>
                      <p className="git-path">{tree.path}</p>
                      {tree.detail ? <p>{tree.detail}</p> : null}
                      {tree.state === "retired" ? (
                        <div className="git-actions">
                          <button
                            type="button"
                            className="ui-button"
                            disabled={blocked}
                            onClick={() => void reviewRecovery(tree, "restore")}
                          >
                            Review restoration
                          </button>
                        </div>
                      ) : null}
                      {["creating", "merging", "retiring", "recovery_required", "missing"].includes(
                        tree.state,
                      ) ? (
                        <div className="git-actions">
                          <button
                            type="button"
                            className="ui-button"
                            disabled={blocked}
                            onClick={() => void reviewRecovery(tree, "reconcile")}
                          >
                            Review recovery
                          </button>
                        </div>
                      ) : null}
                      {tree.state === "ready" ? (
                        <div className="git-actions">
                          <button
                            type="button"
                            className="ui-button"
                            disabled={blocked || !message.trim()}
                            onClick={() => void reviewAction(tree, "merge")}
                          >
                            Review merge
                          </button>
                          <button
                            type="button"
                            className="ui-button"
                            disabled={blocked}
                            onClick={() => void reviewAction(tree, "discard")}
                          >
                            Review retirement
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        {result ? (
          <section className="git-result" aria-label="Git result">
            <h3>{result.error ? "Recovery needs attention" : "Workspace updated"}</h3>
            {result.error ? <p role="alert">{result.error}</p> : null}
            <p>{result.recovery}</p>
            <p className="git-path">{result.worktree.path}</p>
            {result.commit ? <code>{result.commit}</code> : null}
          </section>
        ) : null}
      </div>
      <footer className="git-footer">
        <span role="status">
          {busy ? "Finishing Git operation…" : "Your index is checked again before changes apply."}
        </span>
        <button
          type="button"
          className="ui-button"
          disabled={busy || loading}
          onClick={() => {
            setPreview(null);
            setError(null);
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </footer>
    </Modal>
  );
}
