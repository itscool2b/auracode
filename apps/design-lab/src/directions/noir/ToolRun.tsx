import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  Eye,
  FileText,
  type LucideIcon,
  PencilLine,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, Fragment, memo, useLayoutEffect, useRef, useState } from "react";
import {
  type AnsiColor,
  type AnsiLine,
  type DiffHunk,
  type FileDiff,
  formatDuration,
  type Player,
  type SearchMatch,
  type ToolCallModel,
  type ToolFamily,
  type ToolKind,
  type ToolRunItem,
} from "../../kit";
import { CodeLine } from "./Markdown";
import { languageOf, splitPath } from "./text";
import { DiffStat, Elapsed, Expand, swap, useReduced } from "./ui";

const FAMILY_ICON: Readonly<Record<ToolFamily, LucideIcon>> = {
  explore: Eye,
  edit: PencilLine,
  execute: SquareTerminal,
  other: Wrench,
};

const VERB: Readonly<Record<ToolKind, string>> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  execute: "Run",
  fetch: "Fetch",
  think: "Think",
  switch_mode: "Mode",
  other: "Tool",
};

/** Present-tense verbs, for the line of a run the agent is still working through. */
const ACTIVE_VERB: Readonly<Partial<Record<ToolKind, string>>> = {
  read: "Reading",
  edit: "Editing",
  delete: "Deleting",
  move: "Moving",
  search: "Searching for",
  fetch: "Fetching",
};

/** Diffs this short open by themselves: reading them costs less than a click. */
const SMALL_DIFF_LINES = 12;

/**
 * A call as a present-tense line ("Reading pacing.ts"), even once it is done: while its run is
 * still the agent's latest step, the line stays on what it is doing instead of flickering between
 * "Reading", "Read" and the next "Reading" as calls start and finish.
 */
export function activeLabel(call: ToolCallModel): string {
  if (call.status === "in_progress" || call.status === "pending") return call.label;
  const verb = ACTIVE_VERB[call.kind];
  const target = call.target;
  if (!verb || target === null) return call.label;
  switch (call.kind) {
    case "search":
      return `${verb} "${target}"`;
    case "fetch":
      return `${verb} ${/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(target)?.[1] ?? target}`;
    default:
      return `${verb} ${splitPath(target).name}`;
  }
}

/**
 * One run of tool calls as a step: the summary line, its meta (lines changed, exit code, a live
 * counter), and the calls underneath. Edits show their files at once, and commands their output
 * while they run. Nothing that opened itself folds while its turn is live: a command that passed
 * shrinks to its last four lines instead, and folds only in history.
 */
export const ToolRunStep = memo(function ToolRunStep({
  item,
  player,
  turnLive,
  latest,
}: {
  readonly item: ToolRunItem;
  readonly player: Player;
  /** The run's turn is still running or waiting. */
  readonly turnLive: boolean;
  /** The run is the newest step of a live turn: the agent may still add calls to it. */
  readonly latest: boolean;
}) {
  const reduced = useReduced();
  // A run first seen while its turn was live stays as the reader watched it; one opened from
  // history starts folded.
  const [seenLive] = useState(turnLive);
  const execute = item.family === "execute";
  const automatic =
    item.family === "edit" ||
    (execute && (item.status === "running" || item.status === "failed" || turnLive || seenLive));
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? automatic;
  const Icon = FAMILY_ICON[item.family];
  const working = item.status === "running" || (latest && !execute && item.status !== "waiting");
  const newest = item.calls[item.calls.length - 1];
  const label = working && !execute && newest ? activeLabel(newest) : item.label;
  const fade = swap(reduced);

  return (
    <div
      className="n-step-block"
      data-kind="tools"
      data-family={item.family}
      data-status={item.status}
      data-live={working ? "" : undefined}
    >
      <button
        type="button"
        className="n-step"
        aria-expanded={open}
        onClick={() => setChosen(!open)}
      >
        <span className="n-step-glyph" aria-hidden="true">
          <Icon size={14} strokeWidth={1.6} />
        </span>
        <span className="n-step-label-slot">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={label}
              className="n-step-label"
              data-shimmer={working && !reduced ? "" : undefined}
              initial={fade.initial}
              animate={fade.animate}
              exit={fade.exit}
              transition={fade.transition}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
        <RunMeta item={item} player={player} open={open} />
        <ChevronRight className="n-step-chev" size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <Expand open={open} follow={chosen === true}>
        <div className="n-step-inner">
          {item.family === "edit" ? (
            <EditCalls calls={item.calls} />
          ) : execute ? (
            item.calls.map((call) => (
              <Terminal key={call.id} call={call} player={player} capped={chosen === null} />
            ))
          ) : (
            <CallList calls={item.calls} />
          )}
        </div>
      </Expand>
    </div>
  );
});

