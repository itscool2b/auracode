import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryProposal, MemoryRevision, ProjectMemory } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import {
  MAX_MEMORY_BYTES,
  memoryBytes,
  type ProjectMemoryApi,
  projectMemoryApi,
  proposalIsCurrent,
} from "../../lib/projectMemory";
import { Modal } from "../chat/Modal";
import "./project-memory.css";

type Project = { readonly id: string; readonly name: string };
export function ProjectMemoryPanel({
  projects,
  initialProjectId,
  api = projectMemoryApi,
}: {
  readonly projects: readonly Project[];
  readonly initialProjectId?: string;
  readonly api?: ProjectMemoryApi;
}) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<MemoryRevision[]>([]);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [review, setReview] = useState<MemoryProposal | null>(null);
  const [conflict, setConflict] = useState<ProjectMemory | null>(null);
  const [historic, setHistoric] = useState<MemoryRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const sequence = useRef(0);
  const bytes = memoryBytes(markdown);
  const dirty = memory !== null && markdown !== memory.markdown;
  const load = useCallback(async () => {
    const current = ++sequence.current;
    if (!projectId) {
      setMemory(null);
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
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setReview(null);
      setImportText(null);
      await load();
      setNotice(message);
    } catch (failure) {
      setError(errorMessage(failure));
      if (memory && dirty) {
        try {
          const latest = await api.read(projectId);
          if (latest.revision !== memory.revision) setConflict(latest);
        } catch {
          /* Keep the local edit and original error available. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const pending = proposals.filter(
    (proposal) => proposal.state === "pending" || proposal.state === "conflict",
  );
  return (
    <section className="project-memory" aria-label="Project memory">
      <div className="settings-section-heading">
        <h2>Project memory</h2>
        <p>
          One Markdown memory for every folder and worktree in a project. Accepted revisions are
          visible reference context on the first real message of each agent session and after memory
          changes. Your request and instruction files take precedence.
        </p>
      </div>
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
        Agents can read memory and propose updates through Aura when the local helper is available.
        Only you can accept an update. Native agent memory and instruction files stay separate.
        Account memory uses encrypted storage and sync; authentication stays on this device.
      </p>
      {error ? (
        <p role="alert" className="project-memory-error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
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
                  "Project memory saved. Future real messages receive the accepted revision.",
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
                      {proposal.chat_id ? `Chat ${proposal.chat_id}` : "Synced revision"} ·{" "}
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
          <h3>Revision history</h3>
          {!history.length ? (
            <p className="project-memory-meta">Saved edits will appear here.</p>
          ) : (
            <ul className="project-memory-list">
              {history.map((revision) => (
                <li key={revision.revision}>
                  <div>
                    <strong>{revision.reason}</strong>
                    <p>
                      {new Date(revision.created_at).toLocaleString()} · {revision.source}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="g-button"
                    disabled={busy}
                    onClick={() => setHistoric(revision)}
                  >
                    View revision
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : busy ? (
        <p role="status">Loading project memory...</p>
      ) : null}
      {conflict ? (
        <Modal size="lg" title="Review concurrent memory edit" onClose={() => setConflict(null)}>
          <p>
            Memory changed while you were editing. Your draft is preserved. Review the accepted
            revision before saving another edit.
          </p>
          <div className="project-memory-comparison">
            <div>
              <h3>Latest accepted memory</h3>
              <pre>{conflict.markdown || "(Empty)"}</pre>
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
              setMemory(conflict);
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
              This proposal's base differs from the accepted revision. Load it into the editor,
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
          <p className="project-memory-meta">{historic.revision}</p>
          <pre className="project-memory-document">{historic.markdown || "(Empty)"}</pre>
          <button
            type="button"
            className="g-button"
            disabled={busy || dirty}
            onClick={() => {
              setMarkdown(historic.markdown);
              setReason(`Restore revision ${historic.revision}`);
              setHistoric(null);
            }}
          >
            Use as a new edit
          </button>
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
