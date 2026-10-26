/** Synthetic executable choices. No native probe, filesystem or agent calls. */
import "../styles.css";
import "../ui-tokens.css";
import "../orbit-shell.css";
import "../components/setup/setup.css";
import { createRoot } from "react-dom/client";
import type { AgentInstallations as Installations } from "../bindings";
import { AgentInstallations } from "../components/setup/AgentInstallations";
import type { AgentInstallationsApi } from "../lib/agentInstallations";

const calls: string[] = [];
const mode = new URLSearchParams(location.search).get("case");
let value: Installations = {
  agent_id: "claude",
  preferred_path: null,
  truncated: false,
  notice: null,
  candidates: [
    {
      path: "C:\\Tools\\claude.exe",
      source: "PATH",
      selected: true,
      installation: null,
      availability: {
        state: "ready",
        version: "Claude Code 2.1.310",
        path: "C:\\Tools\\claude.exe",
      },
    },
    {
      path: "C:\\Other\\claude.exe",
      source: "PATH",
      selected: false,
      installation: null,
      availability: {
        state: "ready",
        version: "Claude Code 2.1.309",
        path: "C:\\Other\\claude.exe",
      },
    },
    {
      path: "C:\\Broken\\claude.exe",
      source: "PATH",
      selected: false,
      installation: null,
      availability: { state: "broken", reason: "Version command failed" },
    },
  ],
};
const [first, second] = value.candidates;
if (mode === "missing" && first && second) {
  value.preferred_path = second.path;
  first.selected = false;
  second.selected = true;
  second.availability = {
    state: "missing",
    reason: "The selected executable is no longer available.",
  };
}
const api: AgentInstallationsApi = {
  list: async () => {
    calls.push("list");
    return structuredClone(value);
  },
  select: async (_id, path) => {
    calls.push(path ?? "default");
    if (mode === "stale" && calls.filter((c) => c === path).length === 1)
      throw new Error("The selected executable disappeared. Check again.");
    value = {
      ...value,
      preferred_path: path,
      candidates: value.candidates.map((candidate, index) => ({
        ...candidate,
        selected: path === null ? index === 0 : path === candidate.path,
      })),
    };
    return structuredClone(value);
  },
};
Object.assign(window, { installationFixture: { calls: () => [...calls] } });
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <main className="setup-shell orbit-theme" style={{ padding: 40, overflow: "auto" }}>
      <section style={{ maxWidth: 640 }}>
        <h1>Claude Code</h1>
        <AgentInstallations agentId="claude" api={api} onChanged={() => calls.push("changed")} />
      </section>
    </main>,
  );
