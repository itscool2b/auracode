import {
  File,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileTerminal,
  FileText,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { FileLinkContext, useLinkedFile } from "../../lib/chat/fileLinks";

const KINDS: readonly (readonly [LucideIcon, ReadonlySet<string>])[] = [
  [
    FileCode,
    new Set(
      (
        "ts tsx js jsx mjs cjs mts cts rs go py pyi rb java kt kts swift m mm c h cc cpp cxx hpp " +
        "hh cs fs php scala lua dart zig nim ex exs erl hs ml elm clj vue svelte astro html htm " +
        "css scss sass less styl sql graphql gql proto"
      ).split(" "),
    ),
  ],
  [FileJson, new Set(["json", "jsonc", "json5", "ipynb"])],
  [
    FileCog,
    new Set(
      "toml yaml yml ini cfg conf xml plist gradle lock env tf hcl nix editorconfig gitignore".split(
        " ",
      ),
    ),
  ],
  [FileText, new Set(["md", "mdx", "txt", "rst", "adoc", "pdf", "csv", "tsv"])],
  [FileImage, new Set(["svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "avif"])],
  [FileTerminal, new Set(["sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd"])],
];

/** The icon for a file's type, by its extension: code, data, config, text, image or script. */
export function fileIcon(path: string): LucideIcon {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
  return KINDS.find(([, extensions]) => extensions.has(extension))?.[0] ?? File;
}

function described(file: string, line: number | null, editor: string): string {
  return `Open ${file}${line === null ? "" : `, line ${line},`} in ${editor}`;
}

/**
 * A file name an agent wrote, as a link that opens the file at its line in the person's editor,
 * once Rust confirms it names a file in the chat's folder. Until then, and outside a chat or with
 * no editor installed, the name shows as written.
 */
export function FileLink({
  reference,
  line = null,
  column = null,
  icon = true,
  children,
}: {
  readonly reference: string;
  readonly line?: number | null;
  readonly column?: number | null;
  /** The file type's icon before the name; off where the row already shows one. */
  readonly icon?: boolean;
  readonly children: ReactNode;
}) {
  const { links, file } = useLinkedFile(reference);
  if (!links || file === null) return <>{children}</>;
  const Icon = fileIcon(file);
  return (
    <button
      type="button"
      className="file-link"
      data-testid="file-link"
      data-file={file}
      title={described(file, line, links.editorName)}
      onClick={() => links.open(file, line, column)}
    >
      {icon ? <Icon size={13} aria-hidden="true" className="file-link-icon" /> : null}
      {/* Its own words name no further files: a link inside a link is neither. */}
      <FileLinkContext.Provider value={null}>{children}</FileLinkContext.Provider>
    </button>
  );
}

/** Open beside a diff's Copy path: the file in the person's editor, at `line` when known. */
export function OpenFileButton({
  reference,
  line,
}: {
  readonly reference: string;
  readonly line: number | null;
}) {
  const { links, file } = useLinkedFile(reference);
  if (!links || file === null) return null;
  return (
    <button
      type="button"
      className="g-copy"
      data-testid="open-file"
      aria-label={described(file, line, links.editorName)}
      onClick={() => links.open(file, line, null)}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        aria-hidden="true"
      >
        <path d="M7 2h3v3M10 2 5.5 6.5M9 7v2.5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5H5" />
      </svg>
      <span>Open</span>
    </button>
  );
}
