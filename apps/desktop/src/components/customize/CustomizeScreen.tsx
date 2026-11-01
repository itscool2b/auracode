import { ArrowLeft, BookOpen, FileText, Puzzle } from "lucide-react";
import { type ComponentProps, useEffect, useState, useSyncExternalStore } from "react";
import type { InstructionsTarget } from "../../bindings";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { PluginLibraryScreen } from "../library/PluginLibraryScreen";
import { InstructionsPanel } from "../settings/InstructionsPanel";
import { ProjectMemoryPanel } from "../settings/ProjectMemoryPanel";
import "../settings/settings.css";
import "./customize.css";

export type CustomizeSection = "plugins" | "instructions" | "memory";
export interface CustomizeServices {
  readonly plugins?: Pick<
    ComponentProps<typeof PluginLibraryScreen>,
    "api" | "libraryApi" | "vendorApi" | "mcpApi"
  >;
  readonly instructions?: ComponentProps<typeof InstructionsPanel>["api"];
  /** The profile's preferences, for Instructions' worktree switch. */
  readonly setup?: ComponentProps<typeof InstructionsPanel>["setup"];
  readonly memory?: ComponentProps<typeof ProjectMemoryPanel>["api"];
}
const SECTIONS = [
  { id: "plugins", label: "Plugins & MCP", icon: Puzzle },
  { id: "instructions", label: "Instructions", icon: FileText },
  { id: "memory", label: "Project memory", icon: BookOpen },
] as const;
const noSubscribe = () => () => {};
const emptyWorkspace = () => EMPTY_WORKSPACE;
const NO_PROJECTS: NonNullable<typeof EMPTY_WORKSPACE.data>["projects"] = [];

export function CustomizeScreen({
  workspace,
  initialProjectId = null,
  initialSection = "plugins",
  instructionsTarget,
  chatLabel,
  activeChatId,
  onBack,
  onAgents,
  services,
}: {
  readonly workspace?: WorkspaceStore;
  readonly initialProjectId?: string | null;
  readonly initialSection?: CustomizeSection;
  readonly instructionsTarget?: InstructionsTarget;
  readonly chatLabel?: string;
  readonly activeChatId?: string;
  readonly onBack: () => void;
  readonly onAgents: () => void;
  readonly services?: CustomizeServices;
}) {
  const organization = useSyncExternalStore(
    workspace?.subscribe ?? noSubscribe,
    workspace?.getSnapshot ?? emptyWorkspace,
    workspace?.getSnapshot ?? emptyWorkspace,
  );
  const [section, setSection] = useState<CustomizeSection>(initialSection);
  const [visited, setVisited] = useState<ReadonlySet<CustomizeSection>>(new Set([initialSection]));
  const projects = organization.data?.projects ?? NO_PROJECTS;
  const [target, setTarget] = useState<InstructionsTarget | null>(instructionsTarget ?? null);
  useEffect(() => {
    if (target || (initialProjectId && !organization.data)) return;
    const folder = projects
      .find((project) => project.id === initialProjectId)
      ?.folders.find((folder) => folder.folder_state === "ok");
    setTarget(folder ? { type: "folder", folder_id: folder.id } : { type: "global" });
  }, [target, projects, initialProjectId, organization.data]);
  const folders = projects.flatMap((project) =>
    project.folders.map((folder) => ({
      id: folder.id,
      label: project.folders.length > 1 ? `${project.name} / ${folder.display_name}` : project.name,
    })),
  );
  return (
    <div className="customize-screen g-root" data-testid="customize-screen">
      <div className="customize-titlebar" data-tauri-drag-region="" />
      <header className="customize-header">
        <button type="button" className="g-button g-button-ghost g-button-28" onClick={onBack}>
          <ArrowLeft size={14} />
          Back to chats
        </button>
        <h1>Customize</h1>
        <p>Tools, instructions, and shared project context for your agents.</p>
      </header>
      <nav className="customize-tabs" aria-label="Customize sections">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? "page" : undefined}
            onClick={() => {
              setSection(id);
              setVisited((current) => new Set([...current, id]));
            }}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="customize-content">
        {visited.has("plugins") ? (
          <div hidden={section !== "plugins"} className="customize-pane customize-plugins">
            <PluginLibraryScreen
              {...services?.plugins}
              embedded
              initialProjectId={initialProjectId}
              projects={projects}
              activeChatId={activeChatId}
              onBack={onBack}
              onAgents={onAgents}
            />
          </div>
        ) : null}
        {visited.has("instructions") ? (
          <section
            hidden={section !== "instructions"}
            className="customize-pane customize-document"
            aria-label="Instructions"
          >
            <h2>Instructions</h2>
            <p className="settings-lead">
              Tell agents how to work. Review the files and who reads them before applying changes.
            </p>
            {target ? (
              <InstructionsPanel
                api={services?.instructions}
                setup={services?.setup}
                initialTarget={target}
                folders={folders}
                chatLabel={chatLabel}
              />
            ) : (
              <p role="status">Loading instruction scope…</p>
            )}
          </section>
        ) : null}
        {visited.has("memory") ? (
          <section
            hidden={section !== "memory"}
            className="customize-pane customize-document"
            aria-label="Project memory"
          >
            <ProjectMemoryPanel
              api={services?.memory}
              projects={projects}
              initialProjectId={initialProjectId ?? undefined}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
