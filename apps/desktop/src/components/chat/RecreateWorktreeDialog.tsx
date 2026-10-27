import { useRef, useState } from "react";
import type { WorktreeActionResult, WorktreeRecreatePreview } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import type { GitWorkspaceApi } from "../../lib/gitWorkspace";
import { Modal } from "./Modal";

/** The sentence a recreate review leads with: what is lost and what is kept, in Rust's words. */
export function recreateLead(review: WorktreeRecreatePreview): {
  readonly lead: string;
  readonly rest: readonly string[];
} {
  const index = review.warnings.findIndex((warning) => /uncommitted/i.test(warning));
  const at = Math.max(0, index);
  return {
    lead:
      review.warnings[at] ??
      "Uncommitted files that were in the deleted folder are gone. Everything committed on the branch is kept.",
    rest: review.warnings.filter((_, position) => position !== at),
  };
}

/**
 * Recreates a worktree folder that was deleted outside the app (Vercel's transfer dialog, in
 * Graphite dark): the question, one sentence on what comes back and what does not, the branch,
 * commit and folder as rows on hairlines, then Cancel and the one primary. A refused or expired
 * review is reviewed again, so the next try applies a fresh one.
 */
export function RecreateWorktreeDialog({
  chatId,
  review: initial,
  api,
  onClose,
  onDone,
}: {
  readonly chatId: string;
  readonly review: WorktreeRecreatePreview;
  readonly api: Pick<GitWorkspaceApi, "recreatePreview" | "recreateApply">;
  readonly onClose: () => void;
  readonly onDone: (result: WorktreeActionResult) => void;
}) {
  const [review, setReview] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acting = useRef(false);
  const { lead, rest } = recreateLead(review);
  const recreate = async () => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.recreateApply(chatId, review.worktree.id, review.token));
    } catch (failure) {
      setError(errorMessage(failure));
      try {
        setReview(await api.recreatePreview(chatId, review.worktree.id));
      } catch {
        // The refusal above already says what to do; the old review stays on screen.
      }
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Recreate the deleted folder?"
      className="git-recreate"
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="git-recreate-lead">{lead}</p>
      <dl className="git-recreate-rows">
        <dt>Branch</dt>
        <dd>
          <code>{review.branch}</code>
        </dd>
        <dt>Commit</dt>
        <dd>
          <code title={review.commit}>{review.commit.slice(0, 12)}</code>
        </dd>
        <dt>Folder</dt>
        <dd>
          <code>{review.path}</code>
        </dd>
      </dl>
      {rest.map((warning) => (
        <p className="git-recreate-note" key={warning}>
          {warning}
        </p>
      ))}
      {error ? (
        <p className="git-recreate-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="g-dialog-actions git-recreate-actions">
        <button type="button" className="g-button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="g-button g-button-primary"
          disabled={busy}
          onClick={() => void recreate()}
        >
          {busy ? "Recreating…" : "Recreate folder"}
        </button>
      </div>
    </Modal>
  );
}
