import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  FileText,
  GitBranch,
  MoreHorizontal,
  Rows2,
  X,
} from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  AUTONOMY_LABELS,
  type Autonomy,
  type ChangesScope,
  effortLabel,
  type FileDiff,
  formatCount,
  formatElapsed,
  modelLabel,
  type RightPanel as RightPanelState,
  type RightPanelTab,
  type ToolCallModel,
  type TranscriptModel,
  type Turn,
  type Workspace,
} from "../../kit";
import { Menu } from "./Menu";
import { OrbitMark } from "./OrbitMark";
import { PlanSteps } from "./Plan";
import { tokenizeLine } from "./syntax";
import { DiffHeader, DiffView, PathLabel } from "./Tools";
import { formatClock, languageOfPath, middleEllipsis, splitCount } from "./text";
import { DiffCounts, DiffSquares, IconButton, Keycap, LevelGlyph, MoneyNumeral } from "./ui";

/** The right panel's width range when dragged (section 4.1). */
export const PANEL_MIN = 320;
export const PANEL_MAX = 560;

/*
 * The right panel (visual-language.md 4.16): a second pane, 380px, with SpaceXAI's segmented tabs.
 * Changes is the turn's review (Zed's scope, GitHub's diff, Legora's deliverables manifest, an X
 * Money hero diffstat); Session is Harvey's properties with X Money's numbers.
 */

const TABS: readonly { readonly id: RightPanelTab; readonly label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "files", label: "Files" },
  { id: "plan", label: "Plan" },
  { id: "session", label: "Session" },
];

const SCOPES: readonly {
  readonly id: ChangesScope;
  readonly label: string;
  readonly caps: string;
}[] = [
  { id: "turn", label: "This turn", caps: "This turn" },
  { id: "chat", label: "This chat", caps: "This chat" },
  { id: "branch", label: "Branch since main", caps: "Branch" },
];

export interface ChangedFile {
  readonly diff: FileDiff;
  readonly newText: string | null;
}

/** The files a turn's edits changed, latest edit per file, in the order first edited. */
export function changedFiles(turn: Turn | null): ChangedFile[] {
  if (!turn) return [];
  const byPath = new Map<string, ChangedFile>();
  for (const item of turn.items) {
    if (item.kind !== "tools") continue;
    for (const call of item.calls) {
      for (const diff of call.diffs)
        byPath.set(diff.path, { diff, newText: newTextOf(call, diff.path) });
    }
  }
  return [...byPath.values()];
}

function newTextOf(call: ToolCallModel, path: string): string | null {
  for (const content of call.content) {
    if (content.type === "diff" && content.path === path) return content.new_text;
  }
  return null;
}

