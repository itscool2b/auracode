import { AgentMark } from "@auracode/ui/graphite";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  AgentEntry,
  ChatSummary,
  ManagedWorktree,
  PendingHandoff,
  StorageStatus,
  WorktreeRecreatePreview,
  WorktreeRun,
} from "../../bindings";
import { takesAccounts } from "../../lib/agentAccounts";
import { ChatStore } from "../../lib/chat/chatStore";
import { FileLinkContext, type FileLinks, FileResolver } from "../../lib/chat/fileLinks";
import { errorActions, minutesLabel } from "../../lib/chat/present";
import { queueWaitView } from "../../lib/chat/queueWait";
import { useReviewComments } from "../../lib/chat/review";
import { newestTurnKey, shownTasks, taskDisplay, tasksByToolCall } from "../../lib/chat/tasks";
import { hasProcess, hasTurns, lastErrorKey } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import { errorMessage } from "../../lib/errors";
import { sameFolder } from "../../lib/gitWorkspace";
import { inTauri } from "../../lib/ipc";
import { editorName } from "../../lib/projectTools";
import type { TerminalPanels } from "../../lib/terminalPanel";
import { runLabel } from "../../lib/worktreeRun";
import { AccountPicker } from "./AccountPicker";
import { BackgroundTasks } from "./BackgroundTasks";
import { ChangesPanel, type RewindRequest } from "./ChangesPanel";
import { ChatAuthCard } from "./ChatAuthCard";
import { ChatExportDialog } from "./ChatExportDialog";
import { ChatImagesProvider } from "./ChatImages";
import { ChatSetup } from "./ChatSetup";
import type { PaletteCommand } from "./CommandPalette";
import { Composer } from "./Composer";
import { ConversationDialog, type ConversationIntent } from "./ConversationDialog";
import { DebugBundleDialog } from "./DebugBundleDialog";
import { GitDialog } from "./GitDialog";
import { Header } from "./Header";
import { PermissionCard } from "./PermissionCard";
import { Pickers } from "./Pickers";
import { planFeedback } from "./PlanCard";
import { ProjectToolsDialog } from "./ProjectToolsDialog";
import { QuestionCard } from "./QuestionCard";
import { QueueList } from "./QueueList";
import { RecreateWorktreeDialog } from "./RecreateWorktreeDialog";
import { TaskPanel } from "./TaskPanel";
import { TerminalPanel } from "./TerminalPanel";
import { Transcript } from "./Transcript";
import type { TurnActions } from "./TurnView";
import { type TaskLink, TaskLinkContext } from "./taskLinks";
import { isPanelToggle } from "./terminalRuntime";
import { UsageLimitCard } from "./UsageLimitCard";

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
  project = null,
  folderLabel = null,
  storage,
  agents,
  onOpenChat,
  active = true,
  onCommands,
  terminals = null,
  now,
  onManageAccounts,
}: {
  readonly chatId: string;
  readonly transport: Transport;
  /** The chat as the chat list has it, which follows its folder state after the join. */
  readonly listed: ChatSummary | null;
  /** The name of the project the chat belongs to, when the workspace knows it. */
  readonly project?: string | null;
  /** Rust's display label for the chat's selected project folder, including managed branches. */
  readonly folderLabel?: string | null;
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
  /** Opens the Agents page, where accounts are added, chosen for new chats and removed. */
  readonly onManageAccounts?: () => void;
}) {
  const [store] = useState(() => new ChatStore(chatId, transport, now ? { now } : {}));
  const terminalOpen = useSyncExternalStore(
    terminals?.subscribe ?? noSubscribe,
    () => terminals?.panel(chatId).open ?? false,
    () => false,
  );
  const [changesOpen, setChangesOpen] = useState(false);
  // Ctrl+F (Cmd+F on macOS) opens find in chat, or focuses its field again.
  const [findRequest, setFindRequest] = useState(0);
  // A Rewind on a sent message: Changes opens on the files before that turn, all selected.
  const [rewind, setRewind] = useState<RewindRequest | null>(null);
  // Comments on Changes' diffs, kept while the panel and this view close, until sent or discarded.
  const [reviewComments, changeReviewComments] = useReviewComments(chatId);
  // The background task the right panel follows; it and the Changes panel share the panel's place.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [gitOpen, setGitOpen] = useState(false);
  // Run, for a worktree chat whose folder setup saved a command. Read again when the Git dialog,
  // where setup is edited, closes.
  const [run, setRun] = useState<WorktreeRun | null>(null);
  useEffect(() => {
    if (gitOpen) return;
    let current = true;
    transport.run?.info(chatId).then(
      (value) => {
        if (current) setRun(value);
      },
      () => {
        if (current) setRun(null);
      },
    );
    return () => {
      current = false;
    };
  }, [transport.run, chatId, gitOpen]);
  const runningTab = useSyncExternalStore(
    terminals?.subscribe ?? noSubscribe,
    () => terminals?.runningTab(chatId) ?? null,
    () => null,
  );
  // What this chat's terminal panel had open when auracode last closed, offered back once.
  useEffect(() => {
    terminals?.restore(chatId);
  }, [terminals, chatId]);
  const startRun = useCallback(() => {
    if (!terminals || !transport.run || !run?.command) return;
    terminals.runTab(
      chatId,
      transport.run.terminal(chatId),
      run.folder,
      `http://localhost:${run.port}`,
    );
  }, [terminals, transport.run, run, chatId]);
  const [dialog, setDialog] = useState<"tools" | "export" | "debug" | null>(null);
  const [continuation, setContinuation] = useState<ConversationIntent | null>(null);
  const [handoff, setHandoff] = useState<PendingHandoff | null>(null);
  const [canContinueHere, setCanContinueHere] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffLoaded, setHandoffLoaded] = useState(!transport.conversation);
  const [handoffRevision, setHandoffRevision] = useState(0);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const setup = state.session?.worktree_setup;
  const setupState = setup?.state;
  const setupGeneration = setup?.generation;
  useEffect(() => {
    void setupGeneration;
    if (
      terminals &&
      setupState &&
      setupState !== "succeeded" &&
      setupState !== "running" &&
      terminals.panel(chatId).tabs.length === 0
    )
      terminals.showReview(chatId);
  }, [terminals, chatId, setupGeneration, setupState]);

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
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setFindRequest((count) => count + 1);
        return;
      }
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

  useEffect(() => {
    if (changesOpen) setOpenTaskId(null);
  }, [changesOpen]);
  const openTask = useCallback((taskId: string) => {
    setChangesOpen(false);
    setOpenTaskId(taskId);
  }, []);
  const tasks = state.transcript.tasks;
  // The transcript's Open actions change only when a call's task or its title does, so a task's
  // progress does not re-render every tool row.
  const linkSignature = JSON.stringify(
    [...tasksByToolCall(tasks)].map(([call, taskId]) => [
      call,
      taskId,
      tasks.get(taskId)?.task.title ?? "",
    ]),
  );
  const taskLinks = useMemo(() => {
    const links = new Map(
      (JSON.parse(linkSignature) as [string, string, string][]).map(
        ([call, taskId, title]) => [call, { taskId, title }] as const,
      ),
    );
    return (toolCallId: string): TaskLink | null => {
      const link = links.get(toolCallId);
      return link ? { title: link.title, open: () => openTask(link.taskId) } : null;
    };
  }, [linkSignature, openTask]);
  const openTaskItem = openTaskId === null ? undefined : tasks.get(openTaskId);
  const openTaskCommand = useMemo(() => {
    const callId = openTaskItem?.task.kind === "command" ? openTaskItem.task.tool_call_id : null;
    const call = callId === null ? undefined : state.transcript.items.get(`tool:${callId}`);
    const input = call?.kind === "tool" ? call.rawInput : null;
    return input !== null && typeof input === "object" && !Array.isArray(input)
      ? typeof input.command === "string"
        ? input.command
        : null
      : null;
  }, [openTaskItem, state.transcript.items]);
  const loadBlob = useCallback((sha256: string) => void store.loadBlob(sha256), [store]);

  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  // File names in the chat open in the person's editor; without one installed they stay text.
  const files = transport.files;
  const [opensIn, setOpensIn] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    files?.editors().then(
      (found) => {
        if (current) setOpensIn(found.opens_in === null ? null : editorName[found.opens_in]);
      },
      () => {
        // Without the list the names stay text, as with no editor installed.
      },
    );
    return () => {
      current = false;
    };
  }, [files]);
  const resolver = useMemo(() => (files ? new FileResolver(chatId, files) : null), [files, chatId]);
  // A turn that ends may have written files its answer names: names that were not files are
  // checked again.
  useEffect(() => {
    if (status === "ready") resolver?.refresh();
  }, [status, resolver]);
  const [fileNote, setFileNote] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => {
    if (!fileNote) return;
    const clear = setTimeout(() => setFileNote(null), fileNote.failed ? 10_000 : 4000);
    return () => clearTimeout(clear);
  }, [fileNote]);
  const fileLinks = useMemo<FileLinks | null>(
    () =>
      files && resolver && opensIn
        ? {
            resolver,
            editorName: opensIn,
            open: (file, line, column) => {
              setFileNote(null);
              files.open(chatId, file, line, column).then(
                (editor) => {
                  setOpensIn(editorName[editor]);
                  setFileNote({ text: `Opened ${file} in ${editorName[editor]}.`, failed: false });
                },
                (failure) => setFileNote({ text: errorMessage(failure), failed: true }),
              );
            },
          }
        : null,
    [files, resolver, opensIn, chatId],
  );
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
  const runningTasks = shownTasks(tasks).filter(
    (item) => taskDisplay(item, live, state.liveTasks) === "running",
  ).length;
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
  // Queue every request, but only the oldest owns the composer. Resolving or withdrawing it
  // reveals the next one, without exposing duplicate controls in the transcript.
  const currentRequest = pendingRequests[0];
  const requestId = currentRequest?.key ?? null;
  const previousRequest = useRef<string | null>(null);
  const requestDock = useRef<HTMLElement>(null);
  useEffect(() => {
    if (requestId === previousRequest.current) return;
    previousRequest.current = requestId;
    if (!active) return;
    const focused = document.activeElement;
    if (
      focused !== document.body &&
      !(
        focused instanceof HTMLElement &&
        focused.closest(".chat-compose-slot, .chat-permission-dock")
      )
    )
      return;
    if (requestId !== null) requestDock.current?.focus();
    else focusComposer();
  }, [requestId, active]);

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

  /**
   * Add to the plan: the note goes into the running turn first, then the plan is declined, so the
   * agent reads the decline and the note together and keeps planning with it. Without steering the
   * note waits in the queue for the next turn.
   */
  const addToPlan = useCallback(
    async (requestId: string, declineOptionId: string, note: string) => {
      const text = planFeedback(note);
      const turn = store.getSnapshot().openTurnId;
      const steerable =
        store.getSnapshot().session?.status === "running" &&
        store.getSnapshot().lists?.capabilities?.steer === true &&
        transport.composer?.steer !== undefined &&
        turn !== null;
      const steered = steerable ? await store.steer(turn as string, text) : false;
      await store.respondPermission(requestId, declineOptionId);
      if (!steered) await store.send(text);
    },
    [store, transport.composer],
  );

  const actions = useMemo<TurnActions>(
    () => ({
      blobs: state.blobs,
      onLoadBlob: (sha256) => void store.loadBlob(sha256),
      requests: state.requests,
      onRespondPermission: (requestId, optionId) =>
        void store.respondPermission(requestId, optionId),
      onAddToPlan: addToPlan,
      agentName:
        agents?.find((entry) => entry.id === state.chat?.agent_id)?.name ?? state.chat?.agent_name,
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
      onOpenChanges: transport.changes ? () => setChangesOpen(true) : undefined,
      onRewind: transport.changes
        ? (turnId) => {
            setRewind((current) => ({ turnId, nonce: (current?.nonce ?? 0) + 1 }));
            setChangesOpen(true);
          }
        : undefined,
    }),
    [
      transport.changes,
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
      addToPlan,
      agents,
      state.chat?.agent_id,
      state.chat?.agent_name,
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
        optionError={state.optionError}
        optionsSaving={state.optionsSaving}
        autonomySaving={state.autonomySaving}
        controlSaving={state.controlSaving}
        transitionBlocked={state.queue.length > 0 || pendingRequests.length > 0}
        onSetControl={transport.setControl ? (change) => void store.setControl(change) : undefined}
        onSetAutonomy={(autonomy) => void store.setAutonomy(autonomy)}
        onSetOption={(optionId, value) => void store.setOption(optionId, value)}
        account={
          transport.accounts && state.chat && takesAccounts(state.chat.agent_id) ? (
            <AccountPicker
              chatId={chatId}
              agentId={state.chat.agent_id}
              agentName={agent?.name ?? state.chat.agent_name}
              status={status}
              runningAccount={state.session?.account_id}
              held={state.session?.queue_held ?? false}
              api={transport.accounts}
              onManage={onManageAccounts}
            />
          ) : null
        }
      />
    ),
    [
      chatId,
      transport.accounts,
      state.chat,
      state.session?.account_id,
      state.session?.queue_held,
      onManageAccounts,
      agents,
      transport.conversation,
      transport.setControl,
      agent,
      state.lists,
      autonomy,
      status,
      state.listsError,
      state.optionError,
      state.optionsSaving,
      state.autonomySaving,
      state.controlSaving,
      state.queue.length,
      pendingRequests.length,
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
    <ChatImagesProvider chatId={chatId} api={transport.images}>
      <FileLinkContext.Provider value={fileLinks}>
        <div
          className="chat-view"
          data-testid="chat-view"
          data-test-chat-id={chatId}
          data-test-phase={state.phase}
        >
          <Header
            state={state}
            listed={listed}
            project={project}
            folderLabel={folderLabel}
            agent={agent}
            resumable={resumable}
            onStart={startSession}
            onStop={() => void store.stop()}
            onShowLog={() => void store.revealLog()}
            onHistory={
              transport.conversation ? () => setContinuation({ type: "history" }) : undefined
            }
            onCompact={
              state.lists?.commands.some((command) => command.name === "compact")
                ? () => void store.send("/compact")
                : undefined
            }
            onGit={transport.git ? () => setGitOpen(true) : undefined}
            onTools={() => setDialog("tools")}
            onTerminal={terminals ? () => terminals.toggle(chatId) : undefined}
            terminalOpen={terminalOpen}
            onExport={() => setDialog("export")}
            onDebug={() => setDialog("debug")}
            changesOpen={changesOpen}
            onChanges={transport.changes ? () => setChangesOpen((open) => !open) : undefined}
            run={
              run?.command && terminals
                ? {
                    label: runLabel(run.command),
                    port: run.port,
                    running: runningTab !== null,
                    onRun: startRun,
                    onStop: () => {
                      if (runningTab) void terminals.closeTab(runningTab);
                    },
                  }
                : undefined
            }
          />
          <div className="chat-work-area">
            <div className="chat-conversation">
              {setup && setup.state !== "succeeded" ? (
                <section className="chat-banner" aria-label="Setup status">
                  <span>
                    {setup.state === "running"
                      ? "Setup is running. You can queue messages below."
                      : (setup.detail ??
                        "Setup is waiting for review. You can queue messages below.")}
                  </span>
                  {terminals ? (
                    <button
                      id={`setup-review-${chatId}`}
                      type="button"
                      className="g-button g-button-24"
                      onClick={() =>
                        setup.state === "running"
                          ? terminals.show(chatId)
                          : terminals.showReview(chatId)
                      }
                    >
                      {setup.state === "running"
                        ? "Show setup terminal"
                        : setup.state === "awaiting"
                          ? "Review setup"
                          : "Retry setup"}
                    </button>
                  ) : null}
                </section>
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
              <TaskLinkContext.Provider value={taskLinks}>
                <Transcript
                  dockedRequests={dockedRequests}
                  state={state}
                  live={live}
                  actions={actions}
                  onLoadEarlier={() => void store.loadEarlier()}
                  findRequest={findRequest}
                />
              </TaskLinkContext.Provider>
              <div className="chat-dock">
                {fileNote ? (
                  <p
                    className="conversation-notice"
                    role={fileNote.failed ? "alert" : "status"}
                    data-testid="file-note"
                  >
                    {fileNote.text}
                  </p>
                ) : null}
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
                {state.auth !== null &&
                state.session?.account_id &&
                takesAccounts(state.chat.agent_id) &&
                transport.accounts ? (
                  // An added account's token was refused: the vendor sign-in would sign in the
                  // agent's own account, so the way on is another account.
                  <UsageLimitCard
                    key={`refused:${state.session.account_id}`}
                    refused
                    limit={{ message: state.auth.message, resets_at: null }}
                    chatId={chatId}
                    agentId={state.chat.agent_id}
                    agentName={agent?.name ?? state.chat.agent_name}
                    accountId={state.session.account_id}
                    api={transport.accounts}
                  />
                ) : state.auth !== null ? (
                  <ChatAuthCard
                    key={state.chat.agent_id}
                    auth={state.auth}
                    agentId={state.chat.agent_id}
                    agentName={agent?.name ?? state.chat.agent_name}
                    transport={transport}
                    onRetry={() => void (held ? store.resumeQueue() : store.start(false))}
                  />
                ) : null}
                {state.session?.usage_limit ? (
                  <UsageLimitCard
                    key={`${state.chat.agent_id}:${state.session.account_id ?? ""}`}
                    limit={state.session.usage_limit}
                    chatId={chatId}
                    agentId={state.chat.agent_id}
                    agentName={agent?.name ?? state.chat.agent_name}
                    accountId={state.session.account_id ?? null}
                    api={takesAccounts(state.chat.agent_id) ? transport.accounts : undefined}
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
                <BackgroundTasks
                  tasks={tasks}
                  turnKey={newestTurnKey(state.transcript.segments)}
                  live={live}
                  liveTasks={state.liveTasks}
                  openTaskId={openTaskItem ? openTaskId : null}
                  onOpen={(taskId) =>
                    openTaskId === taskId ? setOpenTaskId(null) : openTask(taskId)
                  }
                />
                <QueueList
                  queue={state.queue}
                  held={held}
                  wait={queueWait}
                  onRemove={(promptId) => void store.cancelQueued(promptId)}
                  onSendQueued={() => void store.resumeQueue()}
                  onSendNow={(promptId) => void store.sendNow(promptId)}
                  onStart={() => startSession(false)}
                  onRecreate={missingTree ? () => void reviewRecreate() : undefined}
                  onSetup={() => document.getElementById(`setup-review-${chatId}`)?.click()}
                  onLoadText={(promptId) => store.queuedText(promptId)}
                  onEdit={(promptId, text) => store.editQueued(promptId, text)}
                  onMove={(promptId, index) => store.moveQueued(promptId, index)}
                />
                {pendingRequests.length > 0 ? (
                  <section
                    ref={requestDock}
                    tabIndex={-1}
                    className="chat-permission-dock"
                    aria-label="Waiting for your response"
                  >
                    {pendingRequests.slice(0, 1).map((item) => {
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
                              agentName={agent?.name ?? state.chat?.agent_name}
                              onAddToPlan={addToPlan}
                              blobs={state.blobs}
                              onLoadBlob={(sha256) => void store.loadBlob(sha256)}
                            />
                          )}
                          <p className="chat-request-scope">
                            {segment?.turnId ? "Turn request" : "Session request"}
                            {user?.kind === "user" ? (
                              <span className="chat-request-prompt" title={user.text}>
                                {user.text.slice(0, 160)}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      );
                    })}
                    {pendingRequests.length > 1 ? (
                      <p className="chat-request-remaining" role="status">
                        {pendingRequests.length - 1} more{" "}
                        {pendingRequests.length === 2 ? "request" : "requests"} waiting
                      </p>
                    ) : null}
                  </section>
                ) : null}
                <div className="chat-compose-slot" hidden={pendingRequests.length > 0}>
                  <Composer
                    blocked={
                      pendingRequests.length > 0 ||
                      !handoffLoaded ||
                      canContinueHere ||
                      handoffError !== null ||
                      state.steeringPending ||
                      state.controlSaving !== null
                    }
                    chatId={chatId}
                    runningTasks={runningTasks}
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
                <TerminalPanel
                  chatId={chatId}
                  panels={terminals}
                  onHidden={focusComposer}
                  onRun={run?.command ? startRun : undefined}
                  review={
                    setup &&
                    setup.state !== "running" &&
                    setup.state !== "succeeded" &&
                    transport.setup ? (
                      <ChatSetup
                        key={`${chatId}:${setup.generation}`}
                        chatId={chatId}
                        attempt={setup}
                        api={transport.setup}
                        terminals={terminals}
                      />
                    ) : null
                  }
                />
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
                onClose={() => {
                  setChangesOpen(false);
                  setRewind(null);
                }}
                onStop={() => void store.stop()}
                rewind={rewind}
                comments={reviewComments}
                onCommentsChange={changeReviewComments}
                // The comments go out as the person's own message, as the composer would send it.
                onSendReview={async (text) =>
                  (await store.send(text))
                    ? null
                    : (store.getSnapshot().sendError ?? "The message could not be sent.")
                }
                reviewBlocked={
                  pendingRequests.length > 0
                    ? `Answer ${agent?.name ?? state.chat?.agent_name ?? "the agent"}'s ${pendingRequests.length === 1 ? "request" : "requests"} first`
                    : !handoffLoaded ||
                        canContinueHere ||
                        handoffError !== null ||
                        state.steeringPending ||
                        state.controlSaving !== null
                      ? "Sending waits until the chat can take a message"
                      : null
                }
                onEditFrom={
                  transport.conversation
                    ? (turnId) => setContinuation({ type: "edit", turn_id: turnId })
                    : undefined
                }
              />
            ) : openTaskItem && !openTaskItem.placeholder ? (
              <TaskPanel
                item={openTaskItem}
                tasks={tasks}
                command={openTaskCommand}
                live={live}
                liveTasks={state.liveTasks}
                blobs={state.blobs}
                onLoadBlob={loadBlob}
                onOpen={openTask}
                onClose={() => setOpenTaskId(null)}
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
      </FileLinkContext.Provider>
    </ChatImagesProvider>
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
