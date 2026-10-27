/** Synthetic workspaces only. Never opens a real profile or writes an export file. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatExportDialog } from "../components/chat/ChatExportDialog";
import { DebugBundleDialog } from "../components/chat/DebugBundleDialog";
import { LocalImportPanel } from "../components/settings/LocalImportPanel";
import type { LocalImportApi } from "../lib/localImport";

const params = new URLSearchParams(location.search);
const calls: string[] = [];
let revision = 0;
const api: LocalImportApi = {
  preview: async () => {
    calls.push("review");
    revision += 1;
    return {
      notices: [
        "Your Local copy stays on this device. Agent credentials and native sessions are not copied.",
      ],
      projects: params.has("empty")
        ? []
        : [
            {
              project_id: "orbit",
              name: "Orbit",
              chats: 3,
              turns: 12,
              folders: 1,
              revision: `revision-${revision}`,
              already_imported: false,
            },
            {
              project_id: "existing",
              name: "Already here",
              chats: 1,
              turns: 2,
              folders: 1,
              revision: "old",
              already_imported: true,
            },
          ],
    };
  },
  apply: async (selected) => {
    calls.push(`import:${JSON.stringify(selected)}`);
    if (params.has("stale") && revision === 1)
      throw new Error("The Local project changed. Review it again before importing.");
    return {
      project_ids: ["imported-orbit"],
      chats: 3,
      turns: 12,
      missing_attachments: params.has("missing") ? 1 : 0,
    };
  },
};
Object.assign(window, { dataTransferFixture: { calls: () => [...calls] } });
function Fixture() {
  const [open, setOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  return (
    <main className="g-root settings-content">
      <h1>Workspace transfer fixture</h1>
      <LocalImportPanel
        api={api}
        onImported={async () => {
          calls.push("refresh");
        }}
      />
      <button type="button" className="g-button" onClick={() => setOpen(true)}>
        Export chat
      </button>
      <button type="button" className="g-button" onClick={() => setDebugOpen(true)}>
        Copy debug bundle
      </button>
      {debugOpen ? (
        <DebugBundleDialog
          chatId="saved-chat"
          onClose={() => setDebugOpen(false)}
          prepare={async (id) => {
            calls.push(`debug:${id}`);
            if (params.has("debug-error"))
              throw new Error("The protocol log could not be read safely.");
            return 'auracode debug bundle v1\nApp: 0.1.0\n{"token":"<REDACTED>","message":"Review this content"}\n';
          }}
          copy={async (text) => {
            calls.push(`copy:${text}`);
            if (params.has("clipboard-error")) throw new Error("Clipboard access was denied.");
          }}
        />
      ) : null}
      {open ? (
        <ChatExportDialog
          chatId="saved-chat"
          onClose={() => setOpen(false)}
          save={async (id) => {
            calls.push(`export:${id}`);
            if (params.has("export-error"))
              throw new Error("A file already exists there. Choose a new name.");
            return params.has("export-cancel") ? null : "C:/exports/Orbit chat.md";
          }}
        />
      ) : null}
    </main>
  );
}
export function mountDataTransferPreview(container: HTMLElement) {
  createRoot(container).render(<Fixture />);
}