function Tabs({
  tab,
  changes,
  onTab,
}: {
  readonly tab: RightPanelTab;
  readonly changes: number;
  readonly onTab: (tab: RightPanelTab) => void;
}) {
  return (
    <div className="o-seg-strong" role="tablist" aria-label="Right panel">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === tab}
          className="o-seg-item o-t-meta"
          data-active={item.id === tab ? "" : undefined}
          onClick={() => onTab(item.id)}
        >
          {item.label}
          {item.id === "changes" && changes > 0 ? (
            <span className="o-num o-seg-count">{changes}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ScopeMenu({
  scope,
  onScope,
}: {
  readonly scope: ChangesScope;
  readonly onScope: (scope: ChangesScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: globalThis.PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    // Esc closes the menu first (capture phase), so it never stops a running turn.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const current = SCOPES.find((item) => item.id === scope) ?? SCOPES[0];
  return (
    <div className="o-scope" ref={ref}>
      <button
        type="button"
        className="o-scope-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="o-t-caps o-c3">{current?.caps}</span>
        <ChevronDown className="o-c3" size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div className="o-menu o-scope-menu" role="menu" data-orbit-menu="">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === scope}
              className="o-menu-row o-t-ui"
              onClick={() => {
                onScope(item.id);
                setOpen(false);
              }}
            >
              <span className="o-menu-icon" aria-hidden="true" />
              <span className="o-menu-label">{item.label}</span>
              {item.id === scope ? (
                <Check className="o-menu-key" size={14} strokeWidth={1.75} aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A patch of the turn's diffs, for "Copy patch". */
function patchText(files: readonly ChangedFile[]): string {
  return files
    .map((file) => {
      const body = file.diff.hunks
        .map((hunk) =>
          [
            hunk.header,
            ...hunk.lines.map(
              (line) => `${line.op === "add" ? "+" : line.op === "remove" ? "-" : " "}${line.text}`,
            ),
          ].join("\n"),
        )
        .join("\n");
      return `--- a/${file.diff.path}\n+++ b/${file.diff.path}\n${body}`;
    })
    .join("\n");
}

/** A file's more menu in the diff: how to show it, and its path. */
function FileMenu({
  path,
  onCopy,
}: {
  readonly path: string;
  readonly onCopy: (text: string, done: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="o-menu-anchor">
      <IconButton
        ref={ref}
        icon={MoreHorizontal}
        label="File menu"
        size={24}
        active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <Menu
          label="File"
          anchor={ref}
          onClose={() => setOpen(false)}
          groups={[
            [
              { label: "Unified", icon: Rows2, checked: true, onSelect: () => {} },
              { label: "Split", icon: Columns2, soon: true },
            ],
            [{ label: "Copy path", icon: Copy, onSelect: () => onCopy(path, "Copied the path") }],
          ]}
        />
      ) : null}
    </span>
  );
}

function ChangesTab({
  files,
  turn,
  turns,
  agentName,
  panel,
  onPanel,
  onRevert,
  onCopy,
}: {
  readonly files: readonly ChangedFile[];
  readonly turn: Turn | null;
  readonly turns: number;
  readonly agentName: string;
  readonly panel: RightPanelState;
  readonly onPanel: (panel: RightPanelState) => void;
  readonly onRevert: () => void;
  readonly onCopy: (text: string, done: string) => void;
}) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  if (files.length === 0) {
    return (
      <div className="o-panel-empty">
        <p className="o-t-ui o-w-strong o-c1">No changes yet</p>
        <p className="o-t-meta o-c3">Edits from this chat appear here.</p>
        <ul className="o-panel-hints o-t-meta o-c2">
          <li>
            Toggle this panel
            <span className="o-keys">
              <Keycap label="Command">{"⌘"}</Keycap>
              <Keycap>J</Keycap>
            </span>
          </li>
          <li>
            Copy the patch
            <span className="o-keys">
              <Keycap label="Command">{"⌘"}</Keycap>
              <Keycap label="Shift">{"⇧"}</Keycap>
              <Keycap>C</Keycap>
            </span>
          </li>
          <li>
            Revert the turn
            <span className="o-keys">
              <Keycap label="Command">{"⌘"}</Keycap>
              <Keycap label="Shift">{"⇧"}</Keycap>
              <Keycap>Z</Keycap>
            </span>
          </li>
        </ul>
      </div>
    );
  }
  const added = files.reduce((sum, file) => sum + file.diff.added, 0);
  const removed = files.reduce((sum, file) => sum + file.diff.removed, 0);
  const duration =
    turn && turn.endedAt !== null ? formatElapsed(turn.endedAt - turn.startedAt) : null;
  const toggle = (path: string): void =>
    onPanel({ ...panel, expandedFile: panel.expandedFile === path ? null : path });
  // The lab's chats edit files in one turn, so the three scopes hold the same files; the summary
  // still says which one is read, and how many turns it spans.
  const scopeWords =
    panel.scope === "turn"
      ? null
      : `${panel.scope === "chat" ? "This chat" : "Branch since main"} · ${turns} ${turns === 1 ? "turn" : "turns"}`;
  return (
    <>
      <div className="o-panel-scroll o-scroll">
        <div className="o-changes-summary">
          <ScopeMenu scope={panel.scope} onScope={(scope) => onPanel({ ...panel, scope })} />
          <div className="o-hero-diff">
            <span className="o-t-numeral o-add">+{added}</span>
            <span className="o-t-numeral o-del">
              {"−"}
              {removed}
            </span>
            <DiffSquares added={added} removed={removed} count={10} />
          </div>
          <p className="o-t-meta o-c3 o-num">
            {scopeWords ? `${scopeWords} · ` : ""}
            {files.length} {files.length === 1 ? "file" : "files"}
            {duration && !scopeWords ? ` · ${duration}` : ""} · {agentName}
          </p>
          <div className="o-changes-actions">
            <button
              type="button"
              className="o-btn o-btn-ghost o-btn-sm"
              onClick={() => onCopy(patchText(files), "Copied the patch")}
            >
              Copy patch
              <span className="o-keys">
                <Keycap label="Command">{"⌘"}</Keycap>
                <Keycap label="Shift">{"⇧"}</Keycap>
                <Keycap>C</Keycap>
              </span>
            </button>
            <button
              type="button"
              className="o-btn o-btn-ghost o-btn-sm"
              aria-disabled="true"
              title="Not in this lab yet"
            >
              Open in editor
            </button>
          </div>
        </div>
        <ul className="o-file-list">
          {files.map((file) => (
            <li key={file.diff.path}>
              <button
                type="button"
                className="o-file-row"
                data-selected={panel.expandedFile === file.diff.path ? "" : undefined}
                onClick={() => toggle(file.diff.path)}
              >
                <FileText className="o-c3" size={14} strokeWidth={1.5} aria-hidden="true" />
                <span className="o-t-mono o-file-path">
                  <PathLabel path={file.diff.path} />
                </span>
                <DiffCounts added={file.diff.added} removed={file.diff.removed} size={11} />
                <span className="o-t-mono o-mono-11 o-c3 o-file-status">
                  {file.diff.isNew ? "A" : "M"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="o-file-diffs">
          {files.map((file) => {
            const open = panel.expandedFile === file.diff.path;
            const isViewed = viewed.has(file.diff.path);
            return (
              <section
                key={file.diff.path}
                className="o-file-diff"
                data-open={open ? "" : undefined}
              >
                <div className="o-file-diff-head">
                  <DiffHeader diff={file.diff}>
                    <button
                      type="button"
                      className="o-file-diff-toggle"
                      aria-expanded={open}
                      aria-label={open ? "Fold this file" : "Open this file"}
                      onClick={() => toggle(file.diff.path)}
                    >
                      <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </DiffHeader>
                  <label className="o-viewed o-t-meta o-c3">
                    <input
                      type="checkbox"
                      checked={isViewed}
                      onChange={() =>
                        setViewed((current) => {
                          const next = new Set(current);
                          if (next.has(file.diff.path)) next.delete(file.diff.path);
                          else next.add(file.diff.path);
                          return next;
                        })
                      }
                    />
                    Viewed
                  </label>
                  <FileMenu path={file.diff.path} onCopy={onCopy} />
                </div>
                {open ? (
                  <DiffView diff={file.diff} numbers="two" newText={file.newText} wrap />
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
      <div className="o-panel-foot">
        <span className="o-t-meta o-c3">Checkpoint saved before this turn</span>
        <button type="button" className="o-text-btn o-t-meta" onClick={onRevert}>
          Revert
        </button>
      </div>
    </>
  );
}

/** How sure a status is: a write beats a read, so a file read and then edited shows M. */
const STATUS_RANK: Readonly<Record<string, number>> = { A: 3, D: 3, M: 2, R: 1 };

interface TouchedFile {
  readonly path: string;
  readonly status: "A" | "D" | "M" | "R";
  readonly added: number;
  readonly removed: number;
  /** The file as the agent left it, when the recording carries it. */
  readonly text: string | null;
}

/** Every file a chat touched, in first-touched order, with its strongest status. */
export function touchedFiles(model: TranscriptModel): TouchedFile[] {
  const byPath = new Map<string, TouchedFile>();
  const touch = (file: TouchedFile): void => {
    const known = byPath.get(file.path);
    if (!known) {
      byPath.set(file.path, file);
      return;
    }
    const stronger = (STATUS_RANK[file.status] ?? 0) >= (STATUS_RANK[known.status] ?? 0);
    byPath.set(file.path, {
      path: file.path,
      status: stronger ? file.status : known.status,
      added: known.added + file.added,
      removed: known.removed + file.removed,
      text: file.text ?? known.text,
    });
  };
  for (const turn of model.turns) {
    for (const item of turn.items) {
      if (item.kind !== "tools") continue;
      for (const call of item.calls) {
        for (const diff of call.diffs) {
          touch({
            path: diff.path,
            status: diff.isNew ? "A" : "M",
            added: diff.added,
            removed: diff.removed,
            text: newTextOf(call, diff.path),
          });
        }
        if (call.kind === "read" && call.target) {
          touch({ path: call.target, status: "R", added: 0, removed: 0, text: null });
        }
      }
    }
  }
  return [...byPath.values()];
}

/**
 * A read-only view of a file (section 4.16, Grok Build's numbered plan.md): a well with a line
 * number gutter, the code in Geist Mono with the code palette, no wrap, scrolling inside.
 */
function FileViewer({ path, text }: { readonly path: string; readonly text: string | null }) {
  if (text === null) {
    return (
      <p className="o-file-viewer-none o-t-meta o-c3">
        The agent read this file; the recording does not carry its contents.
      </p>
    );
  }
  const lang = languageOfPath(path);
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <section className="o-file-viewer o-scroll" aria-label={`${path}, read only`}>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
        <div key={index} className="o-viewer-line">
          <span className="o-viewer-num">{index + 1}</span>
          <span className="o-viewer-code">
            {line === ""
              ? "\u00a0"
              : tokenizeLine(line, lang).map((token, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional.
                  <span key={at} className="o-tok" data-kind={token.kind}>
                    {token.text}
                  </span>
                ))}
          </span>
        </div>
      ))}
    </section>
  );
}

function FilesTab({ model }: { readonly model: TranscriptModel }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = touchedFiles(model);
  return (
    <div className="o-panel-scroll o-scroll">
      <p className="o-panel-label o-t-caps o-c3">Touched in this chat</p>
      <ul className="o-file-list o-files-tab">
        {rows.map((row) => (
          <li key={row.path}>
            <button
              type="button"
              className="o-file-row"
              aria-expanded={open === row.path}
              data-selected={open === row.path ? "" : undefined}
              onClick={() => setOpen((current) => (current === row.path ? null : row.path))}
            >
              <FileText className="o-c3" size={14} strokeWidth={1.5} aria-hidden="true" />
              <span className="o-t-mono o-file-path">
                <PathLabel path={row.path} />
              </span>
              {row.status === "R" ? (
                <span />
              ) : (
                <DiffCounts added={row.added} removed={row.removed} size={11} />
              )}
              <span className="o-t-mono o-mono-11 o-c3 o-file-status">{row.status}</span>
            </button>
            {open === row.path ? <FileViewer path={row.path} text={row.text} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanTab({
  model,
  agentName,
}: {
  readonly model: TranscriptModel;
  readonly agentName: string;
}) {
  if (!model.plan) {
    return (
      <div className="o-panel-empty">
        <p className="o-t-ui o-w-strong o-c1">No plan in this chat</p>
        <p className="o-t-meta o-c3">When the agent plans its work, the steps appear here.</p>
      </div>
    );
  }
  return (
    <div className="o-panel-scroll o-scroll o-plan-tab">
      <p className="o-panel-label o-t-caps o-c3">
        Plan{" "}
        <span className="o-num o-c2">
          {model.plan.completed}/{model.plan.total}
        </span>
      </p>
      <PlanSteps plan={model.plan} />
      <p className="o-t-meta o-c3 o-plan-tab-foot">
        Updated by {agentName} · <span className="o-num">{formatClock(model.plan.updatedAt)}</span>
      </p>
    </div>
  );
}

function Property({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="o-prop">
      <span className="o-prop-label o-t-meta o-c3">{label}</span>
      <span className="o-prop-value o-t-ui o-c1">{children}</span>
    </div>
  );
}

function SessionTab({
  model,
  workspace,
  agent,
  agentName,
  autonomy,
  project,
  onCopy,
}: {
  readonly model: TranscriptModel;
  readonly workspace: Workspace;
  readonly agent: string;
  readonly agentName: string;
  readonly autonomy: Autonomy;
  readonly project: string;
  readonly onCopy: (text: string, done: string) => void;
}) {
  const turn = model.turns[model.turns.length - 1] ?? null;
  const usage = turn?.footer?.usage ?? null;
  const cost = model.usage?.cost?.amount ?? null;
  const tokens = usage ? usage.input_tokens + usage.output_tokens : null;
  const context = model.usage;
  const share =
    context?.context_used != null && context.context_size
      ? context.context_used / context.context_size
      : null;
  const sessionId = model.session.nativeSessionId;
  const duration = turn && turn.endedAt !== null ? turn.endedAt - turn.startedAt : null;
  return (
    <div className="o-panel-scroll o-scroll o-session">
      <div className="o-props">
        <Property label="Agent">
          <span className="o-prop-chip">
            <OrbitMark agent={agent} size={14} label={agentName} />
            {agentName}
          </span>
        </Property>
        <Property label="Model">
          <span className="o-prop-chip">
            {modelLabel(workspace, agent, model.session.model) || "Unknown"}
          </span>
        </Property>
        <Property label="Effort">
          {effortLabel(workspace, agent, model.session.model, model.session.effort) || "None"}
        </Property>
        <Property label="Autonomy">
          <LevelGlyph autonomy={autonomy} />
          {AUTONOMY_LABELS[autonomy]}
        </Property>
        <Property label="Folder">
          <span className="o-t-mono">~/Desktop/{project}</span>
        </Property>
        <Property label="Branch">
          <GitBranch size={12} strokeWidth={1.5} aria-hidden="true" />
          <span className="o-t-mono">main</span>
        </Property>
        {sessionId ? (
          <Property label="Session">
            <span className="o-t-mono">{middleEllipsis(sessionId.replace(/-/g, ""))}</span>
            <IconButton
              icon={Copy}
              label="Copy the session id"
              size={24}
              onClick={() => onCopy(sessionId, "Copied the session id")}
            />
          </Property>
        ) : null}
      </div>
      <div className="o-tiles">
        <div className="o-tile">
          <span className="o-t-meta o-c3">Cost</span>
          {cost !== null ? (
            // X Money's built superscript cents: "$0" and a raised "21", in the same ink.
            <MoneyNumeral amount={cost} currency="USD" />
          ) : (
            <span className="o-t-numeral o-c4">$0</span>
          )}
          <span className="o-t-meta o-c3">
            this turn {cost !== null ? `$${cost.toFixed(2)}` : "0"}
          </span>
        </div>
        <div className="o-tile">
          <span className="o-t-meta o-c3">Tokens</span>
          {tokens !== null ? (
            <span className="o-numeral o-t-numeral">
              {splitCount(tokens).value}
              <span className="o-unit">{splitCount(tokens).unit}</span>
            </span>
          ) : (
            <span className="o-t-numeral o-c4">0</span>
          )}
          <span className="o-t-meta o-c3">
            {usage
              ? `${formatCount(usage.input_tokens)} in · ${formatCount(usage.output_tokens)} out`
              : "none yet"}
          </span>
        </div>
      </div>
      {share !== null && context?.context_size ? (
        <div className="o-context">
          <span className="o-context-bar" aria-hidden="true">
            <span className="o-context-fill" style={{ width: `${Math.max(1, share * 100)}%` }} />
            <span className="o-context-tick" style={{ left: "80%" }} />
          </span>
          <span className="o-t-mono o-mono-11 o-c3 o-num">
            {Math.round(share * 100)}% of{" "}
            {context.context_size >= 1_000_000
              ? `${context.context_size / 1_000_000}M`
              : `${Math.round(context.context_size / 1000)}k`}
          </span>
        </div>
      ) : null}
      {turn && duration !== null ? (
        <div className="o-timeline-strip">
          <p className="o-panel-label o-t-caps o-c3">Turn</p>
          <span
            className="o-strip"
            aria-label={`Turn timeline, ${formatElapsed(duration)}`}
            role="img"
          >
            {turn.items.map((item) => {
              if (item.kind === "thought" && item.endedAt !== null) {
                return (
                  <span
                    key={item.id}
                    className="o-strip-block"
                    style={{
                      left: `${((item.startedAt - turn.startedAt) / duration) * 100}%`,
                      width: `${((item.endedAt - item.startedAt) / duration) * 100}%`,
                    }}
                  />
                );
              }
              if (item.kind === "tools") {
                return item.calls.map((call) => (
                  <span
                    key={call.id}
                    className="o-strip-tick"
                    style={{ left: `${((call.startedAt - turn.startedAt) / duration) * 100}%` }}
                  />
                ));
              }
              return null;
            })}
          </span>
          <span className="o-strip-ends o-t-mono o-c3">
            <span>0:00</span>
            <span>{formatClock(duration)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function RightPanel({
  panel,
  model,
  workspace,
  agent,
  agentName,
  autonomy,
  project,
  width,
  onWidth,
  onPanel,
  onClose,
  onRevert,
  onCopy,
}: {
  readonly panel: RightPanelState;
  readonly model: TranscriptModel;
  readonly workspace: Workspace;
  readonly agent: string;
  readonly agentName: string;
  readonly autonomy: Autonomy;
  readonly project: string;
  readonly width: number;
  readonly onWidth: (width: number) => void;
  readonly onPanel: (panel: RightPanelState) => void;
  readonly onClose: () => void;
  readonly onRevert: (turn: Turn) => void;
  readonly onCopy: (text: string, done: string) => void;
}) {
  // The turn that edited files: the last one with changes (a scripted reply after it edits none).
  const turn =
    [...model.turns].reverse().find((entry) => changedFiles(entry).length > 0) ??
    model.turns[model.turns.length - 1] ??
    null;
  const files = changedFiles(turn);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onDown = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    // The window may be scaled to fit the screen: move by the window's own pixels.
    const scale =
      event.currentTarget.getBoundingClientRect().height / event.currentTarget.offsetHeight || 1;
    const next = drag.current.width + (drag.current.x - event.clientX) / scale;
    onWidth(Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, next))));
  };
  return (
    <aside className="o-panel" aria-label="Right panel">
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable window splitter (WAI-ARIA) cannot be an hr. */}
      <div
        className="o-panel-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the right panel"
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.key === "ArrowLeft" ? 20 : -20;
          onWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width + step)));
        }}
      />
      <div className="o-panel-head">
        <Tabs tab={panel.tab} changes={files.length} onTab={(tab) => onPanel({ ...panel, tab })} />
        <IconButton icon={X} label="Close the panel" onClick={onClose} />
      </div>
      {panel.tab === "changes" ? (
        <ChangesTab
          files={files}
          turn={turn}
          turns={model.turns.length}
          agentName={agentName}
          panel={panel}
          onPanel={onPanel}
          onRevert={() => {
            if (turn) onRevert(turn);
          }}
          onCopy={onCopy}
        />
      ) : panel.tab === "files" ? (
        <FilesTab model={model} />
      ) : panel.tab === "plan" ? (
        <PlanTab model={model} agentName={agentName} />
      ) : (
        <SessionTab
          model={model}
          workspace={workspace}
          agent={agent}
          agentName={agentName}
          autonomy={autonomy}
          project={project}
          onCopy={onCopy}
        />
      )}
    </aside>
  );
}
