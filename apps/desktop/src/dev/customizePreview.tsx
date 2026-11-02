/** Synthetic service data, real Customize navigation and panels. No native operations run. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CustomizeScreen, type CustomizeServices } from "../components/customize/CustomizeScreen";
import { WorkspaceStore } from "../lib/workspace";
import { createInstructionsFixture } from "./instructionsFixture";
import { pluginFixture } from "./pluginLibraryPreview";
import { createProjectMemoryFixture } from "./projectMemoryPreview";
import { createSetupFixture } from "./setupFixture";

const unsupported = async (): Promise<never> => {
  throw new Error("This synthetic preview does not run native operations.");
};
export function mountCustomizePreview(container: HTMLElement) {
  const workspace = new WorkspaceStore({
    snapshot: async () => ({
      projects: [
        {
          id: "fixture-project",
          name: "auracode",
          color: null,
          default_agent: "claude",
          default_model: null,
          created_at: 1,
          updated_at: 1,
          folders: [
            {
              id: "fixture-folder",
              project_id: "fixture-project",
              display_name: "auracode",
              path: "/fixture/auracode",
              folder_state: "ok",
              unavailable_reason: null,
              kind: "local",
              git_remote_url: null,
              git_default_branch: null,
            },
          ],
        },
      ],
      chats: [],
    }),
    createProject: unsupported,
    updateProject: unsupported,
    addFolder: unsupported,
    rename: unsupported,
    pin: unsupported,
    archive: unsupported,
    move: unsupported,
    preview: unsupported,
    createChat: unsupported,
  });
  const services: CustomizeServices = {
    instructions: createInstructionsFixture("universal").api,
    setup: createSetupFixture(),
    memory: createProjectMemoryFixture().api,
    plugins: {
      api: {
        snapshot: async () => pluginFixture("plugins"),
        setSync: async () => [],
        update: unsupported,
      },
      libraryApi: {
        snapshot: async () => ({ items: [], sources: [], notices: [] }),
        history: async () => [],
        preview: unsupported,
        prepare: unsupported,
        cancel: async () => {},
        apply: unsupported,
        rollback: unsupported,
      },
      vendorApi: {
        capabilities: async () => [],
        review: unsupported,
        cancel: async () => {},
        terminal: () => {
          throw new Error("No native terminals in the preview.");
        },
      },
      mcpApi: {
        snapshot: async () => ({ revision: 1, servers: [], conflicts: [] }),
        save: unsupported,
        remove: unsupported,
        credentials: unsupported,
        import: unsupported,
        export: unsupported,
        conflict: unsupported,
        test: unsupported,
        sessionAction: unsupported,
        importNative: unsupported,
      },
    },
  };
  Object.assign(window, { customizeFixture: { refresh: () => workspace.refresh() } });
  void workspace.refresh();
  createRoot(container).render(
    <StrictMode>
      <CustomizeScreen
        workspace={workspace}
        initialProjectId="fixture-project"
        services={services}
        onBack={() => {
          location.href = "/?preview=settled";
        }}
        onAgents={() => {
          location.href = "/?preview=agents";
        }}
      />
    </StrictMode>,
  );
}
