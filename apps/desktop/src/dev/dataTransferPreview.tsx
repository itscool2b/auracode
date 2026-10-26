/** Synthetic workspaces only. Never opens a real profile or writes an export file. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatExportDialog } from "../components/chat/ChatExportDialog";
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
  return (
    <main className="orbit-theme settings-content" data-theme="dark">
      <h1>Workspace transfer fixture</h1>
      <LocalImportPanel
        api={api}
        onImported={async () => {
          calls.push("refresh");
        }}
      />
      <button type="button" className="ui-button" onClick={() => setOpen(true)}>
        Export chat
      </button>
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
