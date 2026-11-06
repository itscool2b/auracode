import { PanelLeft } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppInfo, InstructionsTarget, ProjectSummary } from "../../bindings";
import { availableUpdates, updateNotices, workingChats } from "../../lib/agentUpdates";
import { type AppStore, NewChatDraft } from "../../lib/chat/appStore";
import { newChatAgent, projectChatContext } from "../../lib/chat/newChatContext";
import type { Transport } from "../../lib/chat/transport";
import { navigationTarget } from "../../lib/nativeNavigation";
import {
  agentEditText,
  memoryChats,
  type ProjectMemoryApi,
  projectMemoryApi,
  useAgentMemoryEdits,
} from "../../lib/projectMemory";
import { type SetupApi, setupApi } from "../../lib/setup";
import { TerminalPanels } from "../../lib/terminalPanel";
import { EMPTY_WORKSPACE, type WorkspaceStore } from "../../lib/workspace";
import { type AgentUpdateActions, AgentUpdateBanner } from "./AgentUpdateBanner";
import { Banners } from "./Banners";
import { ChatActionsDialog } from "./ChatActionsDialog";
import { ChatList, projectName } from "./ChatList";
import { ChatView } from "./ChatView";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { NewChat } from "./NewChat";
import { ProjectDialog } from "./ProjectDialog";
import { SidebarFooter } from "./SidebarFooter";
import { createXtermRuntime } from "./terminalRuntime";

const noSubscribe = () => () => {};
const emptyWorkspace = () => EMPTY_WORKSPACE;

