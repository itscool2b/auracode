import {
  Check,
  ChevronRight,
  Copy,
  FileDiff,
  FileMinus,
  FilePenLine,
  FilePlus,
  FileText,
  Globe,
  Maximize2,
  Minimize2,
  Search,
  Square,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, type ReactNode, useState } from "react";
import {
  type AnsiColor,
  type AnsiLine,
  type DiffHunk,
  type DiffLine,
  type FileDiff as FileDiffModel,
  type Player,
  type SearchMatch,
  stripAnsi,
  type ToolCallModel,
  type ToolKind,
  type ToolRunItem,
} from "../../kit";
import { changedMiddle, formatSeconds, splitPath, testSummary, toolParts } from "./text";
import { DiffCounts, DiffSquares, DotLoader, Elapsed, IconButton, Shimmer, useReduced } from "./ui";

/*
 * Tool calls (visual-language.md 4.4): one call is a 28px row, the verb in sans and the object as a
 * literal in mono (Grok), muted like Cursor's lines, the tense telling the state (Aside: "Reading",
 * then "Read"). Consecutive calls collapse into one summary row with a hanging chevron (Claude Code);
 * opened, the calls hang off a 1px spine (Legora). A call opens into a well: a terminal, a diff, or
 * search results. Every row keeps its icon (or the agent's live mark) in a 22px gutter and its words
 * from x 22, so a live line can hand over to the next without the words moving. A command opens in
 * place: its row is the block's header, and its output unfolds below it.
 */

const ICONS: Readonly<Record<ToolKind, typeof FileText>> = {
  read: FileText,
  edit: FilePenLine,
  delete: FileMinus,
  move: FilePenLine,
  search: Search,
  execute: SquareTerminal,
  fetch: Globe,
  think: Wrench,
  switch_mode: Wrench,
  other: Wrench,
};

function iconFor(call: ToolCallModel) {
  if (call.kind === "edit" && call.diffs.some((diff) => diff.isNew)) return FilePlus;
  return ICONS[call.kind] ?? Wrench;
}

const isRunning = (call: ToolCallModel): boolean =>
  call.status === "pending" || call.status === "in_progress";

/**
 * A path as its folder in text-3 and its name in text-1. When space runs out the folder gives way,
 * from its start ("…/orb/pacing.ts"), and the file name never does; the full path is the tooltip.
 */
export function PathLabel({ path }: { readonly path: string }) {
  const { dir, name } = splitPath(path);
  return (
    <span className="o-path" title={path}>
      {dir ? (
        <span className="o-path-dir o-c3">
          <bdi>{dir}</bdi>
        </span>
      ) : null}
      <span className="o-path-name o-c1">{name}</span>
    </span>
  );
}

/** A fold's open and close: height and opacity over --o-dock, a 120ms fade under reduced motion. */
function fold(reduced: boolean) {
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: reduced ? 0.12 : 0.26, ease: [0.23, 1, 0.32, 1] as const },
  };
}

/* ------------------------------------------------------------------------------- the rows */

export interface ToolRunProps {
  readonly run: ToolRunItem;
  readonly player: Player;
  /** The run belongs to a turn that is still going: live verbs and loaders. */
  readonly live: boolean;
  /** The turn was stopped by the user: a command it cut short reads as stopped, not failed. */
  readonly stopped?: boolean;
  /** Calls the user turned down here (by tool call id). */
  readonly denied?: ReadonlySet<string>;
  /** Calls that waited on an answer, and when they actually began to run. */
  readonly runFrom?: ReadonlyMap<string, number>;
  /** The agent's live mark: in the gutter of the live row, in place of its icon. */
  readonly mark?: ReactNode;
  readonly onOpenChanges?: (path: string) => void;
  readonly onCopy?: (text: string, done: string) => void;
}

/** The call a running group is on now: the last one still running, else its last. */
function liveCall(run: ToolRunItem): ToolCallModel | null {
  const running = [...run.calls].reverse().find(isRunning);
  return running ?? run.calls[run.calls.length - 1] ?? null;
}

