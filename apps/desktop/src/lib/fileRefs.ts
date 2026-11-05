/**
 * File references in what agents write: `src/app.ts:42`, `src/app.ts#L42`, `C:\repo\main.rs:12:5`,
 * a Markdown link to a path, or a path in prose. Only reading the text: whether a reference names a
 * file in the chat's folder is Rust's to say (`lib/chat/fileLinks.ts`).
 */
/** A file reference: the path as written, and the place in the file, counted from 1. */
export interface FileRef {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

/** The longest reference looked at; longer text is not a path anyone writes in prose. */
const MAX_REFERENCE = 512;

/** `#L42`, `#L42C7`, `#L42-L50`, as GitHub and Claude's links write a place. */
const HASH_PLACE = /#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/;
/** `:42`, `:42:7`, `:42-50`, as compilers and agents write one. */
const COLON_PLACE = /:(\d+)(?::(\d+))?(?:-\d+(?::\d+)?)?$/;
/** Characters a path in an answer is made of; anything else is code, not a file name. */
const PATH_CHARS = /^[\w.\-+@~[\]\\/]+$/;
/** An extension with a letter in it, so `v1.2.3` and `3.14` are not files. */
const EXTENSION = /\.[\w-]*[A-Za-z][\w-]*$/;
/** Files that are commonly named without an extension. */
const BARE_NAMES = new Set([
  "Makefile",
  "Dockerfile",
  "Containerfile",
  "Justfile",
  "Procfile",
  "Gemfile",
  "Rakefile",
  "Brewfile",
  "LICENSE",
  "README",
  "CODEOWNERS",
]);
/**
 * Extensions a bare name (no folder, no line) needs before it is checked, since `os.path` or
 * `self.value` read the same way: the common source, config and document types.
 */
const BARE_EXTENSIONS = new Set(
  (
    "ts tsx js jsx mjs cjs mts cts json jsonc json5 md mdx txt rst rs go py pyi rb java kt kts " +
    "swift m mm c h cc cpp cxx hpp hh cs fs php scala lua dart zig nim ex exs erl hs ml elm clj " +
    "vue svelte astro html htm css scss sass less styl sql graphql gql proto toml yaml yml ini " +
    "cfg conf xml plist gradle sh bash zsh fish ps1 psm1 bat cmd lock env example sample " +
    "svg png jpg jpeg gif webp ico pdf csv tsv ipynb tf hcl nix dockerfile gitignore gitattributes " +
    "editorconfig npmrc nvmrc prettierrc eslintrc babelrc"
  ).split(" "),
);

function place(text: string): FileRef {
  for (const pattern of [HASH_PLACE, COLON_PLACE]) {
    const found = pattern.exec(text);
    if (found) {
      const line = Number(found[1]);
      const column = found[2] === undefined ? null : Number(found[2]);
      return {
        path: text.slice(0, found.index),
        line: line > 0 ? line : null,
        column: column !== null && column > 0 ? column : null,
      };
    }
  }
  return { path: text, line: null, column: null };
}

function lastPart(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

/** A drive letter (`C:\`) is the only colon a path keeps once its place is read. */
function withoutDrive(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.slice(2) : path;
}

/** Whether `ref` reads as a path, as inline code or prose writes one. */
function readsAsPath(ref: FileRef, prose: boolean): boolean {
  const { path } = ref;
  const rest = withoutDrive(path);
  if (!path || path.length > MAX_REFERENCE || !PATH_CHARS.test(rest)) return false;
  if (/^[-@~]/.test(path) || /[\\/]$/.test(path) || path.includes("//")) return false;
  const name = lastPart(path);
  const extension = EXTENSION.exec(name);
  const named = extension !== null || BARE_NAMES.has(name);
  if (!named) return false;
  const folder = /[\\/]/.test(path);
  // In prose a path needs a folder or a line: "Node.js" and "e.g." are words there.
  if (prose) return folder || ref.line !== null;
  if (folder || ref.line !== null || BARE_NAMES.has(name)) return true;
  return BARE_EXTENSIONS.has((extension?.[0] ?? "").slice(1).toLowerCase());
}

/** The file inline code names, as `src/app.ts`, `app.ts:42` or `C:\repo\main.rs:12:5`. */
export function codeFileRef(text: string): FileRef | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes("://")) return null;
  const ref = place(trimmed);
  return readsAsPath(ref, false) ? ref : null;
}

function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * The file a Markdown link's target names: a relative or absolute path, or a `file:` URL, with a
 * place after `#L` or a colon. Web links (http, mailto and the rest) name none.
 */
export function hrefFileRef(href: string): FileRef | null {
  let target = href.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(target);
  if (scheme) {
    if (scheme[1]?.toLowerCase() !== "file") return null;
    target = target.replace(/^file:\/\/(localhost)?/i, "");
    // `file:///C:/repo` names `C:/repo`.
    if (/^\/[A-Za-z]:[\\/]/.test(target)) target = target.slice(1);
  }
  // A place goes on the raw target, so an escaped `#` in a name stays part of it.
  const ref = place(target);
  const path = decoded(ref.path);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
  if (!path || path.length > MAX_REFERENCE || /[\u0000-\u001f]/.test(path)) return null;
  if (path.startsWith("#") || /[\\/]$/.test(path)) return null;
  return { ...ref, path };
}

/** Path-like runs in prose: path characters with a dot or slash, then a place. */
const PROSE_RUN =
  /(?:[A-Za-z]:[\\/])?[\w@.+~\-\\/]*[\\/.][\w@.+~\-\\/]*(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?/g;
/** What may not touch a path in prose: a URL's `//`, a word or another path. */
const BEFORE = /[\w./\\@:-]/;
const AFTER = /[\w/\\]/;

/** A file named in prose, where it starts and ends in the text. */
export interface ProseFileRef {
  readonly start: number;
  readonly end: number;
  readonly ref: FileRef;
}

/** The files prose names: paths with a folder (`src/app.ts`) or a line (`app.ts:42`). */
export function proseFileRefs(text: string): ProseFileRef[] {
  if (!/[\\/:.]/.test(text)) return [];
  const found: ProseFileRef[] = [];
  for (const match of text.matchAll(PROSE_RUN)) {
    const start = match.index;
    let run = match[0];
    // A sentence's full stop is not part of the name.
    while (run.endsWith(".")) run = run.slice(0, -1);
    const end = start + run.length;
    if (!run || BEFORE.test(text[start - 1] ?? "") || AFTER.test(text[end] ?? "")) continue;
    const ref = place(run);
    if (readsAsPath(ref, true)) found.push({ start, end, ref });
  }
  return found;
}
