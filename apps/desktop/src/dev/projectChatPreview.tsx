/** Real project-new-chat components with a synthetic plain folder and no native operations. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEntry } from "../bindings";
import { ChatList } from "../components/chat/ChatList";
import { NewChat } from "../components/chat/NewChat";
import { NewChatDraft } from "../lib/chat/appStore";
import { newChatAgent, projectChatContext } from "../lib/chat/newChatContext";
import { FakeTransport } from "../lib/chat/testing";
import { worktreeRecoveryApi } from "../lib/worktreeRecovery";
import { newChatFixture } from "./newChatWorktreeFixture";

const agent: AgentEntry = {
  id: "claude",
  name: "Claude Code",
  description: "Synthetic installed agent",
  availability: { state: "ready", version: "2.1.310", path: "/fixture/claude" },
  launch: "claude",
  needs_download: false,
  last_verified: "2026-11-01",
  installation: null,
  latest_release: null,
};
const transport = new FakeTransport({ pickFolder: async () => null });
const recoveryApi = { ...worktreeRecoveryApi, list: async () => [] };
function Preview() {
  const [fixture] = useState(() => newChatFixture("plain"));
  const state = useSyncExternalStore(fixture.workspace.subscribe, fixture.workspace.getSnapshot);
  const [draft, setDraft] = useState<NewChatDraft | null>(null);
  const [created, setCreated] = useState(false);
  useEffect(() => {
    void fixture.workspace.refresh();
  }, [fixture]);
  return (
    <div className="chat-app" data-os="windows">
      <aside className="chat-sidebar" aria-label="Sidebar">
        <div className="chat-sidebar-band" />
        <ChatList
          chats={[]}
          organization={state.data}
          error={state.error}
          selected={null}
          onSelect={() => {}}
          onCustomize={() => {
            location.href = "/?preview=customize";
          }}
          onNewChat={() => setDraft(new NewChatDraft(transport))}
          onProjectNewChat={(project) => {
            if (!state.data) return;
            const context = projectChatContext(project, state.data);
            const next = new NewChatDraft(transport, context);
            const selected = newChatAgent(context, null, [agent], null);
            if (selected && selected !== "wait") next.chooseAgent(selected);
            setDraft(next);
            setCreated(false);
          }}
        />
      </aside>
      <main className="chat-main">
        <div className="chat-drag" />
        {created ? (
          <p role="status">Chat created in the project folder.</p>
        ) : draft ? (
          <NewChat
            key={draft.key}
            draft={draft}
            agents={[agent]}
            refreshing={false}
            onRefreshAgents={() => {}}
            onCreated={() => setCreated(true)}
            workspace={fixture.workspace}
            worktreeApi={fixture.api}
            recoveryApi={recoveryApi}
          />
        ) : (
          <h1 className="sr-only">Projects</h1>
        )}
      </main>
    </div>
  );
}
export function mountProjectChatPreview(container: HTMLElement) {
  createRoot(container).render(<Preview />);
}
