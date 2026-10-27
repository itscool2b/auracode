/** Synthetic metadata only. No project, folder, agent or remote is changed. */
import "../styles.css";
import "../ui-tokens.css";
import "../chat.css";
import "../shell.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceRemovalDialog } from "../components/chat/WorkspaceRemovalDialog";
import type { WorkspaceRemovalApi } from "../lib/workspaceRemoval";

const calls: string[] = [];
const scenario = new URLSearchParams(location.search).get("case");
const api: WorkspaceRemovalApi = {
  list: async () => {
    calls.push("list");
    return [
      {
        target: { kind: "project", id: "project" },
        name: "Saved project",
        project_name: "Saved project",
        chat_count: 2,
        removed_at: 1,
        restore_unavailable: null,
      },
      {
        target: { kind: "folder", id: "folder" },
        name: "Earlier folder",
        project_name: "Saved project",
        chat_count: 1,
        removed_at: 1,
        restore_unavailable: "Restore this folder's project first.",
      },
    ];
  },
  review: async (target, action) => {
    calls.push(`review:${action}`);
    return {
      token: "one-use",
      target,
      action,
      name: "Saved project",
      chat_count: 2,
      folders: ["C:\\Code\\saved-project"],
      notices: [
        "Files on disk are unchanged.",
        "Saved chats will be hidden until this item is restored.",
      ],
    };
  },
  apply: async () => {
    calls.push("apply");
    if (scenario === "stale")
      throw new Error("The project or its chats changed. Review removal again.");
    return null;
  },
};
Object.assign(window, { workspaceRemovalFixture: { calls: () => [...calls] } });
function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <main className="g-root" style={{ minHeight: "100vh", padding: 30 }}>
      <h1>Workspace removal fixture</h1>
      {open ? (
        <WorkspaceRemovalDialog
          target={scenario === "restore" ? null : { kind: "project", id: "project" }}
          api={api}
          onClose={() => setOpen(false)}
          onChanged={async () => {
            calls.push("refresh");
          }}
        />
      ) : (
        <p>Dialog closed.</p>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
