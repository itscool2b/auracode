import { useId, useState } from "react";
import type { SessionStatus, SlashCommand } from "../../bindings";
import { matchingCommands, slashQuery } from "../../lib/chat/present";
import { SlashMenu } from "./SlashMenu";

/**
 * The message box: Enter sends, Shift+Enter starts a new line; Send, and Stop while a turn runs or
 * starts (Force stop while it cancels). A leading `/` opens the agent's slash commands, filtered by
 * what follows it; choosing one inserts `/name `. Text is sent exactly as typed, and stays when
 * sending fails.
 */
export function Composer({
  status,
  commands,
  error,
  onSend,
  onStop,
  onForceStop,
}: {
  readonly status: SessionStatus;
  readonly commands: readonly SlashCommand[];
  readonly error: string | null;
  /** Answers whether the text was taken. */
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onStop: () => void;
  readonly onForceStop: () => void;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const [sending, setSending] = useState(false);
  const fieldId = useId();
  const menuId = useId();
  const query = slashQuery(text);
  const matches = query === null || menuClosed ? [] : matchingCommands(commands, query);
  const menuOpen = matches.length > 0;

  const send = async (): Promise<void> => {
    if (sending || text.trim() === "") return;
    setSending(true);
    try {
      if (await onSend(text)) setText("");
    } finally {
      setSending(false);
    }
  };

  const choose = (command: SlashCommand): void => {
    setText(`/${command.name} `);
    setActive(0);
  };

  return (
    <div className="chat-composer">
      {menuOpen ? (
        <SlashMenu
          id={menuId}
          commands={matches}
          active={Math.min(active, matches.length - 1)}
          onChoose={choose}
        />
      ) : null}
      <label htmlFor={fieldId} className="sr-only">
        Message
      </label>
      <textarea
        id={fieldId}
        className="ui-textarea"
        data-testid="composer-input"
        value={text}
        placeholder="Message the agent. Enter sends, Shift+Enter adds a line, / lists commands."
        aria-controls={menuOpen ? menuId : undefined}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setMenuClosed(false);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (menuOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((current) => (current + step + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const command = matches[Math.min(active, matches.length - 1)];
              if (command) {
                event.preventDefault();
                choose(command);
                return;
              }
            }
            if (event.key === "Escape") {
              // Closes the menu; the Esc that stops a turn is the next one.
              event.preventDefault();
              setMenuClosed(true);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="ui-row">
        <button
          type="button"
          className="ui-button"
          data-kind="primary"
          data-testid="composer-send"
          disabled={sending || text.trim() === ""}
          onClick={() => void send()}
        >
          Send
        </button>
        <StopButton status={status} onStop={onStop} onForceStop={onForceStop} />
        {error !== null ? (
          <span role="alert" className="ui-error" data-testid="composer-error">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Stop while a turn runs or the agent starts; Force stop while the turn cancels. */
export function StopButton({
  status,
  onStop,
  onForceStop,
}: {
  readonly status: SessionStatus;
  readonly onStop: () => void;
  readonly onForceStop: () => void;
}) {
  if (status === "cancelling") {
    return (
      <button
        type="button"
        className="ui-button"
        data-kind="danger"
        data-testid="composer-force-stop"
        onClick={onForceStop}
      >
        Force stop
      </button>
    );
  }
  if (status === "running" || status === "starting") {
    return (
      <button type="button" className="ui-button" data-testid="composer-stop" onClick={onStop}>
        Stop
      </button>
    );
  }
  return null;
}
