import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { File as FileIcon, Folder, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComposerAttachment, FileMention } from "../../bindings";
import type { ComposerTransport } from "../../lib/composer";
import { composerDraft } from "../../lib/composerDraft";
import { errorMessage } from "../../lib/errors";
import { ChatImageTile } from "./ChatImages";

export function useComposerContext(chatId: string | undefined, api: ComposerTransport | undefined) {
  const [draft] = useState(() => composerDraft(chatId, api));
  const saved = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const { attachments, mentions } = saved;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = useRef(attachments);
  current.current = attachments;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const run = async (action: () => Promise<ComposerAttachment | null>): Promise<void> => {
    if (inFlight.current || !api || !chatId || !draft.getSnapshot().ready) return;
    if (current.current.length >= 8) {
      setError("Send up to eight attachments at a time.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const item = await action();
      if (item) {
        const items = draft.getSnapshot().attachments;
        draft.update({
          attachments: items.some((value) => value.id === item.id) ? items : [...items, item],
        });
      }
    } catch (error) {
      if (active.current) setError(errorMessage(error));
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!chatId || !api || !isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths;
        void (async () => {
          for (const path of paths.slice(0, 8)) {
            if (disposed) break;
            await runRef.current(() => api.import(chatId, path));
          }
        })();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [chatId, api]);

  return {
    attachments,
    mentions,
    text: saved.text,
    ready: saved.ready,
    busy: busy || !saved.ready,
    error: error ?? saved.error,
    saveError: saved.error,
    retrySave: () => (saved.ready ? draft.flush() : draft.load()),
    flush: () => draft.flush(),
    setText: (value: string | ((current: string) => string)) =>
      draft.update({ text: typeof value === "function" ? value(draft.getSnapshot().text) : value }),
    consume: (sent: import("../../bindings").ComposerInput, onlyMatching = false) => {
      draft.consume(sent, onlyMatching);
      setError(null);
    },
    removeAttachment: (id: string) =>
      draft.update({
        attachments: draft.getSnapshot().attachments.filter((item) => item.id !== id),
      }),
    removeMention: (path: string) =>
      draft.update({ mentions: draft.getSnapshot().mentions.filter((item) => item !== path) }),
    addMention: (path: string) => {
      if (mentions.length >= 32 && !mentions.includes(path)) {
        setError("Send up to 32 file mentions at a time.");
        return;
      }
      draft.update({ mentions: mentions.includes(path) ? mentions : [...mentions, path] });
    },
    pick: () => (api && chatId ? run(() => api.pick(chatId)) : Promise.resolve()),
    paste: (file: File) =>
      api && chatId
        ? run(async () => {
            if (file.size > 12 * 1024 * 1024) throw new Error("The image exceeds 12 MiB.");
            return api.paste(chatId, Array.from(new Uint8Array(await file.arrayBuffer())));
          })
        : Promise.resolve(),
  };
}

export function ContextChips({
  context,
}: {
  readonly context: ReturnType<typeof useComposerContext>;
}) {
  if (!context.attachments.length && !context.mentions.length && !context.busy) return null;
  return (
    <section className="composer-context" aria-label="Message context">
      {context.attachments.map((item) =>
        item.image ? (
          <ChatImageTile
            key={item.id}
            image={{ name: item.name, source: { type: "attachment", id: item.id } }}
            onRemove={() => context.removeAttachment(item.id)}
          />
        ) : (
          <span
            className="composer-context-chip"
            key={item.id}
            title={`${item.name} · ${Math.ceil(item.bytes / 1024)} KB`}
          >
            <FileIcon size={14} />
            <span>{item.name}</span>
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={() => context.removeAttachment(item.id)}
            >
              <X size={12} />
            </button>
          </span>
        ),
      )}
      {context.mentions.map((path) => (
        <span className="composer-context-chip" key={path} title={path}>
          <span>@{path}</span>
          <button
            type="button"
            aria-label={`Remove mention ${path}`}
            onClick={() => context.removeMention(path)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {context.busy ? (
        <span className="composer-context-pending" role="status">
          {context.ready
            ? "Preparing attachment…"
            : context.saveError
              ? "Draft unavailable"
              : "Opening draft…"}
        </span>
      ) : null}
    </section>
  );
}

export function MentionMenu({
  id,
  items,
  active,
  onChoose,
}: {
  readonly id: string;
  readonly items: readonly FileMention[];
  readonly active: number;
  readonly onChoose: (item: FileMention) => void;
}) {
  return (
    <section className="composer-mentions" id={id} aria-label="Project files">
      <span className="composer-mentions-heading">Files in this project</span>
      {items.map((item, index) => (
        <button
          type="button"
          key={item.path}
          className={index === active ? "is-active" : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(item)}
        >
          {item.directory ? <Folder size={14} /> : <FileIcon size={14} />}
          <span>{item.path}</span>
        </button>
      ))}
    </section>
  );
}
