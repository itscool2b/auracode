import { AgentMark } from "@auracode/ui/graphite";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  AgentEntry,
  ChatSummary,
  ManagedWorktree,
  PendingHandoff,
  StorageStatus,
  WorktreeRecreatePreview,
} from "../../bindings";
import { ChatStore } from "../../lib/chat/chatStore";
import { errorActions, minutesLabel } from "../../lib/chat/present";
import { queueWaitView } from "../../lib/chat/queueWait";
import { hasProcess, hasTurns, lastErrorKey } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { sameFolder } from "../../lib/gitWorkspace";
import { inTauri } from "../../lib/ipc";
import type { TerminalPanels } from "../../lib/terminalPanel";
import { PANE_SWIMMERS, Water } from "../Water";
import { ChangesPanel } from "./ChangesPanel";
import { ChatAuthCard } from "./ChatAuthCard";
import { ChatExportDialog } from "./ChatExportDialog";
import type { PaletteCommand } from "./CommandPalette";
import { Composer } from "./Composer";
import { ConversationDialog, type ConversationIntent } from "./ConversationDialog";
import { DebugBundleDialog } from "./DebugBundleDialog";
import { GitDialog } from "./GitDialog";
import { Header } from "./Header";
import { PermissionCard } from "./PermissionCard";
import { Pickers } from "./Pickers";
import { ProjectToolsDialog } from "./ProjectToolsDialog";
import { QuestionCard } from "./QuestionCard";
import { QueueList } from "./QueueList";
import { RecreateWorktreeDialog } from "./RecreateWorktreeDialog";
import { TerminalPanel } from "./TerminalPanel";
import { Transcript } from "./Transcript";
import type { TurnActions } from "./TurnView";
import { isPanelToggle } from "./terminalRuntime";

