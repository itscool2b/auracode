import { useEffect, useRef, useState } from "react";
import { type InstallApi, installApi } from "../../lib/setup-actions/api";
import type { AgentInstallReview } from "../../lib/setup-actions/bindings";
import type { TerminalTransport } from "../../lib/terminal";
import { TerminalSheet } from "../TerminalSheet";

export function InstallAgent({
  agentId,
  agentName,
  onRefresh,
  api = installApi,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly onRefresh: () => void;
  readonly api?: InstallApi;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    value: AgentInstallReview;
    terminal: TerminalTransport;
  } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="setup-button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError("");
          void api
            .review(agentId)
            .then(
              (value) => {
                if (mounted.current) setReview({ value, terminal: api.terminal(value) });
              },
              (reason: unknown) => {
                if (mounted.current)
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "The installation review could not load.",
                  );
              },
            )
            .finally(() => {
              if (mounted.current) setPending(false);
            });
        }}
      >
        {pending ? "Preparing review…" : "Review installation"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {review ? (
        <TerminalSheet
          agentId={agentId}
          agentName={agentName}
          purpose="installation"
          transport={review.terminal}
          onClose={() => {
            setReview(null);
            onRefresh();
          }}
          onFinished={onRefresh}
          review={
            <details className="setup-install-review" open>
              <summary>
                {review.value.package} · {review.value.version}
              </summary>
              <dl>
                <dt>Program</dt>
                <dd>
                  <code>{review.value.program}</code>
                </dd>
                <dt>Arguments</dt>
                <dd>
                  <ol>
                    {review.value.arguments.map((argument) => (
                      <li key={argument}>
                        <code>{argument}</code>
                      </li>
                    ))}
                  </ol>
                </dd>
                <dt>Folder</dt>
                <dd>
                  <code>{review.value.working_directory}</code>
                </dd>
              </dl>
              <ul>
                {review.value.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </details>
          }
        />
      ) : null}
    </>
  );
}
