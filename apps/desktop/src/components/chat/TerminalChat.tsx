import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { type TerminalChats, terminalChats } from "./terminalChatRuntime";
import "./terminal-chat.css";

/**
 * A terminal chat: its agent's own interface in auracode's terminal, in place of the transcript
 * and composer. The terminal keeps running while another chat is open; leaving the view only
 * detaches it. Once the agent exits, its output stays readable above Start again and Back to Chat.
 */
export function TerminalChat({
  chatId,
  agentName,
  runtimes = terminalChats,
  onChat,
}: {
  readonly chatId: string;
  readonly agentName: string;
  readonly runtimes?: TerminalChats;
  /** Back to auracode's chat for this chat. */
  readonly onChat: () => void;
}) {
  const runtime = runtimes.get(chatId, agentName);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    runtime.attach(element);
    runtime.focus();
    return () => runtime.detach();
  }, [runtime]);
  const { state } = snapshot;
  const ended = state.state === "finished" || state.state === "failed";
  const endedText =
    state.state === "failed"
      ? state.message
      : state.state === "finished"
        ? `${agentName} exited${
            state.exitCode !== null && state.exitCode !== 0 ? ` with code ${state.exitCode}` : ""
          }.`
        : null;
  return (
    <section
      className="terminal-chat"
      aria-label={`${agentName} in the terminal`}
      data-testid="terminal-chat"
      data-state={state.state}
    >
      {snapshot.omitted.length > 0 ? (
        <p className="chat-banner terminal-chat-note" role="status">
          <span>
            Left out of this terminal: {snapshot.omitted.join("; ")}. They still load in Chat.
          </span>
        </p>
      ) : null}
      <div className="terminal-chat-frame">
        <div className="terminal-chat-screen" ref={frame} />
        {state.state === "idle" || state.state === "starting" ? (
          <p className="terminal-chat-starting" role="status">
            <span className="ui-pulse" aria-hidden="true" />
            Starting {agentName} in the terminal…
          </p>
        ) : null}
      </div>
      {ended ? (
        <div className="terminal-chat-ended" data-testid="terminal-chat-ended">
          <p role={state.state === "failed" ? "alert" : "status"}>{endedText}</p>
          <button
            type="button"
            className="g-button g-button-primary g-button-28"
            onClick={() => void runtime.restart()}
          >
            Start again
          </button>
          <button type="button" className="g-button g-button-ghost g-button-28" onClick={onChat}>
            Back to Chat
          </button>
        </div>
      ) : null}
    </section>
  );
}
