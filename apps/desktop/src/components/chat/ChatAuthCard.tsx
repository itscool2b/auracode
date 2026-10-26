import { useEffect, useState } from "react";
import type { AuthPrompt } from "../../bindings";
import type { Transport } from "../../lib/chat/transport";
import type { TerminalTransport } from "../../lib/terminal";
import { TerminalSheet } from "../TerminalSheet";
import { AuthCard } from "./AuthCard";

/** A driver-supplied command is display-only. Rust independently chooses the verified login. */
export function ChatAuthCard({
  auth,
  agentId,
  agentName,
  transport,
  onRetry,
  loginTransport,
}: {
  readonly auth: AuthPrompt;
  readonly agentId: string;
  readonly agentName: string;
  readonly transport: Pick<Transport, "agentMaintenance">;
  readonly onRetry: () => void;
  readonly loginTransport?: TerminalTransport;
}) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setSupported(false);
    setOpen(false);
    setNotice(null);
    void transport.agentMaintenance(agentId).then(
      (value) => {
        if (current) setSupported(value.login_available);
      },
      () => {
        if (current)
          setNotice("The sign-in sheet is unavailable. Use the vendor command or refresh agents.");
      },
    );
    return () => {
      current = false;
    };
  }, [agentId, transport]);
  return (
    <>
      <AuthCard
        auth={auth}
        onRetry={onRetry}
        onSignIn={supported ? () => setOpen(true) : undefined}
      />
      {notice ? (
        <p className="conversation-notice" role="status">
          {notice}
        </p>
      ) : null}
      {supported && open ? (
        <TerminalSheet
          agentId={agentId}
          agentName={agentName}
          transport={loginTransport}
          onClose={() => setOpen(false)}
          onFinished={(exitCode) =>
            setNotice(
              exitCode === 0
                ? "The sign-in command finished. Press Retry to check access and resume."
                : "Sign-in did not finish successfully. Reopen the sheet or use the vendor command.",
            )
          }
        />
      ) : null}
    </>
  );
}
