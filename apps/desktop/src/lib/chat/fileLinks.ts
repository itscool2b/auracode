/**
 * A chat's files, opened in the person's editor at their line (missing features D, owner's plan of
 * 4 November 2026). Agents name files as `src/app.ts:42`, `src/app.ts#L42` or a Markdown link to
 * the path; answers, tool rows and Changes turn each name into a link once Rust confirms it names a
 * file in the chat's folder (`chat_file_check`), so a name that only looks like a path (`console.log`)
 * stays text. A click asks Rust to open it (`chat_file_open`), in Settings' editor.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { commands, type DetectedEditors, type ProjectEditor } from "../../bindings";
import { settle } from "../ipc";

export interface FileLinkApi {
  /** For each reference, the folder-relative file it names, or `null`. Up to 200 at once. */
  check(chatId: string, references: readonly string[]): Promise<readonly (string | null)[]>;
  /** Opens the file, and answers the editor that opened it. */
  open(
    chatId: string,
    reference: string,
    line: number | null,
    column: number | null,
  ): Promise<ProjectEditor>;
  /** The installed editors, and the one files open in. */
  editors(): Promise<DetectedEditors>;
}

export const fileLinkApi: FileLinkApi = {
  check: (chatId, references) => settle(commands.chatFileCheck(chatId, [...references])),
  open: (chatId, reference, line, column) =>
    settle(commands.chatFileOpen(chatId, reference, line, column)),
  editors: () => settle(commands.editorsDetected()),
};

/** One check names at most this many references, as Rust allows. */
const BATCH = 200;

/** The answer to whether a reference names a file: its folder-relative path, or `null`. */
type Resolution = string | null;

/**
 * Which references name files in one chat's folder. Each is checked once, in batches gathered over
 * a frame; `refresh` forgets the ones that named nothing, so a file the agent wrote since is found.
 */
export class FileResolver {
  private readonly known = new Map<string, Resolution>();
  private readonly waiting = new Set<string>();
  private readonly asked = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private version = 0;

  constructor(
    private readonly chatId: string,
    private readonly api: Pick<FileLinkApi, "check">,
  ) {}

  /** The file `reference` names; `undefined` until it has been checked. */
  peek(reference: string): Resolution | undefined {
    return this.known.get(reference);
  }

  /** Checks `reference` with the next batch, unless it is known or on its way. */
  request(reference: string): void {
    if (this.known.has(reference) || this.asked.has(reference) || this.waiting.has(reference))
      return;
    this.waiting.add(reference);
    this.timer ??= setTimeout(() => this.flush(), 16);
  }

  refresh(): void {
    let changed = false;
    for (const [reference, file] of this.known)
      if (file === null) {
        this.known.delete(reference);
        changed = true;
      }
    if (changed) this.emit();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): number => this.version;

  private flush(): void {
    this.timer = null;
    const batch = [...this.waiting].slice(0, BATCH);
    for (const reference of batch) {
      this.waiting.delete(reference);
      this.asked.add(reference);
    }
    if (this.waiting.size > 0) this.timer = setTimeout(() => this.flush(), 16);
    void this.api
      .check(this.chatId, batch)
      .then(
        (files) => {
          batch.forEach((reference, index) => {
            this.known.set(reference, files[index] ?? null);
          });
        },
        () => {
          // A failed check links nothing now; the next refresh asks again.
          for (const reference of batch) this.known.set(reference, null);
        },
      )
      .finally(() => {
        for (const reference of batch) this.asked.delete(reference);
        this.emit();
      });
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/** What a chat's file links need: whose files, who checks them, and what a click does. */
export interface FileLinks {
  readonly resolver: FileResolver;
  /** The editor that will open the file, for the link's description. */
  readonly editorName: string;
  readonly open: (file: string, line: number | null, column: number | null) => void;
}

/** `null` outside a chat, or when no supported editor is installed: names then stay text. */
export const FileLinkContext = createContext<FileLinks | null>(null);

/** The folder-relative file a reference names in this chat, or `null` (also while checking). */
export function useLinkedFile(reference: string | null): {
  readonly links: FileLinks | null;
  readonly file: string | null;
} {
  const links = useContext(FileLinkContext);
  const resolver = links?.resolver ?? null;
  useSyncExternalStore(resolver?.subscribe ?? noSubscribe, resolver?.snapshot ?? zero, zero);
  const file = reference === null ? undefined : resolver?.peek(reference);
  useEffect(() => {
    if (reference !== null && file === undefined) resolver?.request(reference);
  }, [resolver, reference, file]);
  return { links, file: file ?? null };
}

const noSubscribe = () => () => {};
const zero = () => 0;
