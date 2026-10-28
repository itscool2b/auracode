import { useContext, useEffect, useRef, useState } from "react";
import { type InstallApi, InstallApiContext, installApi } from "../../lib/setup-actions/api";
import type { AgentInstallReview } from "../../lib/setup-actions/bindings";
import type { TerminalTransport } from "../../lib/terminal";
import { TerminalSheet } from "../TerminalSheet";

export function InstallAgent({
  agentId,
  agentName,
  onRefresh,
  api: given,
  label = "Review installation",
  ariaLabel,
  className = "g-button g-button-outline g-button-28",
  onError,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly onRefresh: () => void;
  readonly api?: InstallApi;
  /** The button's words: "Install" on an agent row, "Review installation" on its own. */
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  /** Where a failed review is reported; without it the reason shows under the button. */
  readonly onError?: (message: string) => void;
}) {
  const provided = useContext(InstallApiContext);
  const api = given ?? provided ?? installApi;
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
        className={className}
        disabled={pending}
        aria-label={ariaLabel}
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
                if (!mounted.current) return;
                const message =
                  reason instanceof Error
                    ? reason.message
                    : "The installation review could not load.";
                if (onError) onError(message);
                else setError(message);
              },
            )
            .finally(() => {
              if (mounted.current) setPending(false);
            });
        }}
      >
        {pending ? "Preparing…" : label}
      </button>
      {error ? (
        <p role="alert" className="setup-alert">
          {error}
        </p>
      ) : null}
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
            <section className="setup-install-review" aria-label="Installation review">
              <dl>
                <dt>Package</dt>
                <dd>
                  <code>
                    {review.value.package}@{review.value.version}
                  </code>
                </dd>
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
            </section>
          }
        />
      ) : null}
    </>
  );
}
