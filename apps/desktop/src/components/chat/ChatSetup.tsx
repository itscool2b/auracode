import { useEffect, useRef, useState } from "react";
import type { WorktreeSetupAttempt, WorktreeSetupPreview } from "../../bindings";
import { errorMessage } from "../../lib/errors";
import type { TerminalPanels } from "../../lib/terminalPanel";
import type { WorktreeSetupApi } from "../../lib/worktreeSetup";

/** Setup admission is durable in Rust. Closing or hiding this view never releases the queue. */
export function ChatSetup({
  chatId,
  attempt,
  api,
  terminals,
}: {
  readonly chatId: string;
  readonly attempt: WorktreeSetupAttempt;
  readonly api: WorktreeSetupApi;
  readonly terminals: TerminalPanels | null;
}) {
  const [review, setReview] = useState<WorktreeSetupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  useEffect(() => {
    if (attempt.state === "running" || attempt.state === "succeeded") return;
    let current = true;
    void api.preview(chatId, attempt.worktree_id, true).then(
      (value) => {
        if (current) setReview(value);
      },
      (failure) => {
        if (current) setError(errorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [api, chatId, attempt.worktree_id, attempt.state]);
  if (attempt.state === "succeeded") return null;
  const run = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
      setReview(null);
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const running = attempt.state === "running";
  const failed = attempt.state === "failed" || attempt.state === "interrupted";
  return (
    <section
      className="chat-banner"
      aria-label="Worktree setup"
      data-level={failed ? "error" : "info"}
    >
      <p role="status">
        {running
          ? "Setup is running. You can queue messages below."
          : (attempt.detail ??
            "Review setup before the agent starts. You can queue messages below.")}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {review ? (
        <section aria-label="Review setup command">
          <p>
            <code>{review.destination}</code>
          </p>
          {review.command ? (
            <p>
              <code>{[review.command.program, ...review.command.args].join(" ")}</code>
            </p>
          ) : (
            <p>No setup command is saved. Completing this review releases setup admission.</p>
          )}
          {review.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <button
            type="button"
            className="g-button"
            disabled={busy || !terminals}
            onClick={() =>
              void run(async () => {
                const result = await api.apply(chatId, review.token);
                if (result.warning) {
                  setError(result.warning);
                  return;
                }
                if (result.command_token && terminals)
                  terminals.setupTab(
                    chatId,
                    api.terminal(chatId, result.command_token),
                    review.destination,
                  );
                setReview(null);
              })
            }
          >
            {busy ? "Preparing setup…" : "Run reviewed setup"}
          </button>
          <button
            type="button"
            className="g-button g-button-ghost"
            disabled={busy}
            onClick={() => setReview(null)}
          >
            Cancel review
          </button>
        </section>
      ) : !running ? (
        <button
          type="button"
          className="g-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              // Files were copied on creation. Retrying only reviews the command and never recopies them.
              setReview(await api.preview(chatId, attempt.worktree_id, true));
            })
          }
        >
          {failed ? "Retry setup" : "Review setup"}
        </button>
      ) : null}
      {running && terminals ? (
        <button type="button" className="g-button" onClick={() => terminals.show(chatId)}>
          Show setup terminal
        </button>
      ) : null}
    </section>
  );
}
