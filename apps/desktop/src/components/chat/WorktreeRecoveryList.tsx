import { useState } from "react";
import type {
  ManagedWorktree,
  WorktreeRecoveryPreview,
  WorktreeRecreatePreview,
} from "../../bindings";
import { errorMessage } from "../../lib/errors";
import { withoutVerbatimPrefix } from "../../lib/gitWorkspace";
import type { WorktreeRecoveryApi } from "../../lib/worktreeRecovery";

export function WorktreeRecoveryList({
  records,
  api,
  onChanged,
}: {
  readonly records: readonly ManagedWorktree[];
  readonly api: WorktreeRecoveryApi;
  readonly onChanged: () => void;
}) {
  const [review, setReview] = useState<{
    value: WorktreeRecoveryPreview | WorktreeRecreatePreview;
    recreate: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
      setReview(null);
    } finally {
      setBusy(false);
    }
  };
  if (!records.length) return null;
  return (
    <section className="new-chat-more" aria-label="Retained worktrees">
      <h2>Retained worktrees</h2>
      <p>Review worktrees whose chat could not be saved or whose operation needs recovery.</p>
      {error ? (
        <p role="alert" className="ui-error">
          {error}
        </p>
      ) : null}
      <ul className="git-files">
        {records.map((record) => (
          <li key={record.id}>
            <div>
              <strong>{record.branch}</strong>
              <p>
                Source: <code>{withoutVerbatimPrefix(record.source)}</code>
              </p>
              <p>
                Retained folder: <code>{withoutVerbatimPrefix(record.path)}</code>
              </p>
              <p>
                {record.detail ??
                  (record.state === "ready"
                    ? "The worktree is reconciled and retained without a saved chat."
                    : `State: ${record.state.replaceAll("_", " ")}`)}
              </p>
              {record.state !== "ready" ? (
                <button
                  type="button"
                  className="g-button g-button-28"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const recreate = record.state === "missing";
                      const value = recreate
                        ? await api.recreate(record.id)
                        : await api.preview(
                            record.id,
                            record.state === "retired" ? "restore" : "reconcile",
                          );
                      setReview({ value, recreate });
                    })
                  }
                >
                  {record.state === "missing"
                    ? "Review recreation"
                    : record.state === "retired"
                      ? "Review restore"
                      : "Review recovery"}
                </button>
              ) : null}
              <button
                type="button"
                className="g-button g-button-ghost g-button-28"
                disabled={busy}
                onClick={() => void run(() => api.open(record.id))}
              >
                Open folder
              </button>
            </div>
          </li>
        ))}
      </ul>
      {review ? (
        <section className="git-review" aria-label="Review retained worktree recovery">
          <h3>{review.value.worktree.branch}</h3>
          <p>{"destination" in review.value ? review.value.destination : review.value.path}</p>
          {review.value.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <button
            type="button"
            className="g-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api.apply(
                  review.value.worktree.id,
                  review.value.token,
                  review.recreate,
                );
                setReview(null);
                onChanged();
                if (result.error) setError(result.error);
              })
            }
          >
            Apply reviewed recovery
          </button>
          <button
            type="button"
            className="g-button g-button-ghost"
            disabled={busy}
            onClick={() => setReview(null)}
          >
            Cancel
          </button>
        </section>
      ) : null}
    </section>
  );
}