/** A run of tool calls: one row, or a summary row that opens onto its calls. */
export const ToolRun = memo(function ToolRun(props: ToolRunProps) {
  const { run } = props;
  const reduced = useReduced();
  const [open, setOpen] = useState(false);
  if (run.calls.length === 1 && run.calls[0]) {
    const call = run.calls[0];
    return call.kind === "execute" ? (
      <CommandCall {...props} call={call} />
    ) : (
      <CallRow {...props} call={call} />
    );
  }
  const running = props.live && run.status === "running";
  const marked = running && props.mark;
  const duration = run.endedAt !== null ? formatSeconds(run.endedAt - run.startedAt) : null;
  // While a group runs, its row names the call it is on, as Grok's label and literal.
  const current = running ? liveCall(run) : null;
  const currentParts = current ? toolParts(current) : null;
  return (
    <div className="o-tool-group" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="o-tool-row o-tool-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="o-gutter">
          {marked ? (
            props.mark
          ) : (
            <ChevronRight className="o-tool-chev" size={12} strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <span className="o-tool-text o-t-ui">
          {currentParts ? (
            <>
              <span className="o-tool-verb">
                <Shimmer>{currentParts.verb}</Shimmer>
              </span>
              {currentParts.object ? (
                <span className="o-tool-object">{currentParts.object}</span>
              ) : null}
            </>
          ) : (
            <span className="o-c2">{run.summary}</span>
          )}
        </span>
        <span className="o-tool-side">
          {run.family === "edit" && run.added + run.removed > 0 ? (
            <>
              <DiffCounts added={run.added} removed={run.removed} size={11} />
              <DiffSquares added={run.added} removed={run.removed} />
            </>
          ) : null}
          {running ? (
            <>
              <DotLoader />
              <span className="o-t-mono o-c3 o-mono-11">
                <Elapsed player={props.player} since={run.startedAt} />
              </span>
            </>
          ) : run.family !== "edit" && duration ? (
            <span className="o-t-mono o-c3 o-mono-11">{duration}</span>
          ) : null}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="children" className="o-fold" {...fold(reduced)}>
            <div className="o-tool-children">
              {run.calls.map((call) =>
                call.kind === "execute" ? (
                  <CommandCall key={call.id} {...props} mark={null} call={call} nested />
                ) : (
                  <CallRow key={call.id} {...props} mark={null} call={call} nested />
                ),
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

/** When a call started running: after its answer, for a call that waited on one. */
function runStart(call: ToolCallModel, runFrom: ReadonlyMap<string, number> | undefined): number {
  return Math.max(call.startedAt, runFrom?.get(call.id) ?? call.startedAt);
}

function CallRow({
  call,
  player,
  live,
  denied,
  runFrom,
  mark,
  nested = false,
  onOpenChanges,
  onCopy,
}: ToolRunProps & { readonly call: ToolCallModel; readonly nested?: boolean }) {
  const reduced = useReduced();
  const wasDenied = denied?.has(call.id) ?? false;
  const running = live && isRunning(call) && !call.awaitingPermission && !wasDenied;
  const failed = call.status === "failed" && !wasDenied;
  const marked = running && !nested && Boolean(mark);
  // A failed call stays open; the rest open on click.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? failed;
  const Icon = iconFor(call);
  const { verb, object, result } = toolParts(call, wasDenied);
  const start = runStart(call, runFrom);
  const duration = call.endedAt !== null ? formatSeconds(call.endedAt - start) : null;
  const added = call.diffs.reduce((sum, diff) => sum + diff.added, 0);
  const removed = call.diffs.reduce((sum, diff) => sum + diff.removed, 0);
  const canOpen = !call.awaitingPermission && !wasDenied;

  return (
    <div className="o-call" data-nested={nested ? "" : undefined} data-open={open ? "" : undefined}>
      <button
        type="button"
        className="o-tool-row"
        data-denied={wasDenied ? "" : undefined}
        data-waiting={call.awaitingPermission ? "" : undefined}
        aria-expanded={canOpen ? open : undefined}
        disabled={!canOpen}
        onClick={() => setToggled(!open)}
      >
        <span className="o-gutter">
          {marked ? (
            mark
          ) : (
            <Icon className="o-tool-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        <span className="o-tool-text o-t-ui">
          <span className="o-tool-verb">
            {running && !nested ? <Shimmer>{verb}</Shimmer> : verb}
          </span>
          {object ? (
            <span className="o-tool-object" title={call.target ?? undefined}>
              {object}
            </span>
          ) : null}
          {result ? <span className="o-tool-result">{result}</span> : null}
        </span>
        <span className="o-tool-side">
          {wasDenied ? (
            <span className="o-t-meta o-c3">Denied</span>
          ) : call.awaitingPermission ? null : running ? (
            <>
              <DotLoader />
              <span className="o-t-mono o-c3 o-mono-11">
                <Elapsed player={player} since={start} />
              </span>
            </>
          ) : failed ? (
            <span className="o-t-mono o-del o-mono-11 o-fail">
              <X size={12} strokeWidth={2} aria-hidden="true" />
              Failed
            </span>
          ) : call.kind === "edit" && added + removed > 0 ? (
            <>
              <DiffCounts added={added} removed={removed} size={11} />
              {/* Inside an opened group the squares line up under the group's own. */}
              {nested ? <DiffSquares added={added} removed={removed} /> : null}
            </>
          ) : duration ? (
            <span className="o-t-mono o-c3 o-mono-11">{duration}</span>
          ) : null}
          {canOpen ? (
            <ChevronRight
              className="o-tool-hover-chev"
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : null}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && canOpen ? (
          <motion.div key="well" className="o-fold" {...fold(reduced)}>
            <CallWell call={call} start={start} onOpenChanges={onOpenChanges} onCopy={onCopy} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function CallWell({
  call,
  start,
  onOpenChanges,
  onCopy,
}: {
  readonly call: ToolCallModel;
  /** When the call began to run: after its answer, when it waited on one. */
  readonly start: number;
  readonly onOpenChanges?: (path: string) => void;
  readonly onCopy?: (text: string, done: string) => void;
}) {
  if (call.diffs.length > 0) {
    return (
      <div className="o-well-stack">
        {call.diffs.map((diff) => (
          <div key={diff.path} className="o-well o-well-diff">
            <DiffHeader diff={diff} onOpenChanges={onOpenChanges} onCopy={onCopy} />
            <DiffView diff={diff} numbers="one" maxRows={14} newText={newTextOf(call, diff.path)} />
          </div>
        ))}
      </div>
    );
  }
  if (call.search) return <SearchWell call={call} />;
  return (
    <div className="o-well o-well-kv">
      {call.target ? (
        <KvRow label={call.kind === "read" ? "File" : "Target"} value={call.target} />
      ) : null}
      {call.endedAt !== null ? (
        <KvRow label="Duration" value={formatSeconds(call.endedAt - start)} />
      ) : null}
      {call.text ? <KvRow label="Output" value={call.text} /> : null}
    </div>
  );
}

function newTextOf(call: ToolCallModel, path: string): string | null {
  for (const content of call.content) {
    if (content.type === "diff" && content.path === path) return content.new_text;
  }
  return null;
}

export function KvRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="o-kv">
      <span className="o-kv-label o-t-meta o-c3">{label}</span>
      <span className="o-kv-value o-t-mono o-c1">{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------------------- the terminal */

const ANSI_TOKENS: Readonly<Record<string, string>> = {
  black: "var(--o-code-dim)",
  red: "var(--o-code-red)",
  green: "var(--o-code-green)",
  yellow: "var(--o-code-yellow)",
  blue: "var(--o-code-blue)",
  magenta: "var(--o-code-purple)",
  cyan: "var(--o-code-teal)",
  white: "var(--o-code-fg)",
  brightBlack: "var(--o-code-dim)",
  brightRed: "var(--o-code-red)",
  brightGreen: "var(--o-code-green)",
  brightYellow: "var(--o-code-yellow)",
  brightBlue: "var(--o-code-blue)",
  brightMagenta: "var(--o-code-purple)",
  brightCyan: "var(--o-code-teal)",
  brightWhite: "var(--o-code-bright)",
};

function ansiColor(color: AnsiColor | null): string | null {
  if (color === null) return null;
  if (color.startsWith("#")) return color;
  return Object.hasOwn(ANSI_TOKENS, color) ? (ANSI_TOKENS[color] ?? null) : null;
}

/**
 * Vercel's log rows: a line that reports an error or a warning gets a full-width tint, so it is found
 * at a glance in a long run. Read from the line's own words (rustc's "error[E0308]:", "warning:",
 * "Error:", vitest's FAIL, npm's ERR!), never guessed from colour.
 */
export function lineTone(line: AnsiLine): "error" | "warn" | null {
  const text = line
    .map((span) => span.text)
    .join("")
    .trimStart();
  // A word that names a level, then its colon: "error handling passed" is not an error line.
  if (/^(error|fatal)(\[[\w-]+\])?:/i.test(text) || /^(npm ERR!|FAIL\s|[✗×]\s)/.test(text)) {
    return "error";
  }
  if (/^(warning|warn)(\[[\w-]+\])?:/i.test(text) || /^npm WARN\b/.test(text)) return "warn";
  return null;
}

/** A terminal line in the palette; inverse badges (vitest's RUN) are the hue at 16% behind it. */
export function TermLine({ line }: { readonly line: AnsiLine }) {
  if (line.length === 0) return <div className="o-term-line"> </div>;
  return (
    <div className="o-term-line" data-tone={lineTone(line) ?? undefined}>
      {line.map((span, index) => {
        const hue = ansiColor(span.bg) ?? null;
        const fg = hue ?? ansiColor(span.fg);
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional within a line.
            key={index}
            className="o-term-span"
            data-bold={span.bold ? "" : undefined}
            data-dim={span.dim ? "" : undefined}
            style={{
              color: fg ?? undefined,
              background: hue ? `color-mix(in srgb, ${hue} 16%, transparent)` : undefined,
            }}
          >
            {span.text}
          </span>
        );
      })}
    </div>
  );
}

const isBlank = (line: AnsiLine): boolean => line.every((span) => span.text.trim() === "");

/**
 * The last `count` lines of a live run, read as a tail: leading and trailing blank lines dropped
 * and runs of blank lines closed up to one, so the well never opens on empty rows.
 */
export function liveTail(lines: readonly AnsiLine[], count: number): AnsiLine[] {
  const kept: AnsiLine[] = [];
  for (const line of lines) {
    const blank = isBlank(line);
    if (blank && (kept.length === 0 || isBlank(kept[kept.length - 1] ?? []))) continue;
    kept.push(line);
  }
  while (kept.length > 0 && isBlank(kept[kept.length - 1] ?? [])) kept.pop();
  const tail = kept.slice(-count);
  while (tail.length > 0 && isBlank(tail[0] ?? [])) tail.shift();
  return tail;
}

/**
 * A command (Grok Build's terminal grammar, Warp's exit edge): its row is the block's header, so
 * opening it is an in-place expansion and nothing on the line moves. While it runs and prints, the
 * output unfolds below with its last six lines live; when it ends it folds back into the row,
 * unless it failed. Opened, the gutter holds a $ (or the agent's live mark), the right side the
 * status and the copy and expand buttons. A command cut short by Stop reads as stopped, not failed.
 */
function CommandCall({
  call,
  player,
  live,
  stopped = false,
  denied,
  runFrom,
  mark,
  nested = false,
  onCopy,
}: ToolRunProps & { readonly call: ToolCallModel; readonly nested?: boolean }) {
  const reduced = useReduced();
  const wasDenied = denied?.has(call.id) ?? false;
  const running = live && isRunning(call) && !call.awaitingPermission && !wasDenied;
  const exit = call.terminal?.exitCode ?? null;
  const wasStopped = stopped && call.status === "failed" && exit === null && !wasDenied;
  const failed =
    !wasDenied && !wasStopped && (call.status === "failed" || (exit !== null && exit !== 0));
  const marked = running && !nested && Boolean(mark);
  const lines = call.terminal?.lines ?? [];
  const printed = lines.length > 0;
  const canOpen = !call.awaitingPermission && !wasDenied && printed;
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [all, setAll] = useState(false);
  const open = canOpen && (toggled ?? ((running && printed) || failed));
  // The well stays on the block while its output folds away, then the row is plain again.
  const [shell, setShell] = useState(open);
  if (open && !shell) setShell(true);
  const Icon = iconFor(call);
  const parts = toolParts(call, wasDenied);
  const { verb, object } = parts;
  const start = runStart(call, runFrom);
  const duration = call.endedAt !== null ? formatSeconds(call.endedAt - start) : null;
  const command = call.terminal?.command ?? call.target ?? call.title;
  const tests = call.terminal ? testSummary(call.terminal.output) : null;
  // The row says what a test run found; an exit code is said once, by the status at the right.
  const result = tests ? parts.result : null;
  // Live: the last 6 printed lines, blank runs closed up so the tail starts on its first word.
  // Done: 12 visible with a fade over the rest, or everything, blank lines kept.
  const tail = running ? liveTail(lines, 6) : null;
  const visible = tail ?? (all ? lines : lines.slice(-12));
  const hidden = running ? 0 : lines.length - visible.length;

  const status = wasDenied ? (
    <span className="o-t-meta o-c3">Denied</span>
  ) : call.awaitingPermission ? null : running ? (
    <>
      <DotLoader />
      <span className="o-t-mono o-c3 o-mono-11">
        <Elapsed player={player} since={start} />
      </span>
    </>
  ) : wasStopped ? (
    <span className="o-t-mono o-c3 o-mono-11 o-fail">
      <Square size={8} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      Stopped{duration ? ` · ${duration}` : ""}
    </span>
  ) : failed ? (
    <span className="o-t-mono o-del o-mono-11 o-fail">
      <X size={12} strokeWidth={2} aria-hidden="true" />
      exit {exit ?? 1}
      {shell && duration ? <span className="o-c3"> · {duration}</span> : null}
    </span>
  ) : shell ? (
    <span className="o-t-mono o-c3 o-mono-11 o-fail">
      <Check className="o-add" size={12} strokeWidth={2} aria-hidden="true" />
      exit {exit ?? 0}
      {duration ? ` · ${duration}` : ""}
    </span>
  ) : duration ? (
    <span className="o-t-mono o-c3 o-mono-11">{duration}</span>
  ) : null;

  return (
    <div
      className="o-call o-cmd"
      data-nested={nested ? "" : undefined}
      data-open={shell ? "" : undefined}
      data-failed={shell && failed ? "" : undefined}
    >
      <div className="o-cmd-head">
        <button
          type="button"
          className="o-tool-row o-cmd-toggle"
          data-denied={wasDenied ? "" : undefined}
          data-waiting={call.awaitingPermission ? "" : undefined}
          aria-expanded={canOpen ? open : undefined}
          disabled={!canOpen}
          title={canOpen ? (open ? "Fold the output" : "Show the output") : undefined}
          onClick={() => setToggled(!open)}
        >
          <span className="o-gutter">
            {marked ? (
              mark
            ) : shell ? (
              <span className="o-cmd-prompt" aria-hidden="true">
                $
              </span>
            ) : (
              <Icon className="o-tool-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </span>
          <span className="o-tool-text o-t-ui">
            <span className="o-tool-verb">
              {running && !nested ? <Shimmer>{verb}</Shimmer> : verb}
            </span>
            {object ? (
              <span className="o-tool-object" title={command}>
                {object}
              </span>
            ) : null}
            {result ? <span className="o-tool-result">{result}</span> : null}
          </span>
          <span className="o-tool-side">
            {status}
            {canOpen && !shell ? (
              <ChevronRight
                className="o-tool-hover-chev"
                size={12}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            ) : null}
          </span>
        </button>
        {shell ? (
          <span className="o-cmd-actions">
            <IconButton
              icon={Copy}
              label="Copy output"
              size={24}
              onClick={() => onCopy?.(stripAnsi(call.terminal?.output ?? ""), "Copied the output")}
            />
            {hidden > 0 || all ? (
              <IconButton
                icon={all ? Minimize2 : Maximize2}
                label={all ? "Show the last lines" : "Show all output"}
                size={24}
                onClick={() => setAll((value) => !value)}
              />
            ) : null}
          </span>
        ) : null}
      </div>
      <AnimatePresence initial={false} onExitComplete={() => setShell(false)}>
        {open ? (
          <motion.div key="output" className="o-fold" {...fold(reduced)}>
            <div className="o-term-body o-scroll" data-clipped={hidden > 0 ? "" : undefined}>
              {visible.map((line, index) => (
                <TermLine key={running ? index : hidden + index} line={line} />
              ))}
            </div>
            {!running && hidden > 0 ? (
              <button type="button" className="o-well-more o-t-meta" onClick={() => setAll(true)}>
                Show all {lines.length} lines
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------------------ the diff */

export function DiffHeader({
  diff,
  onOpenChanges,
  onCopy,
  children,
}: {
  readonly diff: FileDiffModel;
  readonly onOpenChanges?: (path: string) => void;
  readonly onCopy?: (text: string, done: string) => void;
  readonly children?: ReactNode;
}) {
  return (
    <div className="o-diff-head">
      {children}
      <FileText className="o-diff-icon o-c3" size={14} strokeWidth={1.5} aria-hidden="true" />
      <span className="o-t-mono o-diff-path">
        <PathLabel path={diff.path} />
      </span>
      <DiffCounts added={diff.added} removed={diff.removed} />
      <DiffSquares added={diff.added} removed={diff.removed} />
      <span className="o-diff-actions">
        {onOpenChanges ? (
          <IconButton
            icon={FileDiff}
            label="Open in Changes"
            size={24}
            onClick={() => onOpenChanges(diff.path)}
          />
        ) : null}
        {onCopy ? (
          <IconButton
            icon={Copy}
            label="Copy path"
            size={24}
            onClick={() => onCopy(diff.path, "Copied the path")}
          />
        ) : null}
      </span>
    </div>
  );
}

interface Row {
  readonly line: DiffLine;
  /** For a replaced line, the span of the change, for the word tint. */
  readonly mark: { readonly from: number; readonly to: number } | null;
}

/** Pairs removals with the additions that replace them, to mark the changed words. */
function hunkRows(hunk: DiffHunk): Row[] {
  const rows: Row[] = hunk.lines.map((line) => ({ line, mark: null }));
  let index = 0;
  while (index < rows.length) {
    const removes: number[] = [];
    while (rows[index]?.line.op === "remove") removes.push(index++);
    const adds: number[] = [];
    while (rows[index]?.line.op === "add") adds.push(index++);
    if (removes.length === 0 && adds.length === 0) {
      index += 1;
      continue;
    }
    for (let pair = 0; pair < Math.min(removes.length, adds.length); pair += 1) {
      const removeAt = removes[pair] ?? -1;
      const addAt = adds[pair] ?? -1;
      const before = rows[removeAt]?.line.text ?? "";
      const after = rows[addAt]?.line.text ?? "";
      const middle = changedMiddle(before, after);
      if (!middle) continue;
      // A line mostly rewritten is said by its tint alone: word marks there are only noise.
      const changed = Math.max(
        before.length - middle.prefix - middle.suffix,
        after.length - middle.prefix - middle.suffix,
      );
      const longest = Math.max(before.trim().length, after.trim().length, 1);
      if (changed / longest > 0.6) continue;
      const removeRow = rows[removeAt];
      const addRow = rows[addAt];
      if (removeRow && before.length - middle.suffix > middle.prefix) {
        rows[removeAt] = {
          ...removeRow,
          mark: { from: middle.prefix, to: before.length - middle.suffix },
        };
      }
      if (addRow && after.length - middle.suffix > middle.prefix) {
        rows[addAt] = {
          ...addRow,
          mark: { from: middle.prefix, to: after.length - middle.suffix },
        };
      }
    }
  }
  return rows;
}

/**
 * A diff line's code, monochrome (Grok Build's inline diff): the tint says what changed, so the
 * code itself carries no syntax colour, and the changed words sit on the word tint (GitHub).
 */
function DiffCode({ text, mark }: { readonly text: string; readonly mark: Row["mark"] }) {
  if (text === "") return <> </>;
  if (!mark) return <>{text}</>;
  return (
    <>
      {text.slice(0, mark.from)}
      <span className="o-diff-word">{text.slice(mark.from, mark.to)}</span>
      {text.slice(mark.to)}
    </>
  );
}

/**
 * A unified diff (GitHub's tints, Grok Build's numbers): 20px rows, a number column (one, with the
 * old number in red on removed lines, or two), a marker column, then the code over the line tint
 * with the changed words on the word tint. Gaps between hunks say how many lines are unchanged and
 * open on click when the new text is known.
 */
export function DiffView({
  diff,
  numbers,
  maxRows,
  newText = null,
  wrap = false,
}: {
  readonly diff: FileDiffModel;
  readonly numbers: "one" | "two";
  /** Collapse to this many rows with a fade and "Show N more lines". */
  readonly maxRows?: number;
  readonly newText?: string | null;
  /** Soft-wrap long lines under the code's start (the narrow review panel), instead of scrolling. */
  readonly wrap?: boolean;
}) {
  const [all, setAll] = useState(false);
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(() => new Set());
  const fileLines = newText === null ? null : newText.replace(/\n$/, "").split("\n");
  const entries: ReactNode[] = [];
  let count = 0;
  let hiddenRows = 0;
  const limit = all || maxRows === undefined ? Number.POSITIVE_INFINITY : maxRows;

  diff.hunks.forEach((hunk, hunkIndex) => {
    const previous = diff.hunks[hunkIndex - 1];
    if (previous) {
      const gapStart = previous.newStart + previous.newLines;
      const gapEnd = hunk.newStart - 1;
      const gap = gapEnd - gapStart + 1;
      if (gap > 0) {
        if (openGaps.has(hunkIndex) && fileLines) {
          for (let line = gapStart; line <= gapEnd; line += 1) {
            if (count >= limit) {
              hiddenRows += 1;
              continue;
            }
            count += 1;
            const oldLine = line - (hunk.newStart - hunk.oldStart);
            entries.push(
              <DiffRowView
                key={`g${hunk.newStart}-${line}`}
                row={{
                  line: { op: "context", text: fileLines[line - 1] ?? "", oldLine, newLine: line },
                  mark: null,
                }}
                numbers={numbers}
              />,
            );
          }
        } else if (count < limit) {
          entries.push(
            <button
              key={`gap${hunk.newStart}`}
              type="button"
              className="o-diff-gap o-t-mono o-mono-11 o-c3"
              disabled={!fileLines}
              onClick={() => setOpenGaps((open) => new Set(open).add(hunkIndex))}
            >
              {gap} unchanged {gap === 1 ? "line" : "lines"}
            </button>,
          );
        }
      }
    }
    if (numbers === "two" && count < limit) {
      entries.push(
        <div key={`h${hunk.newStart}`} className="o-diff-hunk o-t-mono o-mono-11 o-c3">
          {hunk.header.replace("-", "−")}
        </div>,
      );
    }
    for (const row of hunkRows(hunk)) {
      if (count >= limit) {
        hiddenRows += 1;
        continue;
      }
      count += 1;
      const rowKey = `${hunk.newStart}:${row.line.op}:${row.line.oldLine ?? ""}:${row.line.newLine ?? ""}`;
      entries.push(<DiffRowView key={rowKey} row={row} numbers={numbers} />);
    }
  });

  return (
    <div className="o-diff" data-numbers={numbers} data-wrap={wrap ? "" : undefined}>
      <div className="o-diff-rows o-scroll" data-clipped={hiddenRows > 0 ? "" : undefined}>
        {entries}
      </div>
      {hiddenRows > 0 ? (
        <button type="button" className="o-well-more o-t-meta" onClick={() => setAll(true)}>
          Show {hiddenRows} more {hiddenRows === 1 ? "line" : "lines"}
        </button>
      ) : null}
    </div>
  );
}

function DiffRowView({ row, numbers }: { readonly row: Row; readonly numbers: "one" | "two" }) {
  const { line } = row;
  const marker = line.op === "add" ? "+" : line.op === "remove" ? "−" : "";
  return (
    <div className="o-diff-row" data-op={line.op}>
      {numbers === "two" ? (
        <>
          <span className="o-diff-num" data-side="old">
            {line.oldLine ?? ""}
          </span>
          <span className="o-diff-num" data-side="new">
            {line.newLine ?? ""}
          </span>
        </>
      ) : (
        <span className="o-diff-num">{line.op === "remove" ? line.oldLine : line.newLine}</span>
      )}
      <span className="o-diff-marker">{marker}</span>
      <span className="o-diff-code">
        <DiffCode text={line.text} mark={row.mark} />
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------- search hits */

function MatchLine({
  match,
  pattern,
}: {
  readonly match: SearchMatch;
  readonly pattern: string | null;
}) {
  const text = match.text.trim();
  if (!pattern) return <>{text}</>;
  const at = text.indexOf(pattern);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="o-match">{pattern}</mark>
      {text.slice(at + pattern.length)}
    </>
  );
}

/** Aside's nested result card: path, line, and the matching line with the match marked. */
function SearchWell({ call }: { readonly call: ToolCallModel }) {
  const matches = call.search?.matches ?? [];
  const shown = matches.slice(0, 8);
  return (
    <div className="o-well o-well-search">
      {shown.map((match, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: results are positional.
        <div key={index} className="o-hit">
          <FileText className="o-c3" size={12} strokeWidth={1.5} aria-hidden="true" />
          <span className="o-t-mono o-hit-path">
            <PathLabel path={match.path} />
            {match.line !== null ? <span className="o-c3">:{match.line}</span> : null}
          </span>
          <span className="o-t-mono o-c2 o-hit-text">
            <MatchLine match={match} pattern={call.search?.pattern ?? null} />
          </span>
        </div>
      ))}
      {matches.length > shown.length ? (
        <div className="o-t-meta o-c3 o-hit-more">+ {matches.length - shown.length} more</div>
      ) : null}
    </div>
  );
}