/**
 * The sidebar's top band: the collapse toggle at the right (Grok's). The band drags the window and
 * leaves the left to the macOS traffic lights; the logo sits in the footer beside Settings.
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
  onDashboard,
  onSettings,
  onCustomize,
  onInstructions,
  active = true,
  workspace,
  openChatRequest,
  setup = setupApi,
  memory = projectMemoryApi,
  onReviewMemory,
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly info: AppInfo;
  /** The shell acknowledged the database repair, so its notice goes for good. */
  readonly onRecoveryDismissed: () => void;
  readonly onDiagnostics: () => void;
  readonly onAgents?: () => void;
  /** Opens the Dashboard: every chat by what it needs, and what its agent runs. */
  readonly onDashboard?: () => void;
  readonly onSettings?: () => void;
  readonly onCustomize?: (projectId: string | null, activeChatId?: string) => void;
  /** Opens Settings' Instructions on a scope: global, a project folder, or a chat's folder. */
  readonly onInstructions?: (target: InstructionsTarget, chatLabel?: string) => void;
  readonly active?: boolean;
  readonly workspace?: WorkspaceStore;
  readonly openChatRequest?: { id: string };
  /** Settings' saved preferences: New chat starts with the default agent selected. */
  readonly setup?: SetupApi;
  /** Project memory: an agent's direct edit shows a banner with Review and Undo. */
  readonly memory?: ProjectMemoryApi;
  /** Opens Customize > Project memory on a revision, with its changes. */
  readonly onReviewMemory?: (projectId: string, revision: string) => void;
}) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const dismissedUpdates = useSyncExternalStore(
    updateNotices.subscribe,
    updateNotices.getSnapshot,
    updateNotices.getSnapshot,
  );
  // One object for the screen's life, so each notice asks its agent's maintenance once.
  const [updateActions] = useState<AgentUpdateActions>(() => ({
    maintenance: (agentId) => transport.agentMaintenance(agentId),
    update: (agentId) => transport.agentUpdate(agentId),
    refresh: () => app.refreshAgents(),
    openAgents: onAgents,
  }));
  const memoryEdits = useAgentMemoryEdits(memory);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => new NewChatDraft(transport));
  // Settings' default agent, read again whenever the chats come back into view (from Settings).
  const [defaultAgent, setDefaultAgent] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setup.snapshot().then(
      (saved) => {
        if (live) setDefaultAgent(saved.preferences.general.default_agent);
      },
      () => {
        // Without saved preferences New chat simply waits for a choice.
        if (live) setDefaultAgent(null);
      },
    );
    return () => {
      live = false;
    };
  }, [active, setup]);
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
  // Docked terminals belong to the screen, not the open chat, so a chat's shells keep running
  // while another chat shows. Leaving the screen stops them all.
  const [terminals] = useState(() =>
    transport.projectTools ? new TerminalPanels(transport.projectTools, createXtermRuntime) : null,
  );
  useEffect(() => () => void terminals?.dispose(), [terminals]);
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
  // Saved chats first, then the live list, so a chat's current title names its agent's edits.
  const knownChats = memoryChats([
    ...(organization.data?.chats.map((entry) => entry.chat) ?? []),
    ...(snapshot.chats ?? []),
  ]);
  const memoryBanners = memoryEdits.notices.map((notice) => ({
    key: `${notice.projectId}:${notice.revision}`,
    text: agentEditText(
      notice,
      knownChats,
      organization.data?.projects.find((project) => project.id === notice.projectId)?.name ?? null,
    ),
    state: notice.state,
    onReview: onReviewMemory
      ? () => {
          memoryEdits.dismiss(notice);
          onReviewMemory(notice.projectId, notice.revision);
        }
      : undefined,
    onUndo: () => void memoryEdits.undo(notice, knownChats),
    onDismiss: () => memoryEdits.dismiss(notice),
  }));
  const optionsEntry = organization.data?.chats.find((entry) => entry.chat.id === chatOptions);
  const selectedEntry = organization.data?.chats.find((entry) => entry.chat.id === selected);
  const selectedProject =
    organization.data?.projects.find((project) => project.id === selectedEntry?.project_id) ?? null;
  const selectedFolder = selectedProject?.folders.find(
    (folder) => folder.id === selectedEntry?.folder_id,
  );
  // A fresh New chat selects the default agent once detection says it can run here; a choice the
  // person made (the dock, a click) is never replaced.
  const preselected = useRef(new WeakSet<NewChatDraft>());
  useEffect(() => {
    if (selected !== null || defaultAgent === undefined || preselected.current.has(draft)) return;
    const agent = newChatAgent(
      draft.context,
      defaultAgent,
      snapshot.agents,
      draft.getSnapshot().agentId,
    );
    if (agent === "wait") return;
    preselected.current.add(draft);
    if (agent !== null) draft.chooseAgent(agent);
  }, [selected, draft, defaultAgent, snapshot.agents]);
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
    <div
      className="chat-app"
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
          onProjectNewChat={
            workspace
              ? (project) => {
                  if (!organization.data) return;
                  setSelected(null);
                  setArchived(false);
                  setDraft(
                    new NewChatDraft(transport, projectChatContext(project, organization.data)),
                  );
                }
              : undefined
          }
          onCustomize={
            onCustomize
              ? () =>
                  onCustomize(
                    selectedProject?.id ??
                      (selected === null ? draft.context?.projectId : null) ??
                      null,
                    selected ?? undefined,
                  )
              : undefined
          }
          onDashboard={onDashboard}
          onProjectSettings={workspace ? (project) => setProjectDialog({ project }) : undefined}
          onChatOptions={workspace ? (chat) => setChatOptions(chat.id) : undefined}
          selected={selected}
          onSelect={setSelected}
          onNewChat={() => {
            setSelected(null);
            setDraft(new NewChatDraft(transport));
          }}
        />
        <SidebarFooter profile={info.profile} onSettings={onSettings} />
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
          memoryEdits={memoryBanners}
          updates={availableUpdates(snapshot.agents)
            .filter((update) => !dismissedUpdates.has(update.key))
            .map((update) => (
              <AgentUpdateBanner
                key={update.key}
                update={update}
                working={workingChats(snapshot.chats, update.agentId)}
                actions={updateActions}
                onDismiss={() => updateNotices.dismiss(update.key)}
              />
            ))}
        />
        {selected === null ? (
          <NewChat
            key={draft.key}
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
            terminals={terminals}
            transport={transport}
            listed={snapshot.chats?.find((chat) => chat.id === selected) ?? null}
            project={selectedProject?.name ?? null}
            folderLabel={selectedFolder?.display_name ?? null}
            storage={snapshot.storage}
            agents={snapshot.agents}
            onManageAccounts={onAgents}
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
            ...(onInstructions
              ? [
                  {
                    id: "instructions",
                    title: "Edit instructions",
                    detail: "Your user files: one for every agent or one per agent",
                    run: () => onInstructions({ type: "global" }),
                  },
                  ...(selected !== null
                    ? [
                        {
                          id: "chat-instructions",
                          title: "Edit this chat's instructions",
                          detail: "AGENTS.md and CLAUDE.md in the chat's folder",
                          run: () => {
                            const chat = liveById.get(selected);
                            onInstructions(
                              { type: "chat", chat_id: selected },
                              chat
                                ? `This chat: ${projectName(chat.folder)}`
                                : "This chat's folder",
                            );
                          },
                        },
                      ]
                    : []),
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
            ...(onAgents
              ? [
                  {
                    id: "manage-agents",
                    title: "Open agents",
                    detail: "Install, update and sign in to agents",
                    run: onAgents,
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
          onInstructions={
            onInstructions
              ? (folderId) => {
                  setProjectDialog(null);
                  onInstructions({ type: "folder", folder_id: folderId });
                }
              : undefined
          }
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
