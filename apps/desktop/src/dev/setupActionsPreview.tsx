/** Synthetic setup actions. No native command or network request is made. */
import "../styles.css";
import "../ui-tokens.css";
import "../orbit-shell.css";
import "../components/setup/setup.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TerminalChunk } from "../bindings";
import { InstallAgent } from "../components/setup/InstallAgent";
import type { InstallApi } from "../lib/setup-actions/api";

if (import.meta.env.DEV) {
  const calls: string[] = [];
  let read: ((chunk: TerminalChunk) => void) | null = null;
  const api: InstallApi = {
    review: async () => {
      calls.push("review");
      return {
        agent_id: "pi",
        package: "@earendil-works/pi-coding-agent",
        version: "1.0.2",
        program: "C:/Program Files/nodejs/node.exe",
        arguments: [
          "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
          "install",
          "--global",
          "--ignore-scripts",
          "@earendil-works/pi-coding-agent@1.0.2",
        ],
        working_directory: "C:/Users/fixture",
        revision: "synthetic",
        timeout_seconds: 600,
        notices: [
          "Installs a verified version into npm's existing global prefix.",
          "Closing this sheet stops the installer. The installation is bounded to ten minutes.",
          "Sign-in is a separate action. <script>window.injected = true</script>",
        ],
      };
    },
    terminal: () => ({
      reserve: async () => {
        calls.push("reserve");
        return "fixture-terminal";
      },
      start: async () => {
        calls.push("start");
        if (new URLSearchParams(location.search).has("stale"))
          throw new Error("The installer changed. Review the installation again.");
        return "fixture-terminal";
      },
      read: async () =>
        new Promise((resolve) => {
          read = resolve;
        }),
      write: async () => {
        calls.push("write");
      },
      resize: async () => {},
      close: async () => {
        calls.push("close");
        read?.({ bytes: [], done: true, exit_code: null, truncated: false });
        read = null;
      },
    }),
  };
  Object.assign(window, { setupActionsFixture: { calls: () => [...calls] } });
  function Preview() {
    const [mounted, setMounted] = useState(true);
    return (
      <main className="orbit-theme setup-shell" data-theme="dark" style={{ padding: 40 }}>
        <h1>Install Pi</h1>
        {mounted ? (
          <InstallAgent
            agentId="pi"
            agentName="Pi"
            api={api}
            onRefresh={() => calls.push("refresh")}
          />
        ) : null}
        <button type="button" onClick={() => setMounted(false)}>
          Leave setup
        </button>
      </main>
    );
  }
  const element = document.getElementById("root");
  if (element)
    createRoot(element).render(
      <StrictMode>
        <Preview />
      </StrictMode>,
    );
}
