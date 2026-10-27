/** Chat recovery with synthetic maintenance metadata and terminal IO. No native calls. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentMaintenance } from "../bindings";
import { ChatAuthCard } from "../components/chat/ChatAuthCard";
import type { TerminalTransport } from "../lib/terminal";

const calls: string[] = [];
let resolveDelayed: ((value: AgentMaintenance) => void) | undefined;
let exitCode = 0;
const maintenance = (available: boolean): AgentMaintenance => ({
  auth_status: false,
  login_available: available,
  update_unavailable: null,
});
const transport = {
  async agentMaintenance(id: string) {
    calls.push(`maintenance:${id}`);
    if (id === "failed") throw new Error("Synthetic lookup failure");
    if (id === "delayed")
      return new Promise<AgentMaintenance>((resolve) => {
        resolveDelayed = resolve;
      });
    return maintenance(id === "claude");
  },
};
const loginTransport: TerminalTransport = {
  async reserve() {
    calls.push("reserve");
    return "owned-fixture";
  },
  async start(id, agentId) {
    calls.push(`start:${agentId}`);
    return id;
  },
  async read() {
    calls.push("read");
    return {
      bytes: Array.from(new TextEncoder().encode("Synthetic vendor sign-in finished.\r\n")),
      done: true,
      exit_code: exitCode,
      truncated: false,
    };
  },
  async write() {
    calls.push("write");
  },
  async resize() {},
  async close() {
    calls.push("close");
  },
};
Object.assign(window, {
  chatAuthFixture: {
    calls: () => [...calls],
    resolveDelayed: () => resolveDelayed?.(maintenance(true)),
    exitCode: (value: number) => {
      exitCode = value;
    },
  },
});
function Fixture() {
  const [agentId, setAgentId] = useState("claude");
  return (
    <main
      className="g-root"
      data-theme="dark"
      style={{
        padding: 24,
        minHeight: "100vh",
        background: "var(--g-surface-1)",
        color: "var(--g-fg-1)",
      }}
    >
      <h1>Chat sign-in recovery</h1>
      <nav
        aria-label="Synthetic agent selection"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 32 }}
      >
        {["claude", "unsupported", "failed", "delayed"].map((id) => (
          <button key={id} type="button" className="g-button" onClick={() => setAgentId(id)}>
            {id}
          </button>
        ))}
      </nav>
      <section aria-label="Conversation" style={{ maxWidth: 720, margin: "auto" }}>
        <ChatAuthCard
          key={agentId}
          agentId={agentId}
          agentName={agentId === "claude" ? "Claude Code" : agentId}
          auth={{
            message: "The agent needs you to sign in.",
            commands: [
              { label: "Vendor sign-in", argv: ["vendor-display-only", "login"], env: [] },
            ],
          }}
          transport={transport}
          loginTransport={loginTransport}
          onRetry={() => calls.push("retry")}
        />
      </section>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
