import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AgentEntry, ChatSummary, StorageStatus } from "../../bindings";
import { ChatStore } from "../../lib/chat/chatStore";
import { errorActions, minutesLabel } from "../../lib/chat/present";
import { hasProcess, hasTurns, lastErrorKey } from "../../lib/chat/transcript";
import type { Transport } from "../../lib/chat/transport";
import { AuthCard } from "./AuthCard";
import { Composer } from "./Composer";
import { Header } from "./Header";
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
}: {
  readonly chatId: string;
  readonly transport: Transport;
  /** The chat as the chat list has it, which follows its folder state after the join. */
  readonly listed: ChatSummary | null;
  /** The polled storage status: a failed join retries, and an unsaved gap joins again, on change. */
  readonly storage: StorageStatus | null;
  readonly agents: readonly AgentEntry[] | null;
}) {
  const [store] = useState(() => new ChatStore(chatId, transport));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.open();
    return () => store.close();
  }, [store]);

  useEffect(() => {
    if (storage !== null) store.storageChanged(storage);
  }, [store, storage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) void store.escape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);

  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  const live = hasProcess(status);
  const resumable =
    (state.session?.native_session_id ?? null) !== null || hasTurns(state.transcript);
  const newestError = lastErrorKey(state.transcript);

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
    }),
    [store, state.blobs, state.requests, newestError, live, resumable],
  );

  if (state.chat === null) {
    return (
      <div className="chat-view">
        {state.phase === "failed" ? (
          <div className="chat-centered">
            <p role="alert" className="ui-error">
              {state.attachError}
            </p>
            <button type="button" className="ui-button" onClick={() => void store.reattach()}>
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
    <div className="chat-view">
      <Header
        state={state}
        listed={listed}
        agent={agent}
        resumable={resumable}
        onStart={(fresh) => void store.start(fresh)}
        onStop={() => void store.stop()}
        onShowLog={() => void store.revealLog()}
      />
      <Pickers
        lists={state.lists}
        autonomy={state.session?.autonomy ?? "full_auto"}
        status={status}
        error={state.listsError}
        optionsSaving={state.optionsSaving}
        autonomySaving={state.autonomySaving}
        onSetAutonomy={(autonomy) => void store.setAutonomy(autonomy)}
        onSetOption={(optionId, value) => void store.setOption(optionId, value)}
      />
      {state.phase === "failed" ? (
        <div className="chat-banner" data-level="error">
          <span role="alert">{state.attachError}</span>
          <button type="button" className="ui-button" onClick={() => void store.reattach()}>
            Retry
          </button>
        </div>
      ) : null}
      <Transcript
        state={state}
        live={live}
        actions={actions}
        onLoadEarlier={() => void store.loadEarlier()}
      />
      <div className="chat-dock">
        {state.auth !== null ? (
          <AuthCard
            auth={state.auth}
            onRetry={() => void (held ? store.resumeQueue() : store.start(false))}
          />
        ) : null}
        {state.stillWorkingMinutes !== null ? (
          <StillWorking minutes={state.stillWorkingMinutes} onStop={() => void store.interrupt()} />
        ) : null}
        <QueueList
          queue={state.queue}
          held={held}
          onRemove={(promptId) => void store.cancelQueued(promptId)}
          onSendQueued={() => void store.resumeQueue()}
        />
        <Composer
          status={status}
          commands={state.lists?.commands ?? []}
          error={state.sendError}
          onSend={(text) => store.send(text)}
          onStop={() => void store.interrupt()}
          onForceStop={() => void store.forceStop()}
        />
      </div>
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
    <div className="chat-still" role="status">
      <span>Still working (no output for {minutesLabel(minutes)})</span>
      <button type="button" className="ui-button" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
