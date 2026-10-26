import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentEntry, ChatSummary, PendingHandoff, StorageStatus } from "../../bindings";
import { ChatStore } from "../../lib/chat/chatStore";
import { errorActions, minutesLabel } from "../../lib/chat/present";
import { hasProcess, hasTurns, lastErrorKey } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { AuthCard } from "./AuthCard";
import { ChangesPanel } from "./ChangesPanel";
import { Composer } from "./Composer";
import { ConversationDialog, type ConversationIntent } from "./ConversationDialog";
import { Header } from "./Header";
import { PermissionCard } from "./PermissionCard";
import { Pickers } from "./Pickers";
import { QueueList } from "./QueueList";
import { Transcript } from "./Transcript";
import type { TurnActions } from "./TurnView";

/**
 * One open chat: its store joins the chat when the view mounts and detaches when it unmounts (the
 * parent keys the view by chat, so each chat gets its own store). Esc interrupts the running turn,
 * and a second Esc force-stops it.
 */
export function ChatView({
  chatId,
  transport,
  listed,
  storage,
  agents,
  onOpenChat,
  active = true,
}: {
  readonly chatId: string;
  readonly transport: Transport;
  /** The chat as the chat list has it, which follows its folder state after the join. */
  readonly listed: ChatSummary | null;
  /** The polled storage status: a failed join retries, and an unsaved gap joins again, on change. */
  readonly storage: StorageStatus | null;
  readonly agents: readonly AgentEntry[] | null;
  readonly onOpenChat?: (id: string) => void;
  readonly active?: boolean;
}) {
  const [store] = useState(() => new ChatStore(chatId, transport));
  const [changesOpen, setChangesOpen] = useState(false);
  const [continuation, setContinuation] = useState<ConversationIntent | null>(null);
  const [handoff, setHandoff] = useState<PendingHandoff | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffLoaded, setHandoffLoaded] = useState(!transport.conversation);
  const [handoffRevision, setHandoffRevision] = useState(0);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.open();
    return () => store.close();
  }, [store]);

  useEffect(() => {
    if (storage !== null) store.storageChanged(storage);
  }, [store, storage]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "j" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setChangesOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented) void store.escape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, active]);

  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  useEffect(() => {
    void status;
    void handoffRevision;
    if (!transport.conversation || state.phase !== "live") return;
    let stale = false;
    setHandoffLoaded(false);
    void transport.conversation
      .pending(chatId)
      .then((value) => {
        if (!stale) {
          setHandoff(value);
          setHandoffError(null);
          setHandoffLoaded(true);
        }
      })
      .catch((error) => {
        if (!stale) setHandoffError(errorMessage(error));
      });
    return () => {
      stale = true;
    };
  }, [transport.conversation, state.phase, chatId, status, handoffRevision]);
  const live = hasProcess(status);
  const resumable =
    (state.session?.native_session_id ?? null) !== null || hasTurns(state.transcript);
  const newestError = lastErrorKey(state.transcript);
  const pendingPermissions = useMemo(
    () =>
      live
        ? [...state.transcript.items.values()].filter(
            (item) =>
              item.kind === "permission" &&
              item.resolution === null &&
              state.requests.get(item.request.request_id)?.gone !== true,
          )
        : [],
    [state.transcript.items, state.requests, live],
  );
  const dockedRequests = useMemo(
    () =>
      new Set(
        pendingPermissions.flatMap((item) =>
          item.kind === "permission" ? [item.request.request_id] : [],
        ),
      ),
    [pendingPermissions],
  );

  const actions = useMemo<TurnActions>(
    () => ({
      blobs: state.blobs,
      onLoadBlob: (sha256) => void store.loadBlob(sha256),
      requests: state.requests,
      onRespondPermission: (requestId, optionId) =>
        void store.respondPermission(requestId, optionId),
      onRespondUi: (requestId, answer) => void store.respondUi(requestId, answer),
      errorActions: (key, kind) =>
        errorActions(kind, { newest: key === newestError, live, resumable }),
      onStart: (fresh) => void store.start(fresh),
      onShowLog: () => void store.revealLog(),
      canResume: !live,
      onContinue: transport.conversation ? (intent) => setContinuation(intent) : undefined,
    }),
    [store, state.blobs, state.requests, newestError, live, resumable, transport.conversation],
  );

  if (state.chat === null) {
    return (
      <div
        className="chat-view"
        data-testid="chat-view"
        data-test-chat-id={chatId}
        data-test-phase={state.phase}
      >
        {state.phase === "failed" ? (
          <div className="chat-centered">
            <p role="alert" className="ui-error" data-testid="chat-attach-error">
              {state.attachError}
            </p>
            <button
              type="button"
              className="ui-button"
              data-testid="chat-reattach"
              onClick={() => void store.reattach()}
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="chat-centered">Opening the chat…</p>
        )}
      </div>
    );
  }

  const agent = agents?.find((entry) => entry.id === state.chat?.agent_id) ?? null;
  // The session's own word, not the marks: which prompts are held is exact only per snapshot.
  const held = state.session?.queue_held === true;
  return (
    <div
      className="chat-view"
      data-testid="chat-view"
      data-test-chat-id={chatId}
      data-test-phase={state.phase}
    >
      <Header
        state={state}
        listed={listed}
        agent={agent}
        resumable={resumable}
        onStart={(fresh) => void store.start(fresh)}
        onStop={() => void store.stop()}
        onShowLog={() => void store.revealLog()}
        onHistory={transport.conversation ? () => setContinuation({ type: "history" }) : undefined}
        changesOpen={changesOpen}
        onChanges={transport.changes ? () => setChangesOpen((open) => !open) : undefined}
      />
      <div className="chat-work-area">
        <div className="chat-conversation">
          {state.phase === "failed" ? (
            <div className="chat-banner" data-level="error">
              <span role="alert" data-testid="chat-attach-error">
                {state.attachError}
              </span>
              <button
                type="button"
                className="ui-button"
                data-testid="chat-reattach"
                onClick={() => void store.reattach()}
              >
                Retry
              </button>
            </div>
          ) : null}
          <Transcript
            dockedRequests={dockedRequests}
            state={state}
            live={live}
            actions={actions}
            onLoadEarlier={() => void store.loadEarlier()}
          />
          <div className="chat-dock">
            {handoff ? (
              <details className="chat-handoff">
                <summary>
                  Next message includes a handoff to{" "}
                  {agents?.find((agent) => agent.id === handoff.agent_id)?.name ?? handoff.agent_id}
                  <span>Preview</span>
                </summary>
                <pre>
                  {handoff.handoff ||
                    (handoff.uses_native_fork
                      ? "Continue from the saved native fork. No extra context will be added."
                      : "No extra context will be added.")}
                </pre>
              </details>
            ) : null}
            {handoffError ? (
              <p className="conversation-notice" role="alert">
                Could not verify the saved handoff. {handoffError}{" "}
                <button
                  type="button"
                  className="ui-button"
                  onClick={() => setHandoffRevision((value) => value + 1)}
                >
                  Retry
                </button>
              </p>
            ) : null}
            {state.auth !== null ? (
              <AuthCard
                auth={state.auth}
                onRetry={() => void (held ? store.resumeQueue() : store.start(false))}
              />
            ) : null}
            {state.stillWorkingMinutes !== null ? (
              <StillWorking
                minutes={state.stillWorkingMinutes}
                onStop={() => void store.interrupt()}
              />
            ) : null}
            <QueueList
              queue={state.queue}
              held={held}
              onRemove={(promptId) => void store.cancelQueued(promptId)}
              onSendQueued={() => void store.resumeQueue()}
            />
            {pendingPermissions.length > 0 ? (
              <section className="chat-permission-dock" aria-label="Waiting for your permission">
                <div className="chat-permission-label">
                  Needs your permission
                  {pendingPermissions.length > 1 ? ` · ${pendingPermissions.length} requests` : ""}
                </div>
                {pendingPermissions.map((item) =>
                  item.kind === "permission" ? (
                    <PermissionCard
                      key={item.key}
                      item={item}
                      request={state.requests.get(item.request.request_id)}
                      onRespond={(optionId) =>
                        void store.respondPermission(item.request.request_id, optionId)
                      }
                      blobs={state.blobs}
                      onLoadBlob={(sha256) => void store.loadBlob(sha256)}
                    />
                  ) : null,
                )}
              </section>
            ) : null}
            <div className="chat-compose-slot" hidden={pendingPermissions.length > 0}>
              <Composer
                blocked={!handoffLoaded || handoffError !== null}
                chatId={chatId}
                contextApi={transport.composer}
                agentName={agent?.name ?? state.chat.agent_name}
                controls={
                  <Pickers
                    agents={agents}
                    onChooseAgent={
                      transport.conversation
                        ? (agent_id) => setContinuation({ type: "switch_agent", agent_id })
                        : undefined
                    }
                    agent={agent}
                    lists={state.lists}
                    autonomy={state.session?.autonomy ?? "full_auto"}
                    status={status}
                    error={state.listsError}
                    optionsSaving={state.optionsSaving}
                    autonomySaving={state.autonomySaving}
                    onSetAutonomy={(autonomy) => void store.setAutonomy(autonomy)}
                    onSetOption={(optionId, value) => void store.setOption(optionId, value)}
                  />
                }
                status={status}
                commands={state.lists?.commands ?? []}
                error={state.sendError}
                onSend={(text, context) => store.send(text, context)}
                onStop={() => void store.interrupt()}
                onForceStop={() => void store.forceStop()}
              />
            </div>
          </div>
        </div>
        {changesOpen && transport.changes ? (
          <ChangesPanel
            state={state}
            composer={transport.composer}
            agent={agent}
            chatId={chatId}
            api={transport.changes}
            status={status}
            transcript={state.transcript}
            onClose={() => setChangesOpen(false)}
            onStop={() => void store.stop()}
          />
        ) : null}
      </div>
      {continuation && transport.conversation ? (
        <ConversationDialog
          chatId={chatId}
          api={transport.conversation}
          initial={continuation}
          agents={agents}
          status={status}
          queued={state.queue.length}
          onStop={() => void store.stop()}
          onClose={() => setContinuation(null)}
          onApplied={async (id) => {
            if (id === chatId) {
              await store.reattach();
              setHandoffRevision((value) => value + 1);
            }
            onOpenChat?.(id);
          }}
        />
      ) : null}
    </div>
  );
}

/** A turn quiet for a minute or more: says so and offers Stop. Nothing is ever stopped by itself. */
export function StillWorking({
  minutes,
  onStop,
}: {
  readonly minutes: number;
  readonly onStop: () => void;
}) {
  return (
    <div className="chat-still" role="status" data-testid="still-working">
      <span>Still working (no output for {minutesLabel(minutes)})</span>
      <button type="button" className="ui-button" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
