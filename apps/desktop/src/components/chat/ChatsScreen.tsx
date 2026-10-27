import { Logo } from "@auracode/ui/graphite";
import { PanelLeft } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppInfo, ProjectSummary } from "../../bindings";
import { type AppStore, NewChatDraft } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { navigationTarget } from "../../lib/nativeNavigation";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { AgentDock } from "./AgentDock";
import { Banners } from "./Banners";
import { ChatActionsDialog } from "./ChatActionsDialog";
import { ChatList } from "./ChatList";
import { ChatView } from "./ChatView";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { NewChat } from "./NewChat";
import { ProjectDialog } from "./ProjectDialog";

const noSubscribe = () => () => {};
const emptyWorkspace = () => EMPTY_WORKSPACE;

/**
 * The sidebar's top band (Grok): the logo at the left and the collapse toggle at the right. The
 * band drags the window; on macOS the logo sits clear of the traffic lights (`data-os` on the app).
 */
export function SidebarBand({
  collapsed,
  onToggle,
}: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <>
      <div className="chat-drag" data-tauri-drag-region="" />
      <Logo size={24} className="chat-sidebar-logo" />
      <button
        type="button"
        className="g-button g-button-ghost g-button-icon g-button-28 chat-sidebar-toggle"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-keyshortcuts="Control+\ Meta+\"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <PanelLeft size={16} />
      </button>
    </>
  );
}

/**
 * The chats: the sidebar with New chat and the projects' chats, the banners, and the open chat
 * (or New chat). Diagnostics (the M0 info card and stress view) is one button away.
 */
