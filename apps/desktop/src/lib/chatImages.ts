import {
  type ChatImage,
  type ChatImageContext,
  type ChatImagePreview,
  type ChatImageSource,
  commands,
} from "../bindings";
import { settle } from "./ipc";

export interface ChatImagesApi {
  list(chatId: string, context: ChatImageContext): Promise<ChatImage[]>;
  preview(chatId: string, source: ChatImageSource, full: boolean): Promise<ChatImagePreview>;
}

export const chatImagesApi: ChatImagesApi = {
  list: (id, context) => settle(commands.chatMessageImages(id, context)),
  preview: (id, source, full) => settle(commands.chatImagePreview(id, source, full)),
};

type Preview = { readonly url: string; readonly width: number; readonly height: number };
type Entry = { users: number; value?: Preview; promise: Promise<Preview> };

/** Shared within one mounted chat. Idle thumbnails have a bounded LRU; dialogs are never cached. */
export class ImagePreviews {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly api: ChatImagesApi,
    private readonly chatId: string,
  ) {}

  acquire(
    source: ChatImageSource,
    full = false,
  ): { promise: Promise<Preview>; release: () => void } {
    const key = JSON.stringify([source, full]);
    let entry = this.entries.get(key);
    if (!entry) {
      const created: Entry = { users: 0, promise: Promise.resolve(null as unknown as Preview) };
      created.promise = this.api
        .preview(this.chatId, source, full)
        .then((response) => {
          if (this.entries.get(key) !== created) throw new Error("The image preview was closed.");
          if (response.png_base64.length > (full ? 6 : 1) * 1024 * 1024)
            throw new Error("The image preview is too large.");
          const bytes = Uint8Array.from(atob(response.png_base64), (char) => char.charCodeAt(0));
          const value = {
            url: URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
            width: response.width,
            height: response.height,
          };
          created.value = value;
          this.trim();
          return value;
        })
        .catch((error: unknown) => {
          if (this.entries.get(key) === created) this.entries.delete(key);
          throw error;
        });
      entry = created;
      this.entries.set(key, entry);
    }
    // Touch the entry so inactive, older images go first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.users += 1;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        entry.users -= 1;
        if (full && entry.users === 0 && this.entries.get(key) === entry) this.remove(key, entry);
        this.trim();
      },
    };
  }

  private remove(key: string, entry: Entry): void {
    this.entries.delete(key);
    if (entry.value) URL.revokeObjectURL(entry.value.url);
  }

  private trim(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 48) break;
      if (entry.users === 0) this.remove(key, entry);
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.remove(key, entry);
  }
}

/** Local references only. Rust validates the chat root, path components and image contents. */
export function localImagePath(raw: string): string | null {
  let path = raw.trim();
  if (path.startsWith("<") && path.endsWith(">")) path = path.slice(1, -1);
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return null;
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch {
      return null;
    }
  } else {
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
  }
  if (
    !path ||
    path.length > 4096 ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    /^[\\/]{2}/.test(path)
  )
    return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  return path;
}
