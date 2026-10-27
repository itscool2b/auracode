/** Synthetic setup actions. No native command or network request is made. */
import "../styles.css";
import "../ui-tokens.css";
import "../shell.css";
import "../components/setup/setup.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TerminalChunk } from "../bindings";
import { CloneProject } from "../components/setup/CloneProject";
import { InstallAgent } from "../components/setup/InstallAgent";
import type { CloneApi, InstallApi } from "../lib/setup-actions/api";
import type { CloneRecord } from "../lib/setup-actions/bindings";

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
  let clone: CloneRecord | null = null;
  const cloneApi: CloneApi = {
    review: async (input) => {
      calls.push("clone-review");
      if (new URLSearchParams(location.search).has("existing"))
        throw new Error(
          "The destination already exists. Choose another new folder name; its contents were left unchanged.",
        );
      return {
        id: "clone-id",
        remote: input.remote,
        parent: input.parent,
        destination: `${input.parent}/${input.name}`,
        notices: [
          "Creates a new folder. Existing folders are refused.",
          "No sign-in runs here. Partial files are retained if canceled.",
        ],
      };
    },
    cancelReview: async () => {
      calls.push("clone-cancel-review");
    },
    start: async () => {
      calls.push("clone-start");
      clone = {
        id: "clone-id",
        remote: "https://github.com/owner/repo",
        parent: "C:/fixture",
        destination: "C:/fixture/repo",
        journal: "C:/fixture/.auracode-clone-id",
        state: "running",
        detail: "Cloning the repository.",
      };
      return { ...clone };
    },
    status: async () => {
      if (!clone) throw new Error("No fixture clone.");
      if (new URLSearchParams(location.search).has("ready")) {
        clone.state = "ready";
        clone.detail = "Repository cloned. Choose Use this folder to add it to your project.";
      }
      return { ...clone };
    },
    cancel: async () => {
      calls.push("clone-cancel");
      if (clone) {
        clone.state = "canceled";
        clone.detail = "Clone canceled. Its partial folder and recovery record were retained.";
      }
    },
    history: async () => {
      calls.push("clone-history");
      return [];
    },
  };
  Object.assign(window, { setupActionsFixture: { calls: () => [...calls] } });
  function Preview() {
    const [mounted, setMounted] = useState(true);
    return (
      <main className="g-root setup-shell" style={{ display: "block", padding: 40 }}>
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
        <CloneProject
          api={cloneApi}
          pickParent={async () => "C:/fixture"}
          onFolder={() => calls.push("clone-use-folder")}
        />
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
