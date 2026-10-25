import { useState } from "react";
import type { AuthPrompt } from "../../bindings";
import { authCommandText } from "../../lib/chat/present";

/**
 * The agent needs its own sign-in: its message, each sign-in command with the variables it sets
 * and Copy, and Retry. auracode runs none of them (M1a): the user signs in in a terminal with
 * their own binary. Retry sends the held prompts again (`chat_resume_queue`) when there are any,
 * else starts the agent.
 */
export function AuthCard({
  auth,
  onRetry,
  copy = (text) => navigator.clipboard.writeText(text),
}: {
  readonly auth: AuthPrompt;
  readonly onRetry: () => void;
  readonly copy?: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="chat-block" data-kind="auth">
      <div className="chat-block-head">
        <span className="chat-block-title">{auth.message}</span>
        <span className="chat-block-tag">Sign-in needed</span>
      </div>
      {auth.commands.map((command, index) => {
        const text = authCommandText(command);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the agent's methods are positional.
          <div key={index} className="chat-command">
            <span>{command.label}</span>
            <pre className="ui-pre">{text}</pre>
            {command.env.length > 0 ? (
              <span className="ui-muted">Sets {command.env.map(([name]) => name).join(", ")}</span>
            ) : null}
            <div className="ui-row">
              <button
                type="button"
                className="ui-button"
                data-kind="quiet"
                onClick={() => {
                  copy(text).then(
                    () => {
                      setCopied(index);
                      setProblem(null);
                    },
                    () => setProblem("Could not copy the command; select it and copy it instead."),
                  );
                }}
              >
                {copied === index ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        );
      })}
      {problem !== null ? (
        <span role="alert" className="ui-error">
          {problem}
        </span>
      ) : null}
      <div className="ui-row">
        <button type="button" className="ui-button" data-kind="primary" onClick={onRetry}>
          Retry
        </button>
        <span className="ui-muted">Sign in in a terminal first, then press Retry.</span>
      </div>
    </div>
  );
}
