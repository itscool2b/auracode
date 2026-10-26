import { useEffect, useState } from "react";
import type { AgentEntry, AgentMaintenance } from "../../bindings";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { TerminalSheet } from "../TerminalSheet";
import { authStatusText, InstallationStatus } from "./NewChat";

/** Actions are offered only when Rust verifies the exact detected installation supports them. */
export function AgentActions({
  agent,
  transport,
  onRefresh,
}: {
  readonly agent: AgentEntry;
  readonly transport: Transport;
  readonly onRefresh: () => void;
}) {
  const [maintenance, setMaintenance] = useState<AgentMaintenance | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    let current = true;
    void transport.agentMaintenance(agent.id).then(
      (value) => {
        if (current) setMaintenance(value);
      },
      (reason) => {
        if (current) setError(errorMessage(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [transport, agent.id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-agent-actions">
      {agent.installation ? <InstallationStatus installation={agent.installation} /> : null}
      {maintenance?.auth_status ? (
        <button
          type="button"
          className="ui-button"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setMessage(authStatusText(await transport.agentAuthStatus(agent.id))),
            )
          }
        >
          Check sign-in
        </button>
      ) : null}
      {maintenance?.login_available ? (
        <button type="button" className="ui-button" disabled={busy} onClick={() => setSignIn(true)}>
          Sign in…
        </button>
      ) : null}
      {maintenance?.update_unavailable === null ? (
        <button
          type="button"
          className="ui-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await transport.agentUpdate(agent.id);
              setMessage("Agent update finished.");
              onRefresh();
            })
          }
        >
          Update agent
        </button>
      ) : null}
      {maintenance?.update_unavailable ? <p>{maintenance.update_unavailable}</p> : null}
      {busy ? <p role="status">Working…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="ui-error">
          {error}
        </p>
      ) : null}
      {signIn ? (
        <TerminalSheet
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => {
            setSignIn(false);
            onRefresh();
          }}
          onFinished={() =>
            setMessage("Sign-in command finished. Check sign-in to confirm access.")
          }
        />
      ) : null}
    </div>
  );
}
