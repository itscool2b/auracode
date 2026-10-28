import { GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  GitInitializePreview,
  GitWorkspace,
  IsolationPreview,
  ManagedWorktree,
  PullRequestPreview,
  PullRequestResult,
  WorktreeActionPreview,
  WorktreeActionResult,
  WorktreeDestination,
  WorktreeRecoveryAction,
  WorktreeRecoveryPreview,
  WorktreeRecreatePreview,
  WorktreeRelocationPreview,
} from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { type GitWorkspaceApi, sameFolder, withoutVerbatimPrefix } from "../../lib/gitWorkspace";
import type { ProjectToolsApi } from "../../lib/projectTools";
import type { WorktreeSetupApi } from "../../lib/worktreeSetup";
import { MergeConflicts } from "./MergeConflicts";
import { Modal } from "./Modal";
import { RecreateWorktreeDialog } from "./RecreateWorktreeDialog";
import { WorktreeSetupPanel } from "./WorktreeSetupPanel";
import "./git-dialog.css";

type Preview =
  | { type: "initialize"; value: GitInitializePreview }
  | { type: "isolate"; value: IsolationPreview }
  | { type: "action"; value: WorktreeActionPreview }
  | { type: "recovery"; value: WorktreeRecoveryPreview }
  | { type: "pull_request"; value: PullRequestPreview }
  | { type: "relocate"; value: WorktreeRelocationPreview };