function RunMeta({
  item,
  player,
  open,
}: {
  readonly item: ToolRunItem;
  readonly player: Player;
  /** Whether the run's details show: an open terminal keeps its own clock and exit code. */
  readonly open: boolean;
}) {
  if (item.status === "waiting") {
    return (
      <span className="n-step-tag" data-tone="amber">
        Needs approval
      </span>
    );
  }
  if (item.family === "edit") {
    return (
      <span className="n-step-meta">
        <DiffStat added={item.added} removed={item.removed} />
      </span>
    );
  }
  if (item.family === "execute") {
    if (open) return null;
    if (item.status === "running") {
      return (
        <span className="n-step-meta">
          <Elapsed player={player} since={item.startedAt} />
        </span>
      );
    }
    const exit = item.calls[item.calls.length - 1]?.terminal?.exitCode ?? null;
    return <ExitCode code={exit} failed={item.status === "failed"} />;
  }
  if (item.status === "failed")
    return (
      <span className="n-step-tag" data-tone="red">
        Failed
      </span>
    );
  return null;
}

function ExitCode({ code, failed }: { readonly code: number | null; readonly failed: boolean }) {
  const bad = failed || (code !== null && code !== 0);
  if (code === null && !failed) return null;
  return (
    <span className="n-exit" data-bad={bad ? "" : undefined}>
      {bad ? (
        <CircleAlert size={12} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Check size={12} strokeWidth={2} aria-hidden="true" />
      )}
      {code === null ? "Failed" : `exit ${code}`}
    </span>
  );
}

/* ------------------------------------------------------------------------------ explore, other */

function inputField(call: ToolCallModel, name: string): string | null {
  const input = call.rawInput;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function CallList({ calls }: { readonly calls: readonly ToolCallModel[] }) {
  return (
    <ul className="n-calls">
      {calls.map((call) => (
        <li key={call.id} className="n-call" data-status={call.status}>
          <span className="n-call-glyph" aria-hidden="true">
            {call.kind === "search" ? (
              <Search size={14} strokeWidth={1.6} />
            ) : (
              <FileText size={14} strokeWidth={1.6} />
            )}
          </span>
          <span className="n-call-verb">{VERB[call.kind] ?? "Tool"}</span>
          <CallTarget call={call} />
          {call.search ? (
            <span className="n-call-count">
              {call.search.matches.length === 1
                ? "1 result"
                : `${call.search.matches.length} results`}
            </span>
          ) : null}
          {call.search && call.search.matches.length > 0 ? (
            <SearchResults
              matches={call.search.matches}
              pattern={call.search.pattern ?? call.target}
            />
          ) : null}
          {!call.search && call.text ? <pre className="n-call-text">{call.text}</pre> : null}
        </li>
      ))}
    </ul>
  );
}

function CallTarget({ call }: { readonly call: ToolCallModel }) {
  if (call.kind === "search") {
    const where = inputField(call, "path");
    return (
      <span className="n-call-target">
        <span className="n-call-pattern">{call.target ?? call.title}</span>
        {where ? <span className="n-path-dir"> in {where}</span> : null}
      </span>
    );
  }
  const target = call.target ?? call.title;
  const { dir, name } = splitPath(target);
  return (
    <span className="n-call-target" title={target}>
      <span className="n-path-dir">{dir}</span>
      <span className="n-path-name">{name}</span>
    </span>
  );
}

function highlightMatch(text: string, pattern: string | null) {
  if (!pattern) return text;
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
    <Fragment key={index}>
      {index > 0 ? <mark className="n-match">{pattern}</mark> : null}
      {part}
    </Fragment>
  ));
}

