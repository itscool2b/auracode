import { ArrowUp, AtSign, Paperclip, Square } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FileMention, SessionStatus, SlashCommand } from "../../bindings";
import { matchingCommands, slashQuery } from "../../lib/chat/present";
import type { ComposerContext, ComposerTransport } from "../../lib/composer";
import { errorMessage } from "../../lib/errors";
import { ContextChips, MentionMenu, useComposerContext } from "./ComposerContext";
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
  onSteer,
  onStop,
  onForceStop,
  controls,
  agentName = "the agent",
  chatId,
  contextApi,
  blocked = false,
}: {
  readonly status: SessionStatus;
  readonly commands: readonly SlashCommand[];
  readonly error: string | null;
  /** Answers whether the text was taken. */
  readonly onSend: (text: string, context?: ComposerContext) => Promise<boolean>;
  readonly onSteer?: (text: string, context?: ComposerContext) => Promise<boolean>;
  readonly onStop: () => void;
  readonly onForceStop: () => void;
  readonly controls?: ReactNode;
  readonly agentName?: string;
  readonly chatId?: string;
  readonly contextApi?: ComposerTransport;
  readonly blocked?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const context = useComposerContext(chatId, contextApi);
  const { text, setText } = context;
  const [mentionItems, setMentionItems] = useState<FileMention[]>([]);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const mentionQuery =
    !menuClosed && contextApi ? text.match(/(?:^|\s)@([^\s]*)$/)?.[1] : undefined;
  useEffect(() => {
    setMentionItems([]);
    setMentionError(null);
    if (!contextApi || !chatId || mentionQuery === undefined) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void contextApi
        .mentions(chatId, mentionQuery)
        .then((items) => {
          if (!disposed) setMentionItems(items);
        })
        .catch((error) => {
          if (!disposed) setMentionError(errorMessage(error));
        });
    }, 120);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [contextApi, chatId, mentionQuery]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The value changes scrollHeight after React commits the textarea.
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(240, Math.max(48, input.current.scrollHeight))}px`;
  }, [text]);
  const fieldId = useId();
  const menuId = useId();
  const mentionId = useId();
  const query = slashQuery(text);
  const matches = query === null || menuClosed ? [] : matchingCommands(commands, query);
  const menuOpen = matches.length > 0;
  const mentionOpen = mentionItems.length > 0 && mentionQuery !== undefined;
  const empty = text.trim() === "" && !context.attachments.length && !context.mentions.length;

  const send = async (steer = false): Promise<void> => {
    if (sending || context.busy || blocked || empty) return;
    if (steer && (!onSteer || status !== "running")) return;
    setSending(true);
    try {
      const sent = {
        text,
        attachments: context.attachments.map((item) => item.id),
        mentions: [...context.mentions],
      };
      const submit = steer && onSteer ? onSteer : onSend;
      const accepted =
        context.attachments.length || context.mentions.length
          ? await submit(text, sent)
          : await submit(text);
      if (accepted) {
        context.consume(sent, steer);
      }
    } finally {
      setSending(false);
    }
  };

  const choose = (command: SlashCommand): void => {
    setText(`/${command.name} `);
    setActive(0);
  };
  const chooseMention = (item: FileMention): void => {
    context.addMention(item.path);
    setText((value) => value.replace(/@[^\s]*$/, ""));
    setMentionItems([]);
    setActive(0);
    input.current?.focus();
  };

  return (
    <div className="chat-composer">
      <ContextChips context={context} />
      {mentionOpen ? (
        <MentionMenu
          id={mentionId}
          items={mentionItems}
          active={Math.min(active, mentionItems.length - 1)}
          onChoose={chooseMention}
        />
      ) : null}
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
        ref={input}
        id={fieldId}
        className="ui-textarea"
        data-testid="composer-input"
        value={text}
        disabled={!context.ready}
        onBlur={() => void context.flush()}
        placeholder={`Message ${agentName}`}
        title="Enter sends, Shift+Enter adds a line, / lists commands"
        aria-controls={mentionOpen ? mentionId : menuOpen ? menuId : undefined}
        onPaste={(event) => {
          if (!contextApi) return;
          const image = Array.from(event.clipboardData.files).find((file) =>
            file.type.startsWith("image/"),
          );
          if (image) {
            event.preventDefault();
            void context.paste(image);
          }
        }}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setMenuClosed(false);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (mentionOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((value) => (value + step + mentionItems.length) % mentionItems.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              const item = mentionItems[Math.min(active, mentionItems.length - 1)];
              if (item) {
                event.preventDefault();
                chooseMention(item);
                return;
              }
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMenuClosed(true);
              return;
            }
          }
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
      <div className="chat-composer-controls">
        {contextApi ? (
          <div className="composer-context-actions">
            <button
              type="button"
              aria-label="Attach a file"
              title="Attach a file, drop one here, or paste an image"
              disabled={context.busy || sending}
              onClick={() => void context.pick()}
            >
              <Paperclip size={16} />
            </button>
            <button
              type="button"
              aria-label="Mention a project file"
              title="Mention a project file"
              onClick={() => {
                setText((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}@`);
                setMenuClosed(false);
                input.current?.focus();
              }}
            >
              <AtSign size={16} />
            </button>
          </div>
        ) : null}
        {controls}
        <div className="chat-composer-actions">
          <StopButton status={status} onStop={onStop} onForceStop={onForceStop} />
          {onSteer && status === "running" ? (
            <button
              type="button"
              className="ui-button"
              data-testid="composer-steer"
              disabled={sending || context.busy || blocked || empty}
              onClick={() => void send(true)}
              title="Send this message to the current running turn"
            >
              Steer
            </button>
          ) : null}
          <button
            type="button"
            className="chat-send"
            data-kind="primary"
            data-testid="composer-send"
            disabled={sending || context.busy || blocked || empty}
            onClick={() => void send()}
            aria-label={
              status === "running" || status === "starting" ? "Queue message" : "Send message"
            }
            title={status === "running" || status === "starting" ? "Queue message" : "Send message"}
          >
            <ArrowUp size={16} strokeWidth={2.25} />
          </button>
        </div>
      </div>
      {error !== null || context.error !== null || mentionError !== null ? (
        <span role="alert" className="ui-error" data-testid="composer-error">
          {context.error ?? mentionError ?? error}
        </span>
      ) : null}
      {context.saveError ? (
        <button type="button" className="ui-button" onClick={() => void context.retrySave()}>
          Retry draft save
        </button>
      ) : null}
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
      <button
        type="button"
        className="chat-send"
        data-testid="composer-stop"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
      >
        <Square size={10} fill="currentColor" strokeWidth={0} />
      </button>
    );
  }
  return null;
}