function Repository({ workspace }: { readonly workspace: GitWorkspace }) {
  return (
    <section className="git-repository" aria-label="Repository state">
      <div className="git-branch">
        <GitBranch size={15} />
        <strong>{workspace.branch ?? "Detached HEAD"}</strong>
        <code>{workspace.head?.slice(0, 12) ?? "No commits"}</code>
      </div>
      <p className="git-path">{withoutVerbatimPrefix(workspace.root)}</p>
      <div className="git-status">
        <span>
          {workspace.files.length === 0
            ? "Working tree clean"
            : `${workspace.files.length} changed ${workspace.files.length === 1 ? "path" : "paths"}`}
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
  allowIsolation = true,
  setupApi,
  agentName = "the agent",
  onAskAgent,
  projectTools,
}: {
  readonly chatId: string;
  readonly title: string;
  readonly api: GitWorkspaceApi;
  readonly live: boolean;
  readonly onStop: () => Promise<void>;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly allowIsolation?: boolean;
  readonly setupApi?: WorktreeSetupApi;
  /** The chat's agent, by name, for a conflicted merge's "Ask … to resolve". */
  readonly agentName?: string;
  /** Sends a visible message to the chat's agent; resolves to null once sent, or why it was not. */
  readonly onAskAgent?: (text: string) => Promise<string | null>;
  /** Detected editors for the chat's folder, for a conflicted merge's "Open in …". */
  readonly projectTools?: Pick<ProjectToolsApi, "review" | "openEditor">;
}) {
  const [workspace, setWorkspace] = useState<GitWorkspace | null>(null);
  const [initialBranch, setInitialBranch] = useState("main");
  const [initialized, setInitialized] = useState(false);
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<WorktreeActionResult | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestResult | null>(null);
  const [prDraft, setPrDraft] = useState<ManagedWorktree | null>(null);
  const [setupTree, setSetupTree] = useState<ManagedWorktree | null>(null);
  const [recreate, setRecreate] = useState<WorktreeRecreatePreview | null>(null);
  const [prTitle, setPrTitle] = useState(title);
  const [prBody, setPrBody] = useState("");
  const [prBase, setPrBase] = useState("");
  const [slug, setSlug] = useState(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 36)
      .replace(/^-+|-+$/g, "") || "work",
  );
  const [message, setMessage] = useState(`Merge ${title || "isolated work"}`);
  const [bringChanges, setBringChanges] = useState(false);
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
        setError((current) => current ?? errorMessage(inspection.reason));
      }
      if (owned.status === "fulfilled") setWorktrees(owned.value);
      else setError((current) => current ?? errorMessage(owned.reason));
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
      const value = await api.isolationPreview(chatId, { slug, bring_changes: bringChanges });
      if (alive.current) {
        setPreview({ type: "isolate", value });
        setResult(null);
      }
    });
  const reviewInitialize = () =>
    run(async () => {
      const value = await api.initializePreview(chatId, initialBranch);
      if (alive.current) setPreview({ type: "initialize", value });
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
        if (chosen.type === "pull_request") {
          const value = await api.pullRequestApply(chatId, chosen.value.token);
          if (alive.current) {
            setPullRequest(value);
            setResult(null);
          }
        } else if (chosen.type === "isolate") {
          const value = await api.isolationApply(chatId, chosen.value.token);
          if (alive.current)
            setResult({
              worktree: value.worktree,
              recovery:
                value.warning ??
                "The isolated worktree is ready. Review moving this chat when you are ready to use it.",
              commit: null,
              error:
                value.worktree.state === "ready"
                  ? null
                  : (value.warning ?? "Review this worktree's recovery state."),
            });
        } else if (chosen.type === "initialize") {
          const value = await api.initializeApply(chatId, chosen.value.token);
          if (alive.current) {
            setWorkspace(value);
            setInitialized(true);
          }
        } else if (chosen.type === "relocate") {
          await api.relocationApply(chatId, chosen.value.token);
          if (alive.current)
            setResult({
              worktree: chosen.value.worktree,
              recovery: `This chat now uses ${chosen.value.to}. Its visible handoff is ready in the composer. Nothing has been sent to the agent.`,
              commit: null,
              error: null,
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
  const reviewRecreate = (tree: ManagedWorktree) =>
    run(async () => {
      const value = await api.recreatePreview(chatId, tree.id);
      if (alive.current) {
        setRecreate(value);
        setResult(null);
      }
    });
  const reviewRelocation = (tree: ManagedWorktree, destination: WorktreeDestination) =>
    run(async () => {
      const value = await api.relocationPreview(chatId, tree.id, destination);
      if (alive.current) {
        setPreview({ type: "relocate", value });
        setResult(null);
      }
    });
  const blocked = busy || loading || live;
  const reviewPullRequest = () =>
    run(async () => {
      if (!prDraft) return;
      const value = await api.pullRequestPreview(chatId, prDraft.id, {
        title: prTitle.trim(),
        body: prBody,
        base_branch: prBase.trim() || null,
      });
      if (alive.current) {
        setPreview({ type: "pull_request", value });
        setPrDraft(null);
        setResult(null);
        setPullRequest(null);
      }
    });
  const conflict = preview?.type === "action" && preview.value.conflicts.length > 0;
  return (
    <Modal
      title="Git workspace"
      size="lg"
      className="git-dialog"
      closeDisabled={busy}
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
              className="g-button"
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
        {initialized ? (
          <p role="status" className="git-note">
            Git is initialized. Existing files remain unstaged. Create the first commit before
            isolation.
          </p>
        ) : null}
        {setupTree ? (
          <WorktreeSetupPanel
            chatId={chatId}
            worktreeId={setupTree.id}
            branch={setupTree.branch}
            api={setupApi}
            onBack={() => setSetupTree(null)}
          />
        ) : preview ? (
          <section className="git-review" aria-label="Review Git operation">
            <h3>
              {preview.type === "initialize"
                ? "Review Git initialization"
                : preview.type === "isolate"
                  ? "Review isolation"
                  : preview.type === "pull_request"
                    ? "Review pull request"
                    : preview.type === "relocate"
                      ? "Review moving this chat"
                      : preview.type === "recovery"
                        ? preview.value.action === "restore"
                          ? "Review restoration"
                          : "Review recovery"
                        : preview.value.action.type === "merge"
                          ? "Review merge"
                          : "Review retirement"}
            </h3>
            {preview.type === "initialize" ? (
              <dl>
                <dt>Folder</dt>
                <dd>{preview.value.folder}</dd>
                <dt>Initial branch</dt>
                <dd>{preview.value.initial_branch}</dd>
                <dt>Changes</dt>
                <dd>Create a new .git directory only</dd>
              </dl>
            ) : preview.type === "pull_request" ? (
              <>
                <dl>
                  <dt>Repository</dt>
                  <dd>{preview.value.repository}</dd>
                  <dt>Branch</dt>
                  <dd>{preview.value.head_branch}</dd>
                  <dt>Commit</dt>
                  <dd>{preview.value.head_commit}</dd>
                  <dt>Base</dt>
                  <dd>{preview.value.base_branch}</dd>
                  <dt>Publish</dt>
                  <dd>
                    {preview.value.will_push
                      ? "Create the remote branch at this commit"
                      : "Use the existing remote commit"}
                  </dd>
                  <dt>Title</dt>
                  <dd>{preview.value.title}</dd>
                </dl>
                <h4>Description</h4>
                <pre>{preview.value.body || "No description."}</pre>
                <h4>Committed changes</h4>
                <pre>{preview.value.diff_stat}</pre>
                {preview.value.existing_url ? (
                  <p>A matching pull request already exists. Confirmation returns its link.</p>
                ) : null}
              </>
            ) : preview.type === "isolate" ? (
              <dl>
                <dt>Branch</dt>
                <dd>{preview.value.branch}</dd>
                <dt>New folder</dt>
                <dd>{preview.value.path}</dd>
                <dt>Starting commit</dt>
                <dd>{preview.value.source.head}</dd>
                <dt>Working files</dt>
                <dd>
                  {preview.value.bring_changes
                    ? "Copy reviewed changes as unstaged files"
                    : "Start from the commit"}
                </dd>
              </dl>
            ) : preview.type === "relocate" ? (
              <>
                <dl>
                  <dt>Current folder</dt>
                  <dd>{preview.value.from}</dd>
                  <dt>Destination</dt>
                  <dd>{preview.value.to}</dd>
                </dl>
                <h4>Context for your next prompt</h4>
                <pre>{preview.value.handoff}</pre>
                <p className="git-note">
                  Your history stays in this chat. This move does not send a prompt.
                </p>
              </>
            ) : preview.type === "recovery" ? (
              <dl>
                <dt>Worktree</dt>
                <dd>{preview.value.worktree.branch}</dd>
                <dt>Current folder</dt>
                <dd>{withoutVerbatimPrefix(preview.value.folder.root)}</dd>
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
                  <dd>{withoutVerbatimPrefix(preview.value.worktree.path)}</dd>
                  {preview.value.target ? (
                    <>
                      <dt>Target branch</dt>
                      <dd>{preview.value.target.branch}</dd>
                      <dt>Target folder</dt>
                      <dd>{withoutVerbatimPrefix(preview.value.target.root)}</dd>
                    </>
                  ) : null}
                </dl>
                <pre>{preview.value.changes || "No file changes."}</pre>
                {preview.value.conflicts.length > 0 ? (
                  <MergeConflicts
                    chatId={chatId}
                    preview={preview.value}
                    inWorktree={
                      workspace !== null && sameFolder(workspace.root, preview.value.worktree.path)
                    }
                    agentName={agentName}
                    onAskAgent={onAskAgent}
                    projectTools={projectTools}
                  />
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
                className="g-button"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="g-button g-button-primary"
                disabled={blocked || conflict}
                onClick={() => void apply()}
              >
                {preview.type === "initialize"
                  ? "Initialize reviewed folder"
                  : preview.type === "isolate"
                    ? "Create isolated workspace"
                    : preview.type === "pull_request"
                      ? preview.value.existing_url
                        ? "Use existing pull request"
                        : "Publish reviewed pull request"
                      : preview.type === "relocate"
                        ? "Move chat to reviewed folder"
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
            {!workspace && !loading ? (
              <section className="git-section">
                <h3>Initialize a repository</h3>
                <p>
                  For a folder without Git, review creating its repository metadata. Existing files
                  are not staged or committed.
                </p>
                <label className="ui-field">
                  Initial branch
                  <input
                    className="g-input"
                    value={initialBranch}
                    maxLength={128}
                    disabled={busy}
                    onChange={(event) => setInitialBranch(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  className="g-button"
                  disabled={blocked || !initialBranch.trim()}
                  onClick={() => void reviewInitialize()}
                >
                  Review Git initialization
                </button>
              </section>
            ) : null}
            {allowIsolation && workspace ? (
              <section className="git-section">
                <h3>Create an isolated workspace</h3>
                <p>
                  Work on a separate branch and folder. The source folder and its uncommitted
                  changes stay in place. Then review moving this chat into it.
                </p>
                <label className="ui-field">
                  Branch name
                  <input
                    className="g-input"
                    value={slug}
                    maxLength={36}
                    onChange={(event) => setSlug(event.currentTarget.value)}
                    disabled={busy}
                  />
                </label>
                <label className="git-copy-option">
                  <input
                    type="checkbox"
                    checked={bringChanges}
                    onChange={(event) => setBringChanges(event.currentTarget.checked)}
                    disabled={busy}
                  />
                  <span>
                    Bring uncommitted changes
                    <small>
                      Copy your working files. Keep the source folder and its staged changes intact.
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  className="g-button"
                  disabled={blocked || !slug.trim() || workspace.blockers.length > 0}
                  onClick={() => void reviewIsolation()}
                >
                  Review isolation
                </button>
              </section>
            ) : null}
            {prDraft ? (
              <form
                className="git-section"
                aria-label="Prepare pull request"
                onSubmit={(event) => {
                  event.preventDefault();
                  void reviewPullRequest();
                }}
              >
                <h3>Prepare pull request</h3>
                <p>
                  {prDraft.branch}. Commit the intended work first. The next step reviews the exact
                  repository and committed changes.
                </p>
                <label className="ui-field">
                  Pull request title
                  <input
                    className="g-input"
                    value={prTitle}
                    maxLength={256}
                    required
                    disabled={busy}
                    onChange={(event) => setPrTitle(event.currentTarget.value)}
                  />
                </label>
                <label className="ui-field">
                  Description
                  <textarea
                    className="g-textarea git-pr-body"
                    value={prBody}
                    maxLength={65536}
                    disabled={busy}
                    onChange={(event) => setPrBody(event.currentTarget.value)}
                  />
                </label>
                <label className="ui-field">
                  Base branch
                  <input
                    className="g-input"
                    placeholder="Repository default"
                    value={prBase}
                    maxLength={200}
                    disabled={busy}
                    onChange={(event) => setPrBase(event.currentTarget.value)}
                  />
                </label>
                <div className="git-actions">
                  <button
                    className="g-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setPrDraft(null)}
                  >
                    Cancel preparation
                  </button>
                  <button className="g-button" type="submit" disabled={blocked || !prTitle.trim()}>
                    Review pull request
                  </button>
                </div>
              </form>
            ) : null}
            {worktrees.length ? (
              <section className="git-section">
                <h3>Owned worktrees</h3>
                <label className="ui-field">
                  Merge message
                  <input
                    className="g-input"
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
                            className="g-button"
                            disabled={blocked}
                            onClick={() => void reviewRecovery(tree, "restore")}
                          >
                            Review restoration
                          </button>
                        </div>
                      ) : null}
                      {[
                        "creating",
                        "merging",
                        "retiring",
                        "restoring",
                        "recovery_required",
                        "missing",
                      ].includes(tree.state) ? (
                        <div className="git-actions">
                          {tree.state === "missing" ? (
                            // Only the two owned paths are reserved, so a running chat elsewhere
                            // does not block bringing the deleted folder back.
                            <button
                              type="button"
                              className="g-button"
                              disabled={busy || loading}
                              onClick={() => void reviewRecreate(tree)}
                            >
                              Recreate folder
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="g-button"
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
                            className="g-button"
                            type="button"
                            disabled={blocked}
                            onClick={() => {
                              setSetupTree(tree);
                              setPrDraft(null);
                            }}
                          >
                            Configure setup
                          </button>
                          <button
                            className="g-button"
                            type="button"
                            disabled={blocked || prDraft !== null}
                            onClick={() => {
                              setPrDraft(tree);
                              setPullRequest(null);
                            }}
                          >
                            Prepare pull request
                          </button>
                          {workspace &&
                          (sameFolder(workspace.root, tree.source) ||
                            sameFolder(workspace.root, tree.path)) ? (
                            <button
                              type="button"
                              className="g-button"
                              disabled={blocked}
                              onClick={() =>
                                void reviewRelocation(
                                  tree,
                                  sameFolder(workspace.root, tree.path) ? "direct" : "isolated",
                                )
                              }
                            >
                              {sameFolder(workspace.root, tree.path)
                                ? "Review return to project folder"
                                : "Review moving this chat"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="g-button"
                            disabled={blocked || !message.trim()}
                            onClick={() => void reviewAction(tree, "merge")}
                          >
                            Review merge
                          </button>
                          <button
                            type="button"
                            className="g-button"
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
        {pullRequest ? (
          <section className="git-result" aria-label="Pull request result">
            <h3>{pullRequest.created ? "Pull request created" : "Pull request ready"}</h3>
            <a href={pullRequest.url} rel="noreferrer">
              Open on GitHub
            </a>
            <p className="git-path">{pullRequest.head_commit}</p>
            {pullRequest.warning ? (
              <p className="git-warning" role="status">
                {pullRequest.warning}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      <footer className="git-footer">
        <span role="status">
          {busy ? "Finishing Git operation…" : "Your index is checked again before changes apply."}
        </span>
        <button
          type="button"
          className="g-button"
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
      {recreate ? (
        <RecreateWorktreeDialog
          chatId={chatId}
          review={recreate}
          api={api}
          onClose={() => setRecreate(null)}
          onDone={(value) => {
            setRecreate(null);
            if (!alive.current) return;
            setResult(
              value.error
                ? value
                : {
                    ...value,
                    recovery: `The folder is back on ${value.worktree.branch} at its last commit. Uncommitted files from the deleted folder could not be restored.`,
                  },
            );
            onChanged();
            setRevision((current) => current + 1);
          }}
        />
      ) : null}
    </Modal>
  );
}