function SearchResults({
  matches,
  pattern,
}: {
  readonly matches: readonly SearchMatch[];
  readonly pattern: string | null;
}) {
  return (
    <ol className="n-results">
      {matches.map((match, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: results are positional.
        <li key={index} className="n-result">
          <span className="n-result-where">
            {splitPath(match.path).name}
            {match.line === null ? null : <span className="n-result-line">:{match.line}</span>}
          </span>
          <code className="n-result-text">{highlightMatch(match.text.trim(), pattern)}</code>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------------------- edits */

function diffLines(diff: FileDiff): number {
  return diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
}

function EditCalls({ calls }: { readonly calls: readonly ToolCallModel[] }) {
  const files = calls.flatMap(
    (call): { key: string; call: ToolCallModel; diff: FileDiff | null }[] =>
      call.diffs.length > 0
        ? call.diffs.map((diff) => ({ key: `${call.id}:${diff.path}`, call, diff }))
        : [{ key: call.id, call, diff: null }],
  );
  return (
    <ul className="n-files">
      {files.map(({ key, call, diff }) => (
        <EditFile key={key} call={call} diff={diff} />
      ))}
    </ul>
  );
}

function EditFile({
  call,
  diff,
}: {
  readonly call: ToolCallModel;
  readonly diff: FileDiff | null;
}) {
  const small = diff !== null && !diff.isNew && diffLines(diff) <= SMALL_DIFF_LINES;
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = diff !== null && (chosen ?? small);
  const path = diff?.path ?? call.target ?? call.title;
  const { dir, name } = splitPath(path);
  const running = call.status === "in_progress" || call.status === "pending";

  return (
    <li className="n-file" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="n-file-row"
        aria-expanded={diff === null ? undefined : open}
        disabled={diff === null}
        onClick={() => setChosen(!open)}
      >
        <ChevronRight className="n-file-chev" size={12} strokeWidth={1.8} aria-hidden="true" />
        <span className="n-call-target" title={path}>
          <span className="n-path-dir">{dir}</span>
          <span className="n-path-name">{name}</span>
        </span>
        {diff?.isNew ? <span className="n-step-tag">New</span> : null}
        {running ? <span className="n-file-status">Editing</span> : null}
        {diff ? <DiffStat added={diff.added} removed={diff.removed} /> : null}
      </button>
      <Expand open={open && diff !== null} follow={chosen === true}>
        {diff ? <DiffView diff={diff} /> : null}
      </Expand>
    </li>
  );
}

function DiffView({ diff }: { readonly diff: FileDiff }) {
  const lang = languageOf(diff.path);
  return (
    <div className="n-diff">
      {diff.hunks.map((hunk, index) => (
        <Hunk key={hunk.header} hunk={hunk} lang={lang} first={index === 0} />
      ))}
      {diff.truncated ? <p className="n-diff-note">Too large to show line by line.</p> : null}
    </div>
  );
}

const Hunk = memo(function Hunk({
  hunk,
  lang,
  first,
}: {
  readonly hunk: DiffHunk;
  readonly lang: string;
  readonly first: boolean;
}) {
  return (
    <>
      <div className="n-hunk-head" data-first={first ? "" : undefined}>
        {hunk.header}
      </div>
      {hunk.lines.map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional.
          key={index}
          className="n-diff-line"
          data-op={line.op}
        >
          <span className="n-diff-no" aria-hidden="true">
            {line.oldLine ?? ""}
          </span>
          <span className="n-diff-no" aria-hidden="true">
            {line.newLine ?? ""}
          </span>
          <span className="n-diff-sign" title={SIGN_LABEL[line.op]}>
            {line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}
          </span>
          <span className="n-diff-code">
            <CodeLine text={line.text} lang={lang} />
          </span>
        </div>
      ))}
    </>
  );
});

const SIGN_LABEL = { add: "added", remove: "removed", context: "unchanged" } as const;

/* ---------------------------------------------------------------------------------- terminal */

/* Named terminal colours, tuned to sit on smoked glass: muted, but each still reads at a glance. */
const ANSI_PALETTE: Readonly<Record<string, string>> = {
  black: "#3a3a42",
  red: "#f0938b",
  green: "#8fd8ad",
  yellow: "#e9c97c",
  blue: "#93b4ec",
  magenta: "#d4a8ee",
  cyan: "#8fd0d8",
  white: "rgb(247 247 250 / 0.86)",
  brightBlack: "rgb(247 247 250 / 0.42)",
  brightRed: "#ffaaa3",
  brightGreen: "#ade8c4",
  brightYellow: "#f3dc9b",
  brightBlue: "#b3cbf5",
  brightMagenta: "#e3c4f5",
  brightCyan: "#b0e4ea",
  brightWhite: "#fafafc",
};

function ansiColor(color: AnsiColor | null): string | undefined {
  if (color === null) return undefined;
  return color.startsWith("#") ? color : ANSI_PALETTE[color];
}

/**
 * One styled span. A background (vitest's RUN badge, an inverse span) becomes a tag: the text in
 * the full colour, on a 20% wash of it, so no solid block of colour shouts from the transcript.
 */
export function spanStyle(span: AnsiLine[number]): CSSProperties | undefined {
  let fg = ansiColor(span.fg);
  let bg = ansiColor(span.bg);
  if (span.inverse) [fg, bg] = [bg ?? "#0b0b0d", fg ?? "rgb(247 247 250 / 0.86)"];
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
    color: bg ?? fg,
    backgroundColor: bg ? `color-mix(in oklab, ${bg} 20%, transparent)` : undefined,
    fontWeight: span.bold || bg ? 600 : undefined,
    opacity: span.dim ? 0.62 : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    textDecoration:
      [span.underline ? "underline" : "", span.strikethrough ? "line-through" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    borderRadius: bg ? 4 : undefined,
  };
}

/** Drops the blank lines a command prints before and after its output. */
function trimBlank(lines: readonly AnsiLine[]): readonly AnsiLine[] {
  const blank = (line: AnsiLine): boolean => line.every((span) => span.text.trim() === "");
  let start = 0;
  let end = lines.length;
  while (start < end && blank(lines[start] ?? [])) start += 1;
  while (end > start && blank(lines[end - 1] ?? [])) end -= 1;
  return lines.slice(start, end);
}

/** Marks a scrolled body's edges, so a fade can show there is more above or to the right. */
function markEdges(body: HTMLElement): void {
  if (body.scrollTop > 0) body.dataset.scrolled = "";
  else delete body.dataset.scrolled;
  if (body.scrollLeft + body.clientWidth < body.scrollWidth - 1) body.dataset.wide = "";
  else delete body.dataset.wide;
}

function Terminal({
  call,
  player,
  capped,
}: {
  readonly call: ToolCallModel;
  readonly player: Player;
  /** The run opened by itself: once the command passes, only its last lines stay in view. */
  readonly capped: boolean;
}) {
  const terminal = call.terminal;
  const command = terminal?.command ?? call.target ?? call.title;
  const lines = trimBlank(terminal?.lines ?? []);
  const running = terminal ? terminal.running : call.status === "in_progress";
  const passed = !running && terminal?.exitCode === 0 && call.status !== "failed";
  const [all, setAll] = useState(false);
  const short = capped && passed && !all;
  const bodyRef = useRef<HTMLDivElement>(null);
  const follow = useRef(running || short);
  follow.current = running || short;

  // While output arrives, and while a passed command shrinks to its tail, keep the newest line in
  // view, as a terminal does. A resize observer follows the shrinking height frame by frame.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const settle = (): void => {
      if (follow.current) body.scrollTop = body.scrollHeight;
      markEdges(body);
    };
    settle();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(settle);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (follow.current) body.scrollTop = body.scrollHeight;
    markEdges(body);
  });

  const duration = call.endedAt === null ? null : formatDuration(call.endedAt - call.startedAt);

  return (
    <div className="n-term" data-running={running ? "" : undefined}>
      <div className="n-term-head">
        <span className="n-term-prompt" aria-hidden="true">
          $
        </span>
        <code className="n-term-command">{command}</code>
        <span className="n-term-status">
          {running ? (
            <>
              <span className="n-spinner" aria-hidden="true" />
              <Elapsed player={player} since={call.startedAt} />
            </>
          ) : (
            <>
              <ExitCode code={terminal?.exitCode ?? null} failed={call.status === "failed"} />
              {duration ? <span className="n-term-time n-num">{duration}</span> : null}
            </>
          )}
        </span>
      </div>
      {lines.length > 0 ? (
        <div className="n-term-frame">
          <div
            className="n-term-body"
            ref={bodyRef}
            data-short={short ? "" : undefined}
            onScroll={(event) => markEdges(event.currentTarget)}
          >
            <pre>
              {lines.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines are positional.
                <span key={index} className="n-term-line">
                  {line.map((span, spanIndex) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional.
                      key={spanIndex}
                      style={spanStyle(span)}
                      data-badge={span.bg ? "" : undefined}
                    >
                      {span.text}
                    </span>
                  ))}
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
          {short && lines.length > SHORT_LINES ? (
            <button
              type="button"
              className="n-term-more"
              aria-label={`Show all ${lines.length} lines`}
              title={`Show all ${lines.length} lines`}
              onClick={() => setAll(true)}
            >
              <ChevronsUpDown size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {terminal?.truncated ? (
        <p className="n-term-note">Output cut short. The rest is on disk.</p>
      ) : null}
    </div>
  );
}

/** A passed command's tail: as many lines as noir.css gives `.n-term-body[data-short]`. */
const SHORT_LINES = 4;