export function ChatsScreen({
  app,
  transport,
  info,
  onRecoveryDismissed,
  onDiagnostics,
  onAgents,
  onSettings,
  active = true,
  workspace,
  openChatRequest,
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly info: AppInfo;
  /** The shell acknowledged the database repair, so its notice goes for good. */
  readonly onRecoveryDismissed: () => void;
  readonly onDiagnostics: () => void;
  readonly onAgents?: () => void;
  readonly onSettings?: () => void;
  readonly active?: boolean;
  readonly workspace?: WorkspaceStore;
  readonly openChatRequest?: { id: string };
}) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => new NewChatDraft(transport));
  const [collapsed, setCollapsed] = useState(false);
  const organization = useSyncExternalStore(
    workspace?.subscribe ?? noSubscribe,
    workspace?.getSnapshot ?? emptyWorkspace,
    workspace?.getSnapshot ?? emptyWorkspace,
  );
  const [archived, setArchived] = useState(false);
  const [projectDialog, setProjectDialog] = useState<{ project: ProjectSummary | null } | null>(
    null,
  );
  const [chatOptions, setChatOptions] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [chatCommands, setChatCommands] = useState<readonly PaletteCommand[]>([]);
  const chatIds = snapshot.chats?.map((chat) => chat.id).join(",") ?? "";
  // A new or externally created chat can also create a project. Live status text is merged below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Membership refresh depends on the set of listed IDs, not each status update.
  useEffect(() => {
    void workspace?.refresh();
  }, [workspace, chatIds]);
  const liveById = new Map(snapshot.chats?.map((chat) => [chat.id, chat]));
  const displayed = organization.data
    ? organization.data.chats
        .filter((entry) => entry.archived === archived)
        .map((entry) => liveById.get(entry.chat.id) ?? entry.chat)
    : snapshot.chats;
  const optionsEntry = organization.data?.chats.find((entry) => entry.chat.id === chatOptions);
  // A notification's chat opens only once the lists confirm this profile has it (docs/native-shell.md).
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  useEffect(() => {
    if (openChatRequest) setPendingOpen(openChatRequest.id);
  }, [openChatRequest]);
  useEffect(() => {
    if (pendingOpen === null) return;
    const target = navigationTarget(pendingOpen, {
      chats: snapshot.chats,
      chatsFailed: snapshot.chatsError !== null,
      workspace: organization.data,
      workspacePending:
        workspace !== undefined && organization.data === null && organization.error === null,
    });
    if (target.kind === "wait") return;
    setPendingOpen(null);
    if (target.kind === "open") {
      setArchived(target.archived);
      setSelected(target.chatId);
    }
  }, [pendingOpen, snapshot.chats, snapshot.chatsError, organization, workspace]);

  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);

  useEffect(() => {
    if (!active) return;
    const toggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key !== "\\") return;
      event.preventDefault();
      setCollapsed((value) => !value);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [active]);

  return (
    // Dark only: the window is pure black and every pane is opaque, whatever material the OS offers.
    <div
      className="chat-app"
      data-theme="dark"
      data-glass={info.glass}
      data-os={info.os}
      data-sidebar-collapsed={collapsed}
    >
      <aside className="chat-sidebar" aria-label="Sidebar">
        <SidebarBand collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <ChatList
          active={active}
          onSearch={transport.search && active ? () => setPalette(true) : undefined}
          chats={displayed}
          error={organization.error ?? snapshot.chatsError}
          organization={organization.data}
          archived={archived}
          onShowArchived={workspace ? () => setArchived((value) => !value) : undefined}
          onNewProject={workspace ? () => setProjectDialog({ project: null }) : undefined}
          onProjectSettings={workspace ? (project) => setProjectDialog({ project }) : undefined}
          onChatOptions={workspace ? (chat) => setChatOptions(chat.id) : undefined}
          selected={selected}
          onSelect={setSelected}
          onNewChat={() => {
            setSelected(null);
            setDraft(new NewChatDraft(transport));
          }}
        />
        <AgentDock
          profile={info.profile}
          transport={transport}
          onRefresh={() => void app.refreshAgents()}
          agents={snapshot.agents}
          chats={snapshot.chats}
          onDiagnostics={onDiagnostics}
          onAgents={onAgents}
          onSettings={onSettings}
          onChoose={(agentId) => {
            const next = new NewChatDraft(transport);
            next.chooseAgent(agentId);
            setDraft(next);
            setSelected(null);
          }}
        />
      </aside>
      <main className="chat-main">
        <div className="chat-drag" data-tauri-drag-region="" />
        <Banners
          storage={snapshot.storage}
          env={snapshot.env}
          onRetryEnv={() => void app.retryEnv()}
          recoveryNotice={info.recovery_notice}
          onRecoveryDismissed={onRecoveryDismissed}
          notices={info.notices}
        />
        {selected === null ? (
          <NewChat
            workspace={workspace}
            agents={snapshot.agents}
            refreshing={snapshot.agentsRefreshing}
            draft={draft}
            onRefreshAgents={() => void app.refreshAgents()}
            onCreated={(chat) => {
              app.addChat(chat);
              setSelected(chat.id);
              void workspace?.refresh();
            }}
          />
        ) : (
          <ChatView
            active={active}
            onOpenChat={(id) => {
              setSelected(id);
              void app.reloadChats();
              void workspace?.refresh();
            }}
            key={selected}
            chatId={selected}
            onCommands={setChatCommands}
            transport={transport}
            listed={snapshot.chats?.find((chat) => chat.id === selected) ?? null}
            storage={snapshot.storage}
            agents={snapshot.agents}
          />
        )}
      </main>
      {palette && active ? (
        <CommandPalette
          transport={transport}
          chatId={selected}
          onClose={() => setPalette(false)}
          onChat={setSelected}
          onProject={
            workspace
              ? (id) => {
                  const project = organization.data?.projects.find((project) => project.id === id);
                  if (project) setProjectDialog({ project });
                }
              : undefined
          }
          commands={[
            ...(selected !== null ? chatCommands : []),
            ...(onSettings
              ? [
                  {
                    id: "settings",
                    title: "Open settings",
                    detail: "Preferences and application updates",
                    run: onSettings,
                  },
                ]
              : []),
            {
              id: "new",
              title: "New chat",
              detail: "Choose an agent and project",
              run: () => {
                setSelected(null);
                setDraft(new NewChatDraft(transport));
              },
            },
            ...(workspace
              ? [
                  {
                    id: "project",
                    title: "New project",
                    detail: "Add a folder to your workspace",
                    run: () => setProjectDialog({ project: null }),
                  },
                  {
                    id: "archived",
                    title: archived ? "Show active chats" : "Show archived chats",
                    detail: "Change the sidebar view",
                    run: () => setArchived((value) => !value),
                  },
                ]
              : []),
            {
              id: "agents",
              title: "Refresh agents",
              detail: "Check installed agent availability",
              run: () => {
                void app.refreshAgents();
              },
            },
            {
              id: "sidebar",
              title: collapsed ? "Expand sidebar" : "Collapse sidebar",
              detail: "Make room for the conversation",
              run: () => setCollapsed((value) => !value),
            },
            {
              id: "diagnostics",
              title: "Open diagnostics",
              detail: "Storage and app information",
              run: onDiagnostics,
            },
          ]}
        />
      ) : null}
      {projectDialog && workspace ? (
        <ProjectDialog
          key={`${info.profile?.id}:${projectDialog.project?.id ?? "new"}`}
          project={projectDialog.project}
          profileId={info.profile?.id}
          onLocated={() => app.reloadChats()}
          store={workspace}
          transport={transport}
          agents={snapshot.agents}
          onClose={() => setProjectDialog(null)}
        />
      ) : null}
      {optionsEntry && workspace ? (
        <ChatActionsDialog
          entry={optionsEntry}
          chat={liveById.get(optionsEntry.chat.id) ?? optionsEntry.chat}
          store={workspace}
          transport={transport}
          onChanged={(chat) => {
            app.addChat(chat);
            void app.reloadChats();
          }}
          onClose={() => setChatOptions(null)}
        />
      ) : null}
    </div>
  );
}
