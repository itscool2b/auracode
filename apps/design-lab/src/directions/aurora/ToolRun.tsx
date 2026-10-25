import {
  Check,
  ChevronDown,
  FilePenLine,
  FileText,
  Globe,
  Hourglass,
  ScanSearch,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import { type CSSProperties, Fragment, memo, useLayoutEffect, useRef, useState } from "react";
import {
  type AnsiColor,
  type AnsiSpan,
  basename,
  dirname,
  type FileDiff,
  formatDuration,
  type Player,
  type ToolCallModel,
  type ToolFamily,
  type ToolKind,
  type ToolRunItem,
} from "../../kit";
import { Glass } from "./Glass";
import { languageOf } from "./highlight";
import { Tokens } from "./Markdown";
import { Collapse, cx, DiffStat, Spinner, useBornLive, usePlayheadPast } from "./ui";

const FAMILY_ICON: Readonly<Record<ToolFamily, typeof ScanSearch>> = {
  explore: ScanSearch,
  edit: FilePenLine,
  execute: SquareTerminal,
  other: Wrench,
};

const KIND_ICON: Partial<Readonly<Record<ToolKind, typeof ScanSearch>>> = {
  read: FileText,
  search: Search,
  edit: FilePenLine,
  delete: FilePenLine,
  move: FilePenLine,
  execute: SquareTerminal,
  fetch: Globe,
};

/** A passing command stays open this long after it exits, then folds to its one-line head. */
const FOLD_AFTER_MS = 800;

/** How the user answered the request that held a run: the chip where its time would go. */
export interface RunAnswer {
  readonly allowed: boolean;
  /** "Allowed once", "Rejected", ... */
  readonly label: string;
  /**
   * True when the answer was given here and the recording does not know it: the run then shows
   * what follows (running, or not run) instead of what the recording says.
   */
  readonly local: boolean;
}

/** Whether a call has anything to show when opened. */
function hasDetail(call: ToolCallModel): boolean {
  return (
    call.diffs.length > 0 ||
    (call.terminal !== null && call.terminal.lines.length > 0) ||
    (call.search !== null && call.search.matches.length > 0) ||
    (call.text !== null && call.search === null)
  );
}

/**
 * One group of tool calls ("Read 2 files, searched 1 pattern"). At rest it is one quiet row;
 * opening it draws a well around each call, and each call opens to its diff, terminal output or
 * search results. A command opens itself while it runs, so its output streams in view, stays open
 * if it fails, and folds to its command line shortly after it passes.
 */
export const ToolRun = memo(function ToolRun({
  item,
  player,
  answer = null,
}: {
  readonly item: ToolRunItem;
  readonly player: Player;
  readonly answer?: RunAnswer | null;
}) {
  const local = answer?.local ? answer : null;
  const status =
    local === null
      ? item.status
      : item.status !== "waiting"
        ? item.status
        : local.allowed
          ? "running"
          : "failed";
  const live = status === "running" || status === "waiting";
  const single = item.calls.length === 1 ? item.calls[0] : undefined;
  const execute = item.family === "execute" && single !== undefined;
  const terminal = execute ? (single?.terminal ?? null) : null;
  const passedAt =
    terminal && !terminal.running && (terminal.exitCode ?? 0) === 0
      ? (item.endedAt ?? item.startedAt) + FOLD_AFTER_MS
      : null;
  const folded = usePlayheadPast(player, passedAt);
  const autoOpen =
    terminal !== null &&
    terminal.lines.length > 0 &&
    (terminal.running || (terminal.exitCode ?? 0) !== 0 || !folded);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? autoOpen;
  const expandable = single ? hasDetail(single) : item.calls.length > 0;
  const Icon = FAMILY_ICON[item.family];
  const ended = item.endedAt !== null ? item.endedAt - item.startedAt : null;
  // A command shows as its command line; its exit status and output are the rest.
  const command = execute ? (terminal?.command ?? single?.target ?? single?.title ?? null) : null;

  return (
    <div
      className="au-run"
      data-status={status}
      data-family={item.family}
      data-open={expanded ? "" : undefined}
    >
      <button
        type="button"
        className="au-run-head"
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
        onClick={() => setOpen(!expanded)}
      >
        <span className="au-run-icon">
          {status === "running" ? (
            <Spinner size={14} />
          ) : status === "waiting" ? (
            <Hourglass size={14} strokeWidth={1.75} />
          ) : status === "failed" ? (
            <X size={15} strokeWidth={1.75} />
          ) : (
            <Icon size={15} strokeWidth={1.75} />
          )}
        </span>
        {command ? (
          <span className={cx("au-run-label au-run-cmd", live && !terminal && "au-shimmer")}>
            <span className="au-term-prompt">$</span>
            {command}
          </span>
        ) : (
          <span className={cx("au-run-label", live && "au-shimmer")}>
            {live ? item.label : item.summary}
          </span>
        )}
        {item.added + item.removed > 0 ? (
          <DiffStat added={item.added} removed={item.removed} />
        ) : null}
        <span className="au-run-spacer" />
        {terminal && !answer ? (
          <TermStatus running={terminal.running} exitCode={terminal.exitCode} />
        ) : null}
        {answer ? (
          <span className="au-answer-chip" data-tone={answer.allowed ? "ok" : "bad"}>
            {answer.label}
          </span>
        ) : ended !== null && !live ? (
          <span className="au-run-time">{formatDuration(ended)}</span>
        ) : null}
        {expandable ? (
          <ChevronDown className="au-chevron" data-open={expanded ? "" : undefined} size={15} />
        ) : null}
      </button>
      <Collapse open={expanded && expandable}>
        <Glass level={0} radius={12} className="au-run-well">
          <div className="au-run-body" data-terminal={terminal ? "" : undefined}>
            {single ? (
              <CallDetail call={single} bareTerminal={terminal !== null} />
            ) : (
              item.calls.map((call) => <CallRow key={call.id} call={call} />)
            )}
          </div>
        </Glass>
      </Collapse>
    </div>
  );
});

function CallRow({ call }: { readonly call: ToolCallModel }) {
  const [open, setOpen] = useState(false);
  const detail = hasDetail(call);
  const Icon = KIND_ICON[call.kind] ?? Wrench;
  const running = call.status === "pending" || call.status === "in_progress";
  const path = call.locations[0]?.path ?? (call.kind === "read" ? call.target : null);
  const diff = call.diffs[0];
  return (
    <div className="au-call" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="au-call-head"
        aria-expanded={detail ? open : undefined}
        disabled={!detail}
        onClick={() => setOpen(!open)}
      >
        <span className="au-call-icon">
          {running ? <Spinner size={12} /> : <Icon size={14} strokeWidth={1.75} />}
        </span>
        <span className="au-call-label">{call.label}</span>
        {path && dirname(path) !== "" ? <span className="au-call-dir">{dirname(path)}</span> : null}
        <span className="au-run-spacer" />
        {call.search ? (
          <span className="au-call-meta">
            {call.search.matches.length} {call.search.matches.length === 1 ? "match" : "matches"}
          </span>
        ) : null}
        {diff ? <DiffStat added={diff.added} removed={diff.removed} /> : null}
        {call.status === "failed" ? (
          <X size={13} className="au-call-failed" strokeWidth={2} />
        ) : null}
        {detail ? (
          <ChevronDown className="au-chevron" data-open={open ? "" : undefined} size={14} />
        ) : (
          <Check size={13} className="au-call-done" strokeWidth={2} />
        )}
      </button>
      <Collapse open={open && detail}>
        <div className="au-call-body">
          <CallDetail call={call} />
        </div>
      </Collapse>
    </div>
  );
}

function CallDetail({
  call,
  bareTerminal = false,
}: {
  readonly call: ToolCallModel;
  /** The run's head already shows the command line and status. */
  readonly bareTerminal?: boolean;
}) {
  return (
    <div className="au-call-detail">
      {call.diffs.map((diff) => (
        <DiffView key={diff.path} diff={diff} bare />
      ))}
      {call.terminal ? <TerminalView call={call} bare={bareTerminal} /> : null}
      {call.search && call.search.matches.length > 0 ? <SearchView call={call} /> : null}
      {call.text !== null && call.search === null && call.terminal === null ? (
        <pre className="au-call-text">{call.text}</pre>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ diff */

export function DiffView({
  diff,
  bare = false,
}: {
  readonly diff: FileDiff;
  /** Inside a run's well: the row above names the file and its counts, and the well frames it. */
  readonly bare?: boolean;
}) {
  const language = languageOf(diff.path);
  const dir = dirname(diff.path);
  return (
    <div className="au-diff" data-bare={bare ? "" : undefined}>
      {bare ? null : (
        <div className="au-diff-head">
          <FilePenLine size={13} strokeWidth={2} />
          <span className="au-diff-path">
            {dir ? <span className="au-diff-dir">{dir}/</span> : null}
            <span className="au-diff-base">{basename(diff.path)}</span>
          </span>
          {diff.isNew ? <span className="au-badge">New</span> : null}
          <span className="au-run-spacer" />
          <DiffStat added={diff.added} removed={diff.removed} />
        </div>
      )}
      <div className="au-diff-scroll">
        <div className="au-diff-grid">
          {diff.hunks.map((hunk) => (
            <Fragment key={hunk.header}>
              <div className="au-hunk">
                <span className="au-hunk-text">{hunk.header}</span>
              </div>
              {hunk.lines.map((line, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional.
                  key={index}
                  className="au-dl"
                  data-op={line.op}
                >
                  <span className="au-ln">{line.oldLine ?? ""}</span>
                  <span className="au-ln">{line.newLine ?? ""}</span>
                  <span className="au-sign">
                    {line.op === "add" ? "+" : line.op === "remove" ? "−" : ""}
                  </span>
                  <span className="au-dl-code">
                    {line.text === "" ? " " : <Tokens line={line.text} language={language} />}
                  </span>
                </div>
              ))}
            </Fragment>
          ))}
          {diff.truncated ? (
            <div className="au-hunk">
              <span className="au-hunk-text">Too large to show line by line</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------- terminal */

const ANSI: Readonly<Record<string, string>> = {
  black: "#3a3d48",
  red: "#ff7b72",
  green: "#5fdca0",
  yellow: "#f5c76a",
  blue: "#7aa8ff",
  magenta: "#d59cff",
  cyan: "#6ad8e8",
  white: "#e4e6ee",
  brightBlack: "rgb(255 255 255 / 0.42)",
  brightRed: "#ff9b94",
  brightGreen: "#88f0bf",
  brightYellow: "#ffd98a",
  brightBlue: "#9cc0ff",
  brightMagenta: "#e5b8ff",
  brightCyan: "#8ce8f4",
  brightWhite: "#ffffff",
};

function ansiColor(color: AnsiColor | null): string | undefined {
  if (color === null) return undefined;
  return color.startsWith("#") ? color : ANSI[color];
}

function spanStyle(span: AnsiSpan): CSSProperties | undefined {
  const fgName = span.inverse ? span.bg : span.fg;
  const bgName = span.inverse ? span.fg : span.bg;
  const bg = ansiColor(bgName);
  // Black text only reads on a coloured background; on the dark terminal it becomes dim text.
  const fg = fgName === "black" ? (bg ? "#0b0b10" : "rgb(255 255 255 / 0.42)") : ansiColor(fgName);
  if (
    !fg &&
    !bg &&
    !span.bold &&
    !span.dim &&
    !span.italic &&
    !span.underline &&
    !span.strikethrough
  ) {
    return undefined;
  }
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: span.bold ? 600 : undefined,
    opacity: span.dim ? 0.62 : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    textDecoration: span.underline ? "underline" : span.strikethrough ? "line-through" : undefined,
    borderRadius: bg ? 3 : undefined,
    padding: bg ? "0 1px" : undefined,
  };
}

function TermStatus({
  running,
  exitCode,
}: {
  readonly running: boolean;
  readonly exitCode: number | null;
}) {
  if (running) {
    return (
      <span className="au-term-status" data-tone="live">
        Running
      </span>
    );
  }
  if (exitCode === null) return null;
  return (
    <span className="au-term-status" data-tone={exitCode === 0 ? "ok" : "bad"}>
      {exitCode === 0 ? <Check size={12} strokeWidth={2} /> : <X size={12} strokeWidth={2} />}
      Exit {exitCode}
    </span>
  );
}

function TerminalView({
  call,
  bare = false,
}: {
  readonly call: ToolCallModel;
  readonly bare?: boolean;
}) {
  const terminal = call.terminal;
  const bodyRef = useRef<HTMLDivElement>(null);
  const live = useBornLive();
  const firstNew = useRef(live ? 0 : (terminal?.lines.length ?? 0)).current;
  const lineCount = terminal?.lines.length ?? 0;

  // Output keeps its newest line in view, as a terminal does; the top fades only once lines scroll
  // out of view, so short output shows its first line in full.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || lineCount < 0) return;
    body.scrollTop = body.scrollHeight;
    if (body.scrollHeight > body.clientHeight + 1) body.dataset.overflow = "";
    else delete body.dataset.overflow;
  }, [lineCount]);

  if (!terminal) return null;
  // Leading blank lines carry nothing on screen.
  let skip = 0;
  while (skip < terminal.lines.length && (terminal.lines[skip]?.length ?? 0) === 0) skip += 1;
  return (
    <div className="au-term" data-bare={bare ? "" : undefined}>
      {bare ? null : (
        <div className="au-term-head">
          <span className="au-term-prompt">$</span>
          <span className="au-term-cmd">{terminal.command ?? call.title}</span>
          <span className="au-run-spacer" />
          <TermStatus running={terminal.running} exitCode={terminal.exitCode} />
        </div>
      )}
      <div className="au-term-body" ref={bodyRef}>
        <pre className="au-term-pre">
          {terminal.lines.map((line, index) =>
            index < skip ? null : (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: output lines only append.
                key={index}
                className={cx("au-term-line", index >= firstNew && "au-ink-line")}
              >
                {line.length === 0
                  ? " "
                  : line.map((span, spanIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional.
                      <span key={spanIndex} style={spanStyle(span)}>
                        {span.text}
                      </span>
                    ))}
                {"\n"}
              </span>
            ),
          )}
        </pre>
      </div>
      {terminal.truncated ? (
        <p className="au-term-note">Output trimmed. The full log is on disk.</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------- search */

function highlightMatch(text: string, pattern: string | null) {
  if (!pattern) return text;
  const parts: (string | { readonly mark: string; readonly key: number })[] = [];
  let index = text.indexOf(pattern);
  let cursor = 0;
  while (index !== -1 && pattern.length > 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push({ mark: pattern, key: index });
    cursor = index + pattern.length;
    index = text.indexOf(pattern, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.map((part) =>
    typeof part === "string" ? (
      part
    ) : (
      <mark key={part.key} className="au-mark">
        {part.mark}
      </mark>
    ),
  );
}

function SearchView({ call }: { readonly call: ToolCallModel }) {
  const search = call.search;
  if (!search) return null;
  return (
    <div className="au-search">
      {search.matches.map((match) => (
        <div key={`${match.path}:${match.line}`} className="au-match">
          <span className="au-match-file">{basename(match.path)}</span>
          {match.line !== null ? <span className="au-match-line">{match.line}</span> : null}
          <code className="au-match-text">{highlightMatch(match.text.trim(), search.pattern)}</code>
        </div>
      ))}
    </div>
  );
}
