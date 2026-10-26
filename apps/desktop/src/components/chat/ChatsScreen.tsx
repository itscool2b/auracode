import { useOrbitTheme } from "@auracode/ui/orbit";
import { PanelLeft } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppInfo } from "../../bindings";
import { type AppStore, NewChatDraft } from "../../lib/chat/appStore";
import type { Transport } from "../../lib/chat/transport";
import { AgentDock } from "./AgentDock";
import { Banners } from "./Banners";
import { ChatList } from "./ChatList";
import { ChatView } from "./ChatView";
import { NewChat } from "./NewChat";

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
}: {
  readonly app: AppStore;
  readonly transport: Transport;
  readonly info: AppInfo;
  /** The shell acknowledged the database repair, so its notice goes for good. */
  readonly onRecoveryDismissed: () => void;
  readonly onDiagnostics: () => void;
}) {
  const snapshot = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const theme = useOrbitTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => new NewChatDraft(transport));
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    app.start();
    return () => app.stop();
  }, [app]);

  return (
    <div
      className="chat-app orbit-theme"
      data-theme={theme}
      data-glass={info.glass}
      data-sidebar-collapsed={collapsed}
    >
      <aside className="chat-sidebar" aria-label="Sidebar">
        <div className="chat-drag" data-tauri-drag-region="" />
        <button
          type="button"
          className="chat-sidebar-toggle chat-icon-button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <PanelLeft size={16} />
        </button>
        <ChatList
          chats={snapshot.chats}
          error={snapshot.chatsError}
          selected={selected}
          onSelect={setSelected}
          onNewChat={() => {
            setSelected(null);
            setDraft(new NewChatDraft(transport));
          }}
        />
        <AgentDock
          agents={snapshot.agents}
          chats={snapshot.chats}
          onDiagnostics={onDiagnostics}
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
            agents={snapshot.agents}
            refreshing={snapshot.agentsRefreshing}
            draft={draft}
            onRefreshAgents={() => void app.refreshAgents()}
            onCreated={(chat) => {
              app.addChat(chat);
              setSelected(chat.id);
            }}
          />
        ) : (
          <ChatView
            key={selected}
            chatId={selected}
            transport={transport}
            listed={snapshot.chats?.find((chat) => chat.id === selected) ?? null}
            storage={snapshot.storage}
            agents={snapshot.agents}
          />
        )}
      </main>
    </div>
  );
}
