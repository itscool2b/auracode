import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryProposal, MemoryRevision, ProjectMemory, SetupSnapshot } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import {
  AGENT_SOURCE,
  adoptsSaved,
  MAX_MEMORY_BYTES,
  type MemoryChats,
  memoryBytes,
  NO_CHATS,
  newerVersion,
  type ProjectMemoryApi,
  previousText,
  projectMemoryApi,
  proposalIsCurrent,
  restoreReason,
  revisionAuthor,
  revisionTime,
} from "../../lib/projectMemory";
import { type SetupApi, setupApi } from "../../lib/setup";
import { DiffBlock } from "../chat/DiffBlock";
import { Modal } from "../chat/Modal";
import { Row, Switch } from "./SettingsRow";
import "./settings.css";
import "./project-memory.css";

type Project = { readonly id: string; readonly name: string };
/** A save that met newer memory: the person's draft, or a revision they asked to restore. */
type Conflict = { readonly latest: ProjectMemory; readonly restore?: MemoryRevision };

const SAVED = "Project memory saved. Agents receive this revision from their next real message.";
const RESTORED = "Revision restored. Agents receive it from their next real message.";

export function ProjectMemoryPanel({
  projects,
  initialProjectId,
  initialRevision,
  api = projectMemoryApi,
  setup = setupApi,
  chats = NO_CHATS,
  titled = true,
}: {
  readonly projects: readonly Project[];
  readonly initialProjectId?: string;
  /** A revision to open with its changes once history arrives, as an agent edit's Review asks. */
  readonly initialRevision?: string;
  readonly api?: ProjectMemoryApi;
  /** The profile's preferences, for the switch that lets agents edit memory directly. */
  readonly setup?: SetupApi;
  /** The chats agents' revisions name. */
  readonly chats?: MemoryChats;
  /** Settings names the page itself: the panel then keeps only its description. */
  readonly titled?: boolean;
}) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  // The revision the editor edits against, and the newest one read since.
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [saved, setSaved] = useState<ProjectMemory | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<MemoryRevision[]>([]);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [review, setReview] = useState<MemoryProposal | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [historic, setHistoric] = useState<MemoryRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  // The profile's switch for agents' direct edits; on until read, as Rust's default is.
  const [preferences, setPreferences] = useState<SetupSnapshot | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const direct = preferences?.preferences.general.agent_memory_writes ?? true;
  const sequence = useRef(0);
  const refreshes = useRef(0);
  const bytes = memoryBytes(markdown);
  const dirty = memory !== null && markdown !== memory.markdown;
  const newer = newerVersion(memory, saved, markdown);
  useEffect(() => {
    let live = true;
    setup.snapshot().then(
      (next) => {
        if (live) setPreferences(next);
      },
      (failure) => {
        if (live) setPolicyError(errorMessage(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [setup]);
  const setDirect = async (enabled: boolean) => {
    if (!preferences || savingPolicy) return;
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      setPreferences(
        await setup.apply(preferences.preferences.revision, {
          type: "agent_memory_writes",
          enabled,
        }),
      );
    } catch (failure) {
      // Another page may have saved a preference since this one read them: read and try again.
      try {
        const fresh = await setup.snapshot();
        setPreferences(
          fresh.preferences.general.agent_memory_writes === enabled
            ? fresh
            : await setup.apply(fresh.preferences.revision, {
                type: "agent_memory_writes",
                enabled,
              }),
        );
      } catch {
        setPolicyError(errorMessage(failure));
      }
    } finally {
      setSavingPolicy(false);
    }
  };
  const load = useCallback(async () => {
    const current = ++sequence.current;
    if (!projectId) {
      setMemory(null);
      setSaved(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [next, revisions, pending] = await Promise.all([
        api.read(projectId),
        api.history(projectId),
        api.proposals(projectId),
      ]);
      if (current !== sequence.current) return;
      setMemory(next);
      setSaved(next);
      setMarkdown(next.markdown);
      setHistory(revisions);
      setProposals(pending);
      setReason("");
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure));
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }, [api, projectId]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  // Memory another writer changed (an agent, another device): read it without touching the draft
  // or the busy state, and never after a newer full read.
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const generation = sequence.current;
    const mine = ++refreshes.current;
    try {
      const [next, revisions, pending] = await Promise.all([
        api.read(projectId),
        api.history(projectId),
        api.proposals(projectId),
      ]);
      if (generation !== sequence.current || mine !== refreshes.current) return;
      setSaved(next);
      setHistory(revisions);
      setProposals(pending);
    } catch {
      // What is shown stays; Refresh reports a failure.
    }
  }, [api, projectId]);
  useEffect(
    () =>
      api.subscribe((change) => {
        if (change.project_id === null || change.project_id === projectId) void refresh();
      }),
    [api, projectId, refresh],
  );
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [refresh]);
  // An editor without a draft shows the newer version at once; a draft keeps its base, and the
  // notice below offers the comparison instead.
  useEffect(() => {
    if (saved && memory === null && saved.project_id === projectId) {
      setMemory(saved);
      setMarkdown(saved.markdown);
      setError(null);
    } else if (adoptsSaved(memory, saved, markdown) && saved) {
      setMemory(saved);
      setMarkdown(saved.markdown);
    }
  }, [saved, memory, markdown, projectId]);
  const opened = useRef(false);
  useEffect(() => {
    if (!initialRevision || opened.current) return;
    const revision = history.find((entry) => entry.revision === initialRevision);
    if (revision) {
      opened.current = true;
      setHistoric(revision);
    }
  }, [history, initialRevision]);
  async function mutate(
    action: () => Promise<unknown>,
    message: string,
    restoring?: MemoryRevision,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setReview(null);
      setImportText(null);
      setHistoric(null);
      await load();
      setNotice(message);
    } catch (failure) {
      setError(errorMessage(failure));
      if (memory && (dirty || restoring)) {
        try {
          const latest = await api.read(projectId);
          if (latest.revision !== memory.revision) {
            setSaved(latest);
            setConflict({ latest, restore: restoring });
          }
        } catch {
          /* Keep the local edit and original error available. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const restore = (revision: MemoryRevision, base: ProjectMemory) =>
    void mutate(
      () =>
        api.save({
          project_id: projectId,
          expected_revision: base.revision,
          markdown: revision.markdown,
          reason: restoreReason(revision),
        }),
      RESTORED,
      revision,
    );
  const pending = proposals.filter(
    (proposal) => proposal.state === "pending" || proposal.state === "conflict",
  );
  const author = (revision: MemoryRevision) => revisionAuthor(revision.source, chats);
  const newerRevision = newer
    ? history.find((revision) => revision.revision === newer.revision)
    : undefined;
  // The revision a viewed one replaced: restoring it undoes the viewed edit.
  const historicParent = historic
    ? history.find((entry) => entry.revision === historic.parent_revision)
    : undefined;
  return (
    <section className="project-memory" aria-label="Project memory">
      <div className="settings-section-heading">
        {titled ? <h2>Project memory</h2> : null}
        <p>
          One Markdown memory for every folder and worktree in a project. Agents see the current
          revision as reference context on the first real message of each session and after memory
          changes. Your request and instruction files take precedence.
        </p>
      </div>
      <div className="settings-group">
        <Row
          title="Let agents edit memory directly"
          detail={
            direct
              ? "Agents save their edits as new revisions, in every project. Review or restore any revision below."
              : "Agents can only propose edits. Nothing changes until you accept one."
          }
        >
          <Switch
            label="Let agents edit memory directly"
            testId="project-memory-direct"
            checked={direct}
            disabled={!preferences || savingPolicy}
            onChange={(enabled) => void setDirect(enabled)}
          />
        </Row>
      </div>
      {policyError ? (
        <p role="alert" className="project-memory-error">
          {policyError}
        </p>
      ) : null}
      <label className="project-memory-field">
        Project
        <select
          value={projectId}
          disabled={busy || dirty}
          onChange={(event) => {
            setProjectId(event.currentTarget.value);
            setNotice(null);
          }}
        >
          <option value="" disabled>
            Choose a project
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {!projects.length ? <p>Create a project to keep shared project memory.</p> : null}
      <p className="project-memory-note">
        Agents read and edit memory through Aura's memory tools on connections that support them.
        Native agent memory and instruction files stay separate. Account memory uses encrypted
        storage and sync; authentication stays on this device.
      </p>
      {error ? (
        <p role="alert" className="project-memory-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {newer ? (
        <div className="chat-banner project-memory-newer" role="status">
          <span>
            {newerRevision ? `${author(newerRevision)} saved` : "Someone saved"} a newer version
            while you were editing. Your draft is kept; compare them before saving.
          </span>
          <button
            type="button"
            className="g-button g-button-28"
            onClick={() => setConflict({ latest: newer })}
          >
            Compare
          </button>
        </div>
      ) : null}
      {memory ? (
        <>
          <label className="project-memory-field">
            Markdown
            <textarea
              spellCheck={false}
              value={markdown}
              disabled={busy}
              onChange={(event) => setMarkdown(event.currentTarget.value)}
              aria-describedby="memory-size"
              rows={14}
            />
          </label>
          <div id="memory-size" className="project-memory-meta">
            {bytes.toLocaleString()} / {MAX_MEMORY_BYTES.toLocaleString()} UTF-8 bytes.{" "}
            {memory.revision ? `Revision ${memory.revision}` : "No saved revision."}
          </div>
          <label className="project-memory-field">
            Reason for this edit
            <input
              value={reason}
              maxLength={2048}
              disabled={busy}
              onChange={(event) => setReason(event.currentTarget.value)}
              placeholder="What should future chats remember?"
            />
          </label>
          <div className="project-memory-actions">
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy || !dirty || !reason.trim() || bytes > MAX_MEMORY_BYTES}
              onClick={() =>
                void mutate(
                  () =>
                    api.save({
                      project_id: projectId,
                      expected_revision: memory.revision,
                      markdown,
                      reason,
                    }),
                  SAVED,
                )
              }
            >
              Save memory
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy || !dirty}
              onClick={() => {
                setMarkdown(memory.markdown);
                setReason("");
              }}
            >
              Discard edit
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy || dirty}
              onClick={() => void load()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy || dirty}
              onClick={() => {
                setError(null);
                void api
                  .export(projectId)
                  .then((bundle) => setExportText(JSON.stringify(bundle, null, 2)))
                  .catch((failure: unknown) => setError(errorMessage(failure)));
              }}
            >
              Export
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy || dirty}
              onClick={() => setImportText("")}
            >
              Import
            </button>
          </div>
          {!direct || pending.length ? (
            <>
              <h3>Proposals ({pending.length})</h3>
              {!pending.length ? (
                <p className="project-memory-meta">No updates waiting for your review.</p>
              ) : (
                <ul className="project-memory-list">
                  {pending.map((proposal) => (
                    <li key={proposal.id}>
                      <div>
                        <strong>{proposal.reason}</strong>
                        <p>
                          {proposal.chat_id
                            ? revisionAuthor(`${AGENT_SOURCE}${proposal.chat_id}`, chats)
                            : "Synced revision"}{" "}
                          ·{" "}
                          {proposalIsCurrent(proposal, memory)
                            ? "Ready to review"
                            : "Base revision changed. Review and edit before saving."}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="g-button"
                        disabled={busy || dirty}
                        onClick={() => setReview(proposal)}
                      >
                        Review
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
          <h3>Revision history</h3>
          {!history.length ? (
            <p className="project-memory-meta">Saved edits will appear here.</p>
          ) : (
            <ul className="project-memory-list">
              {history.map((revision) => (
                <li
                  key={revision.revision}
                  data-source={revision.source.startsWith(AGENT_SOURCE) ? "agent" : revision.source}
                >
                  <div>
                    <strong>{revision.reason}</strong>
                    <p>
                      {revisionTime(revision)} · {author(revision)}
                      {revision.revision === memory.revision ? " · Current" : ""}
                    </p>
                  </div>
                  <div className="project-memory-row-actions">
                    <button
                      type="button"
                      className="g-button"
                      disabled={busy}
                      onClick={() => setHistoric(revision)}
                    >
                      View revision
                    </button>
                    <button
                      type="button"
                      className="g-button"
                      aria-label={`Restore the revision from ${revisionTime(revision)}`}
                      disabled={busy || dirty || revision.markdown === memory.markdown}
                      onClick={() => restore(revision, memory)}
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : busy ? (
        <p role="status">Loading project memory...</p>
      ) : null}
      {conflict?.restore ? (
        <Modal
          size="lg"
          closeDisabled={busy}
          title="Memory changed before the restore"
          onClose={() => {
            if (!busy) setConflict(null);
          }}
        >
          <p>
            Nothing was restored. Memory changed after this page read it. Compare the latest memory
            with the revision you chose before restoring it.
          </p>
          <div className="project-memory-comparison">
            <div>
              <h3>Latest memory</h3>
              <pre>{conflict.latest.markdown || "(Empty)"}</pre>
            </div>
            <div>
              <h3>Revision to restore</h3>
              <pre>{conflict.restore.markdown || "(Empty)"}</pre>
            </div>
          </div>
          <div className="g-dialog-actions">
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => {
                setConflict(null);
                setError(null);
                void load();
              }}
            >
              Keep the latest
            </button>
            <button
              type="button"
              className="g-button g-button-primary"
              disabled={busy}
              onClick={() => {
                const { latest, restore: chosen } = conflict;
                if (!chosen) return;
                setConflict(null);
                restore(chosen, latest);
              }}
            >
              Restore it anyway
            </button>
          </div>
        </Modal>
      ) : conflict ? (
        <Modal size="lg" title="Review concurrent memory edit" onClose={() => setConflict(null)}>
          <p>
            Memory changed while you were editing. Your draft is preserved. Review the latest
            revision before saving another edit.
          </p>
          <div className="project-memory-comparison">
            <div>
              <h3>Latest memory</h3>
              <pre>{conflict.latest.markdown || "(Empty)"}</pre>
            </div>
            <div>
              <h3>Your draft</h3>
              <pre>{markdown || "(Empty)"}</pre>
            </div>
          </div>
          <button
            type="button"
            className="g-button g-button-primary"
            onClick={() => {
              setMemory(conflict.latest);
              setConflict(null);
              setError(null);
            }}
          >
            Keep editing against this revision
          </button>
        </Modal>
      ) : null}
      {review && memory ? (
        <Modal
          size="lg"
          closeDisabled={busy}
          title="Review project memory proposal"
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>{review.reason}</p>
          <div className="project-memory-comparison">
            <div>
              <h3>Current memory</h3>
              <pre>{memory.markdown || "(Empty)"}</pre>
            </div>
            <div>
              <h3>Proposed memory</h3>
              <pre>{review.markdown || "(Empty)"}</pre>
            </div>
          </div>
          {!proposalIsCurrent(review, memory) ? (
            <p>
              This proposal's base differs from the current revision. Load it into the editor,
              reconcile the changes, and save against the current revision.
            </p>
          ) : null}
          <div className="project-memory-actions">
            <button
              type="button"
              className="g-button primary"
              disabled={busy || !proposalIsCurrent(review, memory)}
              onClick={() =>
                void mutate(
                  () =>
                    api.accept({
                      project_id: projectId,
                      proposal_id: review.id,
                      expected_revision: memory.revision,
                    }),
                  "Proposal accepted.",
                )
              }
            >
              Accept exact proposal
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() => {
                setMarkdown(review.markdown);
                setReason(`Reviewed proposal: ${review.reason}`);
                setReview(null);
              }}
            >
              Edit proposal
            </button>
            <button
              type="button"
              className="g-button"
              disabled={busy}
              onClick={() =>
                void mutate(() => api.reject(projectId, review.id), "Proposal rejected.")
              }
            >
              Reject
            </button>
          </div>
        </Modal>
      ) : null}
      {historic ? (
        <Modal size="lg" title="Memory revision" onClose={() => setHistoric(null)}>
          <p>{historic.reason}</p>
          <p className="project-memory-meta">
            {revisionTime(historic)} · {author(historic)} ·{" "}
            <span className="settings-mono">{historic.revision}</span>
          </p>
          <DiffBlock
            path="Project memory"
            oldText={previousText(historic, history)}
            newText={historic.markdown}
            disclosureKey={`memory:${historic.revision}`}
            wholeFile
            copyPath={false}
          />
          {memory && historic.revision === memory.revision ? (
            // The current revision: restoring what it replaced undoes it.
            historicParent && historicParent.markdown !== memory.markdown ? (
              <div className="g-dialog-actions">
                <button
                  type="button"
                  className="g-button g-button-primary"
                  disabled={busy || dirty}
                  onClick={() => restore(historicParent, memory)}
                >
                  Restore the revision before it
                </button>
              </div>
            ) : null
          ) : memory && historic.markdown !== memory.markdown ? (
            <div className="g-dialog-actions">
              <button
                type="button"
                className="g-button"
                disabled={busy || dirty}
                onClick={() => {
                  setMarkdown(historic.markdown);
                  setReason(restoreReason(historic));
                  setHistoric(null);
                }}
              >
                Use as a new edit
              </button>
              <button
                type="button"
                className="g-button g-button-primary"
                disabled={busy || dirty}
                onClick={() => restore(historic, memory)}
              >
                Restore this revision
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}
      {importText !== null && memory ? (
        <Modal
          size="lg"
          closeDisabled={busy}
          title="Import project memory"
          onClose={() => {
            if (!busy) setImportText(null);
          }}
        >
          <p>
            Paste Markdown or an Aura memory export. Import creates a new reviewed revision in this
            project. Exported proposals and history remain in the export for reference.
          </p>
          <label className="project-memory-field">
            Import content
            <textarea
              rows={12}
              value={importText}
              onChange={(event) => setImportText(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            className="g-button primary"
            disabled={busy || !importText.trim()}
            onClick={() => {
              try {
                const parsed: unknown = JSON.parse(importText);
                if (
                  !parsed ||
                  typeof parsed !== "object" ||
                  !("current" in parsed) ||
                  typeof parsed.current !== "object" ||
                  parsed.current === null ||
                  !("markdown" in parsed.current) ||
                  typeof parsed.current.markdown !== "string"
                )
                  throw new Error("This export has no Markdown memory.");
                setMarkdown(parsed.current.markdown);
              } catch {
                setMarkdown(importText);
              }
              setReason("Imported reviewed Markdown");
              setImportText(null);
            }}
          >
            Review in editor
          </button>
        </Modal>
      ) : null}
      {exportText !== null ? (
        <Modal size="lg" title="Export project memory" onClose={() => setExportText(null)}>
          <p>
            This export contains project memory, history and proposals. Save it only where you
            intend to share this content.
          </p>
          <label className="project-memory-field">
            Memory export
            <textarea
              readOnly
              rows={16}
              value={exportText}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            type="button"
            className="g-button"
            onClick={() => {
              const file = new Blob([exportText], { type: "application/json" });
              const url = URL.createObjectURL(file);
              const link = document.createElement("a");
              link.href = url;
              link.download = `aura-project-memory-${projectId}.json`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Save export
          </button>
        </Modal>
      ) : null}
    </section>
  );
}