const noSubscribe = () => () => {};
/** Back to the conversation after the terminal panel hides. */
const focusComposer = () =>
  document.querySelector<HTMLElement>('[data-testid="composer-input"]')?.focus();

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
  onCommands,
  terminals = null,
  now,
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
  /** The chat's own actions, for the command palette: the header menu's items by name. */
  readonly onCommands?: (commands: readonly PaletteCommand[]) => void;
  /** The chat screen's docked terminals; they outlive this view, so shells survive a chat switch. */
  readonly terminals?: TerminalPanels | null;
  /** The store's clock (the still-working hint's); the development previews move it. */
  readonly now?: () => number;
}) {
  const [store] = useState(() => new ChatStore(chatId, transport, now ? { now } : {}));
  const terminalOpen = useSyncExternalStore(
    terminals?.subscribe ?? noSubscribe,
    () => terminals?.panel(chatId).open ?? false,
    () => false,
  );
  const [changesOpen, setChangesOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [dialog, setDialog] = useState<"tools" | "export" | "debug" | null>(null);
  const [continuation, setContinuation] = useState<ConversationIntent | null>(null);
  const [handoff, setHandoff] = useState<PendingHandoff | null>(null);
  const [canContinueHere, setCanContinueHere] = useState(false);
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
      // Ctrl+` (Cmd+` on macOS) shows or hides the terminal panel; with Shift it adds a terminal.
      if (
        terminals &&
        isPanelToggle(event) &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        if (event.shiftKey) void terminals.newTab(chatId);
        else {
          const hiding = terminals.panel(chatId).open;
          terminals.toggle(chatId);
          if (hiding) focusComposer();
        }
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented) void store.escape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, active, terminals, chatId]);

  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  useEffect(() => {
    void status;
    void handoffRevision;
    if (!transport.conversation || state.phase !== "live") return;
    let stale = false;
    setHandoffLoaded(false);
    void Promise.all([
      transport.conversation.pending(chatId),
      transport.conversation.turns(chatId, null),
    ])
      .then(([value, history]) => {
        if (!stale) {
          setHandoff(value);
          setCanContinueHere(history.can_continue_here === true && value === null);
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
  const pendingRequests = useMemo(
    () =>
      live
        ? [...state.transcript.items.values()].filter(
            (item) =>
              (item.kind === "permission" ||
                (item.kind === "question" && item.request.prompt.type !== "notify")) &&
              item.resolution === null &&
              state.requests.get(item.request.request_id)?.gone !== true,
          )
        : [],
    [state.transcript.items, state.requests, live],
  );
  const dockedRequests = useMemo(
    () =>
      new Set(
        pendingRequests.flatMap((item) =>
          item.kind === "permission" || item.kind === "question" ? [item.request.request_id] : [],
        ),
      ),
    [pendingRequests],
  );

  // A start that failed because the folder is missing, where the folder is this chat's app-owned
  // worktree deleted by hand: its card offers the Git workspace's Recreate folder review.
  const newestItem = newestError ? state.transcript.items.get(newestError) : undefined;
  const chatFolder = (listed ?? state.chat)?.folder ?? null;
  const folderMissing =
    (newestItem?.kind === "error" && newestItem.errorKind === "folder_missing") ||
    listed?.folder_state === "missing";
  const [missingTree, setMissingTree] = useState<ManagedWorktree | null>(null);
  const [recreate, setRecreate] = useState<WorktreeRecreatePreview | null>(null);
  const [recreateNote, setRecreateNote] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => {
    const git = transport.git;
    if (!git || !folderMissing || live || chatFolder === null) {
      setMissingTree(null);
      return;
    }
    let current = true;
    git.list(chatId).then(
      (trees) => {
        if (current)
          setMissingTree(
            trees.find((tree) => tree.state === "missing" && sameFolder(tree.path, chatFolder)) ??
              null,
          );
      },
      () => {
        if (current) setMissingTree(null);
      },
    );
    return () => {
      current = false;
    };
  }, [transport.git, chatId, folderMissing, live, chatFolder]);
  useEffect(() => {
    if (live) setRecreateNote(null);
  }, [live]);
  const reviewRecreate = useCallback(async () => {
    if (!transport.git || !missingTree) return;
    setRecreateNote(null);
    try {
      setRecreate(await transport.git.recreatePreview(chatId, missingTree.id));
    } catch (error) {
      setRecreateNote({ text: errorMessage(error), failed: true });
    }
  }, [transport.git, missingTree, chatId]);

  const startSession = useCallback(
    (fresh: boolean) => {
      if (fresh && transport.conversation) setContinuation({ type: "fresh_session" });
      else if (canContinueHere && transport.conversation)
        setContinuation({ type: "continue_here" });
      else void store.start(fresh);
    },
    [store, transport.conversation, canContinueHere],
  );

  // The header menu's actions, by name, for the command palette.
  useEffect(() => {
    if (!onCommands) return;
    const desktop = inTauri();
    const commands: PaletteCommand[] = [
      ...(transport.changes
        ? [
            {
              id: "chat-changes",
              title: changesOpen ? "Hide changes" : "Show changes",
              detail: "The files this chat changed",
              run: () => setChangesOpen((open) => !open),
            },
          ]
        : []),
      ...(transport.git
        ? [
            {
              id: "chat-git",
              title: "Git workspace",
              detail: "Branches, worktrees and pull requests for this chat",
              run: () => setGitOpen(true),
            },
          ]
        : []),
      ...(terminals
        ? [
            {
              id: "chat-terminal",
              title: terminalOpen ? "Hide terminal" : "Show terminal",
              detail: "Shells in this chat's folder, docked under the conversation",
              run: () => terminals.toggle(chatId),
            },
            {
              id: "chat-terminal-new",
              title: "New terminal",
              detail: "Another shell in this chat's folder",
              run: () => void terminals.newTab(chatId),
            },
          ]
        : []),
      ...(desktop
        ? [
            {
              id: "chat-tools",
              title: "Open in editor",
              detail: "Open this chat's folder in a detected editor",
              run: () => setDialog("tools"),
            },
          ]
        : []),
      ...(transport.conversation
        ? [
            {
              id: "chat-history",
              title: "Conversation history",
              detail: "Earlier turns, edits and forks",
              run: () => setContinuation({ type: "history" }),
            },
          ]
        : []),
      ...(desktop
        ? [
            {
              id: "chat-export",
              title: "Export chat",
              detail: "Save this chat as a file",
              run: () => setDialog("export"),
            },
            {
              id: "chat-debug",
              title: "Copy debug bundle",
              detail: "Details to attach to a bug report",
              run: () => setDialog("debug"),
            },
          ]
        : []),
      {
        id: "chat-log",
        title: "Show log",
        detail: "The session's log file",
        run: () => void store.revealLog(),
      },
      ...(live
        ? [
            {
              id: "chat-stop",
              title: "Stop session",
              detail: "End the agent's process for this chat",
              run: () => void store.stop(),
            },
          ]
        : [
            {
              id: "chat-start",
              title: resumable ? "Resume session" : "Start session",
              detail: "Start the agent for this chat",
              run: () => startSession(false),
            },
            ...(resumable
              ? [
                  {
                    id: "chat-fresh",
                    title: "Start fresh",
                    detail: "A new session with a visible handoff",
                    run: () => startSession(true),
                  },
                ]
              : []),
          ]),
    ];
    onCommands(commands);
  }, [
    onCommands,
    transport,
    changesOpen,
    live,
    resumable,
    store,
    startSession,
    terminals,
    terminalOpen,
    chatId,
  ]);
  useEffect(() => () => onCommands?.([]), [onCommands]);

  const actions = useMemo<TurnActions>(
    () => ({
      blobs: state.blobs,
      onLoadBlob: (sha256) => void store.loadBlob(sha256),
      requests: state.requests,
      onRespondPermission: (requestId, optionId) =>
        void store.respondPermission(requestId, optionId),
      onRespondUi: (requestId, answer) => void store.respondUi(requestId, answer),
      errorActions: (key, kind) =>
        errorActions(kind, {
          newest: key === newestError,
          live,
          resumable,
          recreatable: missingTree !== null,
        }),
      onStart: startSession,
      onShowLog: () => void store.revealLog(),
      onRecreateFolder: missingTree ? () => void reviewRecreate() : undefined,
      canResume: !live,
      onContinue: transport.conversation ? (intent) => setContinuation(intent) : undefined,
    }),
    [
      store,
      state.blobs,
      state.requests,
      newestError,
      live,
      resumable,
      transport.conversation,
      startSession,
      missingTree,
      reviewRecreate,
    ],
  );

  const agent = agents?.find((entry) => entry.id === state.chat?.agent_id) ?? null;
  const autonomy = state.session?.autonomy ?? "full_auto";
  // The pickers hold every agent, model and effort choice. Streamed text changes none of them, so
  // the same element is reused until one of their inputs changes, and React skips the subtree.
  const controls = useMemo(
    () => (
      <Pickers
        agents={agents}
        onChooseAgent={
          transport.conversation
            ? (agent_id) => setContinuation({ type: "switch_agent", agent_id })
            : undefined
        }
        agent={agent}
        lists={state.lists}
        autonomy={autonomy}
        status={status}
        error={state.listsError}
        optionsSaving={state.optionsSaving}
        autonomySaving={state.autonomySaving}
        onSetAutonomy={(autonomy) => void store.setAutonomy(autonomy)}
        onSetOption={(optionId, value) => void store.setOption(optionId, value)}
      />
    ),
    [
      agents,
      transport.conversation,
      agent,
      state.lists,
      autonomy,
      status,
      state.listsError,
      state.optionsSaving,
      state.autonomySaving,
      store,
    ],
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
              className="g-button"
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

  // The session's own word, not the marks: which prompts are held is exact only per snapshot.
  const held = state.session?.queue_held === true;
  const agentName = agent?.name ?? state.chat.agent_name;
  // Every real agent can interrupt a turn; until its lists arrive, assume it can.
  const canInterrupt = state.lists?.capabilities?.interrupt !== false;
  const wait = queueWaitView(state.session?.queue_wait, agentName, {
    canInterrupt,
    canRecreate: missingTree !== null,
  });
  const nextQueued = state.queue.find((row) => !row.held)?.prompt_id ?? null;
  // A quiet turn's line offers Send now itself; the queue's head then just says why it waits.
  const stallSendsNow = state.stillWorkingMinutes !== null && nextQueued !== null && canInterrupt;
  const queueWait = stallSendsNow && wait?.action === "send_now" ? { ...wait, action: null } : wait;
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
        onStart={startSession}
        onStop={() => void store.stop()}
        onShowLog={() => void store.revealLog()}
        onHistory={transport.conversation ? () => setContinuation({ type: "history" }) : undefined}
        onGit={transport.git ? () => setGitOpen(true) : undefined}
        onTools={() => setDialog("tools")}
        onTerminal={terminals ? () => terminals.toggle(chatId) : undefined}
        terminalOpen={terminalOpen}
        onExport={() => setDialog("export")}
        onDebug={() => setDialog("debug")}
        changesOpen={changesOpen}
        onChanges={transport.changes ? () => setChangesOpen((open) => !open) : undefined}
      />
      <div className="chat-work-area">
        <div className="chat-conversation">
          {/* A chat with nothing in it yet keeps New chat's lit water behind its composer. */}
          {state.phase === "live" && state.transcript.segments.length === 0 ? (
            <Water className="pane-water" swimmers={PANE_SWIMMERS} />
          ) : null}
          {state.phase === "failed" ? (
            <div className="chat-banner" data-level="error">
              <span role="alert" data-testid="chat-attach-error">
                {state.attachError}
              </span>
              <button
                type="button"
                className="g-button"
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
            {recreateNote ? (
              <p
                className="conversation-notice"
                role={recreateNote.failed ? "alert" : "status"}
                data-testid="recreate-note"
              >
                {recreateNote.text}
              </p>
            ) : null}
            {canContinueHere ? (
              <div className="conversation-notice" role="status">
                <p>
                  New history arrived from another device. Review the context before continuing.
                </p>
                <button
                  type="button"
                  className="g-button"
                  onClick={() => setContinuation({ type: "continue_here" })}
                >
                  Continue here
                </button>
              </div>
            ) : null}
            {handoff ? (
              <details className="chat-handoff">
                <summary>
                  {/* The words name the agent; its mark only shows whose turn comes next. */}
                  <span className="chat-handoff-mark" aria-hidden="true">
                    <AgentMark agent={handoff.agent_id} size={16} />
                  </span>
                  <span className="chat-handoff-text">
                    Next message includes a handoff to{" "}
                    {agents?.find((agent) => agent.id === handoff.agent_id)?.name ??
                      handoff.agent_id}
                  </span>
                  <span className="chat-handoff-preview">Preview</span>
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
                  className="g-button"
                  onClick={() => setHandoffRevision((value) => value + 1)}
                >
                  Retry
                </button>
              </p>
            ) : null}
            {state.auth !== null ? (
              <ChatAuthCard
                key={state.chat.agent_id}
                auth={state.auth}
                agentId={state.chat.agent_id}
                agentName={agent?.name ?? state.chat.agent_name}
                transport={transport}
                onRetry={() => void (held ? store.resumeQueue() : store.start(false))}
              />
            ) : null}
            {state.stillWorkingMinutes !== null ? (
              <StillWorking
                minutes={state.stillWorkingMinutes}
                onStop={() => void store.interrupt()}
                onSendNow={
                  stallSendsNow && nextQueued !== null
                    ? () => void store.sendNow(nextQueued)
                    : undefined
                }
              />
            ) : null}
            <QueueList
              queue={state.queue}
              held={held}
              wait={queueWait}
              onRemove={(promptId) => void store.cancelQueued(promptId)}
              onSendQueued={() => void store.resumeQueue()}
              onSendNow={(promptId) => void store.sendNow(promptId)}
              onStart={() => startSession(false)}
              onRecreate={missingTree ? () => void reviewRecreate() : undefined}
              onLoadText={(promptId) => store.queuedText(promptId)}
              onEdit={(promptId, text) => store.editQueued(promptId, text)}
              onMove={(promptId, index) => store.moveQueued(promptId, index)}
            />
            {pendingRequests.length > 0 ? (
              <section className="chat-permission-dock" aria-label="Waiting for your response">
                <div className="chat-permission-label">
                  Needs your response
                  {pendingRequests.length > 1 ? ` · ${pendingRequests.length} requests` : ""}
                </div>
                {pendingRequests.map((item) => {
                  if (item.kind !== "permission" && item.kind !== "question") return null;
                  const segment = state.transcript.segments.find((entry) =>
                    entry.itemKeys.includes(item.key),
                  );
                  const user = segment?.itemKeys
                    .map((key) => state.transcript.items.get(key))
                    .find((entry) => entry?.kind === "user");
                  return (
                    <div
                      key={item.key}
                      data-test-segment-key={segment?.key}
                      data-test-kind={segment?.turnId ? "turn" : "outside"}
                      data-test-turn-id={segment?.turnId ?? ""}
                      data-test-prompt={user?.kind === "user" ? user.text : ""}
                      data-test-stop-reason={segment?.end?.stopReason ?? ""}
                      data-test-recovered={String(segment?.end?.recovered ?? false)}
                    >
                      <p className="chat-request-scope">
                        {segment?.turnId ? "Turn request" : "Session request"}
                        {user?.kind === "user" ? (
                          <span className="chat-request-prompt" title={user.text}>
                            {user.text.slice(0, 160)}
                          </span>
                        ) : null}
                      </p>
                      {item.kind === "question" ? (
                        <QuestionCard
                          item={item}
                          request={state.requests.get(item.request.request_id)}
                          onRespond={(answer) =>
                            void store.respondUi(item.request.request_id, answer)
                          }
                        />
                      ) : (
                        <PermissionCard
                          item={item}
                          request={state.requests.get(item.request.request_id)}
                          onRespond={(optionId) =>
                            void store.respondPermission(item.request.request_id, optionId)
                          }
                          blobs={state.blobs}
                          onLoadBlob={(sha256) => void store.loadBlob(sha256)}
                        />
                      )}
                    </div>
                  );
                })}
              </section>
            ) : null}
            <div className="chat-compose-slot" hidden={pendingRequests.length > 0}>
              <Composer
                blocked={
                  !handoffLoaded ||
                  canContinueHere ||
                  handoffError !== null ||
                  state.steeringPending
                }
                chatId={chatId}
                contextApi={transport.composer}
                agentName={agent?.name ?? state.chat.agent_name}
                controls={controls}
                status={status}
                commands={state.lists?.commands ?? []}
                error={state.sendError}
                onSend={(text, context) => store.send(text, context)}
                onSteer={
                  state.phase === "live" &&
                  status === "running" &&
                  state.lists?.capabilities?.steer &&
                  transport.composer?.steer &&
                  state.openTurnId
                    ? (text, context) => store.steer(state.openTurnId as string, text, context)
                    : undefined
                }
                onStop={() => void store.interrupt()}
                onForceStop={() => void store.forceStop()}
              />
            </div>
          </div>
          {terminals ? (
            <TerminalPanel chatId={chatId} panels={terminals} onHidden={focusComposer} />
          ) : null}
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
      {dialog === "tools" ? (
        <ProjectToolsDialog key={chatId} chatId={chatId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "export" ? (
        <ChatExportDialog key={chatId} chatId={chatId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "debug" ? (
        <DebugBundleDialog key={chatId} chatId={chatId} onClose={() => setDialog(null)} />
      ) : null}
      {recreate && transport.git ? (
        <RecreateWorktreeDialog
          chatId={chatId}
          review={recreate}
          api={transport.git}
          onClose={() => setRecreate(null)}
          onDone={(value) => {
            setRecreate(null);
            setMissingTree(null);
            setRecreateNote(
              value.error
                ? { text: value.error, failed: true }
                : {
                    text: `The folder is back on ${value.worktree.branch} at its last commit. Uncommitted files from the deleted folder could not be restored. Retry to start ${agent?.name ?? state.chat?.agent_name ?? "the agent"}.`,
                    failed: false,
                  },
            );
            // The chat list reads the folder again, so the header stops calling it missing.
            onOpenChat?.(chatId);
          }}
        />
      ) : null}
      {gitOpen && transport.git ? (
        <GitDialog
          chatId={chatId}
          title={state.chat?.title ?? "work"}
          api={transport.git}
          live={live}
          agentName={agent?.name ?? state.chat?.agent_name}
          // The conflict message goes out as the person's own visible message, exactly as the
          // composer would send it, and only when the composer could send.
          onAskAgent={
            !handoffLoaded || canContinueHere || handoffError !== null || state.steeringPending
              ? undefined
              : async (text) => {
                  if (await store.send(text)) {
                    setGitOpen(false);
                    return null;
                  }
                  return store.getSnapshot().sendError ?? "The message could not be sent.";
                }
          }
          projectTools={transport.projectTools}
          onStop={() => store.stop()}
          onClose={() => setGitOpen(false)}
          onChanged={() => {
            void store.reattach();
            setHandoffRevision((value) => value + 1);
            onOpenChat?.(chatId);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A turn quiet for a minute or more: says so and offers Stop, and Send now when a message waits
 * behind it. Nothing is ever stopped by itself.
 */
export function StillWorking({
  minutes,
  onStop,
  onSendNow,
}: {
  readonly minutes: number;
  readonly onStop: () => void;
  /** Stops the turn and sends the next queued message. */
  readonly onSendNow?: () => void;
}) {
  return (
    <div className="chat-still" role="status" data-testid="still-working">
      <span>Still working (no output for {minutesLabel(minutes)})</span>
      {onSendNow ? (
        <button
          type="button"
          className="g-button g-button-28"
          data-testid="still-working-send-now"
          title="Stop this turn and send the next message"
          onClick={onSendNow}
        >
          Send now
        </button>
      ) : null}
      <button type="button" className="g-button g-button-28" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
