import { AGENT_BRAND_IDS, type AgentBrandId } from "@auracode/ui";
import { AgentMark, Logo } from "@auracode/ui/graphite";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";
import { AgentStrip } from "./AgentStrip";

/** How long the pointer rests on a row before its view shows. */
const HOVER_INTENT_MS = 90;

/*
 * Six one-line rows at left and one product view at right. The active row runs a 2px timer and the next takes over when it
 * fills; focusing or clicking a row shows its view at once, the pointer resting on it for 90ms
 * does too, and the cycle holds while the pointer or focus stays in the panel. Views cross-fade by
 * opacity and a small rise. The rows are a real tab list (arrow keys, Home, End); each tab's panel
 * is its one-sentence description (the first also lists every agent's mark, and pointing at one
 * chooses it in the view), and the views illustrate them, so they stay out of the accessibility
 * tree.
 */

/*
 * The views illustrate supported app states using shared Aura tokens and the app's own marks: the inset pane, the chat header, the transcript's
 * gutter, the floating composer and its agent chip, the picker, the dock's queue, the Changes
 * panel and the sidebar. Each mirrors a ?preview= mode of the desktop app. Nothing in them moves
 * on its own, so a view costs no frames while it is shown.
 */

type IconName =
  | "panel"
  | "more"
  | "attach"
  | "chevron"
  | "chevron-down"
  | "arrow-up"
  | "copy"
  | "retry"
  | "fork"
  | "receipt"
  | "close"
  | "refresh"
  | "folder"
  | "file"
  | "edit"
  | "terminal"
  | "search"
  | "new"
  | "settings";

const ICONS: Record<IconName, ReactNode> = {
  panel: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M9.5 3v10" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  attach: (
    <path d="M10.6 4.8 6.1 9.3a1.25 1.25 0 0 0 1.8 1.8l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L4.2 7.4a4 4 0 0 0 5.7 5.7l3.6-3.6" />
  ),
  chevron: <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />,
  "chevron-down": <path d="m5 6.5 3 3 3-3" />,
  "arrow-up": <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5V3a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H4" />
    </>
  ),
  retry: (
    <>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M3 2.8v2.7h2.7" />
    </>
  ),
  fork: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="11.5" cy="3.5" r="1.5" />
      <circle cx="8" cy="12.5" r="1.5" />
      <path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2.5h8v11H4z" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2" />
    </>
  ),
  close: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" />
      <path d="M11.8 2.2v2.5H9.3M4.2 13.8v-2.5h2.5" />
    </>
  ),
  folder: (
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  ),
  file: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
    </>
  ),
  edit: (
    <>
      <path d="M12 7.5v-2l-3-3H4v11h3.5" />
      <path d="M9 2.5v3h3" />
      <path d="m9.5 13.5.4-1.8 3.4-3.4 1.4 1.4-3.4 3.4z" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="m5 6.5 1.8 1.5L5 9.5M8.5 10H11" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3 3" />
    </>
  ),
  new: (
    <>
      <path d="M8 3H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13h7a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="m11.5 2.5 2 2L8 10H6V8z" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1" />
    </>
  ),
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="m-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Autonomy's level glyph (6.11): three ticks 4, 6 and 8px tall; Full auto fills all three. */
function Ticks({ level = 3 }: { level?: 1 | 2 | 3 }) {
  return (
    <svg className="m-ticks" width="10" height="8" viewBox="0 0 10 8" aria-hidden="true">
      {[4, 6, 8].map((height, i) => (
        <rect
          key={height}
          x={i * 4}
          y={8 - height}
          width="2"
          height={height}
          className={i < level ? "is-on" : undefined}
        />
      ))}
    </svg>
  );
}

/** The 2x3 pixel loader at its static pattern: working, without a spinner. */
function Loader() {
  return (
    <svg className="m-loader" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {[
        [3, 2, 1],
        [7, 2, 3],
        [3, 5, 0],
        [7, 5, 2],
        [3, 8, 0],
        [7, 8, 1],
      ].map(([x, y, level]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" data-level={level} />
      ))}
    </svg>
  );
}

/** The chat header (6.3): title, project, a status only when it says something, two controls. */
function Header({
  title,
  project,
  working,
}: {
  title: string;
  project: string;
  working?: boolean;
}) {
  return (
    <div className="m-head">
      <span className="m-title">{title}</span>
      <span className="m-quiet">{project}</span>
      {working ? (
        <span className="m-status">
          <span className="m-sep">·</span>
          <Loader />
          Working
        </span>
      ) : null}
      <span className="m-head-end">
        <span className="m-icon-button">
          <Icon name="panel" />
        </span>
        <span className="m-icon-button">
          <Icon name="more" />
        </span>
      </span>
    </div>
  );
}

/** The agent chip (6.9): the name, the model, the autonomy ticks and a chevron. */
function AgentChip({ name, model }: { name: string; model?: string }) {
  return (
    <span className="m-agent-chip">
      <span className="m-strong">{name}</span>
      {model ? <span className="m-model">{model}</span> : null}
      <Ticks />
      <Icon name="chevron-down" size={12} />
    </span>
  );
}

/** The floating composer (6.9): the message on top, one row of controls under it. */
function Composer({
  name,
  model,
  text,
  typed,
  send,
}: {
  name: string;
  model?: string;
  text: string;
  typed?: boolean;
  send: ReactNode;
}) {
  return (
    <div className="m-composer">
      <p className={typed ? "m-input is-typed" : "m-input"}>
        {text}
        {typed ? <span className="m-caret" /> : null}
      </p>
      <div className="m-controls">
        <span className="m-attach">
          <Icon name="attach" />
        </span>
        <AgentChip name={name} model={model} />
        <span className="m-send-slot">{send}</span>
      </div>
    </div>
  );
}

function SendDisc({ ready }: { ready?: boolean }) {
  return (
    <span className={ready ? "m-disc is-ready" : "m-disc"}>
      <Icon name="arrow-up" size={14} />
    </span>
  );
}

/** A turn's footer (6.4): copy, retry, fork and the receipt, then the time. */
function Actions({ time }: { time: string }) {
  return (
    <div className="m-actions">
      {(["copy", "retry", "fork", "receipt"] as const).map((name) => (
        <span key={name} className="m-icon-button">
          <Icon name={name} />
        </span>
      ))}
      <span className="m-time">{time}</span>
    </div>
  );
}

function Fold({ children }: { children: ReactNode }) {
  return (
    <p className="m-line m-fold">
      <span className="m-gutter">
        <Icon name="chevron" size={12} />
      </span>
      {children}
    </p>
  );
}

function Tool({
  icon,
  verb,
  object,
  children,
  live,
}: {
  icon: IconName;
  verb: string;
  object: string;
  children?: ReactNode;
  live?: boolean;
}) {
  return (
    <p className="m-line m-tool">
      <span className="m-gutter">{live ? <Loader /> : <Icon name={icon} size={14} />}</span>
      <span className="m-verb">{verb}</span>
      <code className="m-code">{object}</code>
      {children}
    </p>
  );
}

/** The agents New chat finds in this view; the rest wait under "Other agents". */
const FOUND: readonly { id: AgentBrandId; name: string }[] = [
  { id: "claude-code", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "cursor", name: "Cursor" },
  { id: "opencode", name: "OpenCode" },
];

/** Every agent auracode runs, in brand order, for the row under "Your agents, as they are". */
const ALL_AGENTS: readonly AgentBrandId[] = AGENT_BRAND_IDS.filter((id) => id !== "generic");

/**
 * New chat (6.13): the logo, one line, and the card that picks an agent and a folder.
 * `pointed` is the agent under the pointer in the row beside it: its pill is chosen, or "Other
 * agents" lights when it is not one of the found ones.
 */
function AgentsView({ pointed }: { pointed: AgentBrandId | null }) {
  const found = pointed === null || FOUND.some((agent) => agent.id === pointed);
  const chosen = pointed !== null && found ? pointed : "claude-code";
  return (
    <div className="m-pane m-new">
      <div className="m-stage-bg" aria-hidden="true" />
      <div className="m-new-column">
        <Logo size={32} className="m-new-logo" />
        <p className="m-new-title">What are we working on?</p>
        <p className="m-new-hint">Pick an agent, then a folder.</p>
        <div className="m-card">
          <div className="m-card-row">
            <span className="m-pills">
              {FOUND.map((agent) => (
                <span key={agent.id} className={agent.id === chosen ? "m-pill is-on" : "m-pill"}>
                  <AgentMark agent={agent.id} size={24} />
                  {agent.name}
                </span>
              ))}
            </span>
            <span className="m-icon-button">
              <Icon name="refresh" />
            </span>
          </div>
          <div className="m-card-row m-card-folder">
            <span className="m-folder-icon">
              <Icon name="folder" />
            </span>
            <code className="m-path">~/code/auracode</code>
            <span className="m-button m-button-primary">Create</span>
          </div>
        </div>
        <p className={found ? "m-other" : "m-other is-on"}>
          Other agents <span className="m-count">{ALL_AGENTS.length - FOUND.length}</span>
          <Icon name="chevron" size={12} />
        </p>
      </div>
    </div>
  );
}

/** A chat handed from Claude Code to Codex: the handoff waits in view above the composer. */
export function HandoffView() {
  return (
    <div className="handoff-stage">
      <div className="handoff-prior m-pane">
        <Header title="Review the pacing change" project="auracode" />
        <div className="m-body">
          <p className="m-user">Check the pacing change for edge cases before we ship.</p>
          <div className="m-turn">
            <p className="handoff-agent">
              <AgentMark agent="claude-code" size={16} /> Claude Code
            </p>
            <Fold>Thought for 3.1 s</Fold>
            <Tool icon="edit" verb="Edited" object="src/pacing.ts">
              <span className="m-stat">
                <span className="m-add">+12</span> <span className="m-del">−3</span>
              </span>
            </Tool>
            <p className="m-prose">
              Frame pacing now waits on the clock and the tests pass. I did not look at what happens
              when a frame lands late.
            </p>
          </div>
        </div>
      </div>
      <span className="handoff-link" aria-hidden="true" />
      <div className="handoff-next">
        <p className="m-handoff">
          <AgentMark agent="codex" size={16} />
          Next message includes a handoff to Codex
          <span className="m-strong">Preview</span>
        </p>
        <Composer
          name="Codex"
          text="Check what a late frame does"
          typed
          send={<SendDisc ready />}
        />
      </div>
    </div>
  );
}

const DIFF: readonly (readonly [string, string, string, "add" | "del" | null])[] = [
  ["41", "41", "const frame = clock.now();", null],
  ["42", "", "if (late) skip(frame);", "del"],
  ["", "42", "if (late) return defer(frame);", "add"],
  ["", "43", "budget.record(frame);", "add"],
  ["43", "44", "paint(frame);", null],
];

/** The chat beside its Changes panel (6.14): every turn's files, and a revert from its checkpoint. */
function CheckpointView() {
  return (
    <div className="m-window m-split">
      <div className="m-pane m-split-chat">
        <Header title="Fix the frame pacing" project="auracode" />
        <div className="m-body">
          <p className="m-user">Stop dropping late frames.</p>
          <div className="m-turn">
            <Fold>Thought for 2.4 s</Fold>
            <Tool icon="edit" verb="Edited" object="src/pacing.ts">
              <span className="m-stat">
                <span className="m-add">+12</span> <span className="m-del">−3</span>
              </span>
            </Tool>
            <Tool icon="terminal" verb="Ran" object="cargo test">
              <span className="m-result">14 passed</span>
            </Tool>
            <Actions time="48 s" />
          </div>
        </div>
      </div>
      <div className="m-pane m-changes">
        <div className="m-tabs">
          <span className="m-tab is-on">
            Changes <span className="m-count">2</span>
          </span>
          <span className="m-tab">Files</span>
          <span className="m-tab">Plan</span>
          <span className="m-tab m-tab-wide">Session</span>
          <span className="m-head-end">
            <span className="m-icon-button">
              <Icon name="close" />
            </span>
          </span>
        </div>
        <div className="m-changes-body">
          <p className="m-select">
            Before the latest turn
            <Icon name="chevron-down" size={12} />
          </p>
          <p className="m-file is-on">
            <span className="m-box is-on" />
            <Icon name="file" size={14} />
            <code>src/pacing.ts</code>
            <span className="m-letter">M</span>
          </p>
          <p className="m-file">
            <span className="m-box" />
            <Icon name="file" size={14} />
            <code>src/budget.ts</code>
            <span className="m-letter">M</span>
          </p>
          <div className="m-diff">
            <p className="m-diff-head">
              <Icon name="file" size={14} />
              <code>
                <span className="m-quiet">src/</span>pacing.ts
              </code>
              <span className="m-add">+12</span>
              <span className="m-del">−3</span>
            </p>
            {DIFF.map(([old, now, text, kind]) => (
              <p key={`${old}-${now}`} className={kind ? `m-diff-line is-${kind}` : "m-diff-line"}>
                <span className="m-ln">{old}</span>
                <span className="m-ln">{now}</span>
                <span className="m-sign">{kind === "add" ? "+" : kind === "del" ? "−" : ""}</span>
                {text}
              </p>
            ))}
          </div>
        </div>
        <div className="m-changes-foot">
          <span className="m-quiet">1 selected</span>
          <span className="m-button">
            <Icon name="retry" size={13} />
            Review revert
          </span>
        </div>
      </div>
    </div>
  );
}

/** The picker over the composer (6.10, 6.11): the agent, the model, effort and autonomy. */
function AutonomyView() {
  return (
    <div className="m-pane">
      <Header title="Port the parser to Rust" project="parser" />
      <div className="m-body">
        <p className="m-user">Port the parser to Rust and keep every test green.</p>
        <div className="m-turn">
          <p className="m-prose">
            Ported the tokenizer and the parser. 212 tests pass, and the benchmark runs 3.1 times
            faster.
          </p>
        </div>
      </div>
      <div className="m-dock">
        <div className="m-picker">
          <p className="m-picker-label">Agent</p>
          <p className="m-picker-agent">
            <AgentMark agent="claude-code" size={16} />
            <span className="m-strong">Claude Code</span>
            <code className="m-version">2.1.310</code>
            <Check />
          </p>
          <p className="m-picker-label m-picker-rule">Model</p>
          <p className="m-picker-model">
            <span>
              <span className="m-strong">Sonnet</span>
              <span className="m-quiet">Balanced coding and reasoning</span>
            </span>
            <Check />
          </p>
          <div className="m-picker-fields">
            <p className="m-field">
              <span className="m-field-name">Effort</span>
              <span className="m-segments">
                <span>Low</span>
                <span className="is-on">Medium</span>
                <span>High</span>
              </span>
            </p>
            <p className="m-field">
              <span className="m-field-name">Autonomy</span>
              <span className="m-select-field">
                <Ticks />
                Full auto
                <Icon name="chevron-down" size={12} />
              </span>
            </p>
            <p className="m-picker-note">Full auto. Agents work without asking.</p>
          </div>
        </div>
        <Composer
          name="Claude Code"
          model="Sonnet"
          text="Message Claude Code"
          send={<SendDisc />}
        />
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg className="m-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2.5 6.2 2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A running turn with a message queued behind it, and a typed one ready to steer (6.9, 6.12). */
function QueueView() {
  return (
    <div className="m-pane">
      <Header title="Tighten the sidebar" project="auracode" working />
      <div className="m-body">
        <p className="m-user">Make the sidebar easier to scan and keep the active chat in view.</p>
        <div className="m-turn">
          <Tool icon="edit" verb="Edited" object="src/app/Sidebar.tsx">
            <span className="m-stat">
              <span className="m-add">+24</span> <span className="m-del">−9</span>
            </span>
          </Tool>
          <Tool icon="terminal" verb="Running" object="pnpm test sidebar" live>
            <span className="m-elapsed">0:12</span>
          </Tool>
        </div>
      </div>
      <div className="m-dock">
        <div className="m-queue">
          <p className="m-queue-head">1 queued</p>
          <p className="m-queue-row">
            Then update the changelog
            <Icon name="close" size={14} />
          </p>
        </div>
        <Composer
          name="Codex"
          text="Add a test for late frames"
          typed
          send={
            <>
              <span className="m-disc m-stop">
                <span className="m-stop-square" />
              </span>
              <span className="m-steer">
                Steer
                <span className="m-disc is-ready">
                  <Icon name="arrow-up" size={14} />
                </span>
              </span>
            </>
          }
        />
      </div>
    </div>
  );
}

type Status = "running" | "waiting" | "done" | "idle";

const PROJECTS: readonly {
  name: string;
  chats: readonly { title: string; status: Status; time: string; open?: boolean }[];
}[] = [
  {
    name: "auracode",
    chats: [
      { title: "Fix the flaky login test", status: "running", time: "3m", open: true },
      { title: "Update the changelog", status: "done", time: "4m" },
      { title: "Tighten the hero spacing", status: "idle", time: "Tue" },
    ],
  },
  {
    name: "parser",
    chats: [
      { title: "Port the parser to Rust", status: "waiting", time: "" },
      { title: "Bump the dependencies", status: "running", time: "1m" },
    ],
  },
];

/** The sidebar beside the open chat (6.2): every chat's state at its end, the one that needs you first. */
function SessionsView() {
  return (
    <div className="m-window m-shell">
      <div className="m-sidebar">
        <p className="m-nav">
          <Icon name="search" />
          Search
        </p>
        <p className="m-nav">
          <Icon name="new" />
          New chat
        </p>
        <p className="m-section m-section-attention">
          Needs you <span className="m-volt">1</span>
        </p>
        <p className="m-row m-attention">
          <span className="m-dot is-volt" />
          <span className="m-row-title">
            Port the parser to Rust<span className="m-quiet"> · parser</span>
          </span>
        </p>
        <p className="m-section">
          Projects
          <Icon name="chevron-down" size={12} />
        </p>
        {PROJECTS.map((project) => (
          <div key={project.name} className="m-project">
            <p className="m-row m-project-name">
              <span className="m-dot" />
              {project.name}
            </p>
            {project.chats.map((chat) => (
              <p
                key={chat.title}
                className={`m-row m-chat is-${chat.status}${chat.open ? " is-open" : ""}`}
              >
                <span className="m-row-title">{chat.title}</span>
                {chat.status === "waiting" ? (
                  <span className="m-trail m-volt">
                    <span className="m-dot is-volt" />
                    Needs you
                  </span>
                ) : (
                  <span className="m-trail">
                    {chat.status === "running" ? <Loader /> : null}
                    {chat.status === "done" ? <span className="m-dot is-white" /> : null}
                    <span className="m-time">{chat.time}</span>
                  </span>
                )}
              </p>
            ))}
          </div>
        ))}
        <div className="m-foot">
          <Logo size={24} />
          <span className="m-icon-button">
            <Icon name="settings" />
          </span>
        </div>
      </div>
      <div className="m-pane m-shell-pane">
        <Header title="Fix the flaky login test" project="auracode" working />
        <div className="m-body">
          <p className="m-user">The login test fails one run in ten. Find out why.</p>
          <div className="m-turn">
            <Tool icon="search" verb="Searched" object="waitForLogin">
              <span className="m-result">6 matches</span>
            </Tool>
            <Tool icon="terminal" verb="Running" object="pnpm test login --repeat 20" live>
              <span className="m-elapsed">0:41</span>
            </Tool>
          </div>
        </div>
      </div>
    </div>
  );
}

const ITEMS: readonly {
  id: string;
  title: string;
  text: string;
  view: (pointed: AgentBrandId | null) => ReactNode;
}[] = [
  {
    id: "agents",
    title: "Your agents, as they are",
    text: "Claude Code, Codex, Cursor and six more run through their own harnesses and sign-ins, plus any agent that speaks ACP.",
    view: (pointed) => <AgentsView pointed={pointed} />,
  },
  {
    id: "handoff",
    title: "Switch agents mid-chat",
    text: "Hand the chat to another agent at any turn. The handoff stays in view, so you always know who did what.",
    view: () => <HandoffView />,
  },
  {
    id: "checkpoint",
    title: "Optional file checkpoints",
    text: "Turn on automatic checkpoints in Settings to save files before each message and restore selected files later. Saving adds a delay before sending. Your Git index and branches stay untouched.",
    view: () => <CheckpointView />,
  },
  {
    id: "autonomy",
    title: "Full auto by default",
    text: "Agents edit and run commands without stopping to ask. Switch a chat to Auto-edit or Ask whenever you want a say.",
    view: () => <AutonomyView />,
  },
  {
    id: "queue",
    title: "Queue and steer",
    text: "Type while a turn runs. Your next message waits in a queue, or steers the turn already under way.",
    view: () => <QueueView />,
  },
  {
    id: "sessions",
    title: "Several chats at once",
    text: "Start a chat for each task and let them run side by side. When one needs you, it waits in the Needs you inbox.",
    view: () => <SessionsView />,
  },
];

export function Capabilities() {
  const panel = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(2);
  const [held, setHeld] = useState(false);
  const [live, setLive] = useState(false);
  const [pointed, setPointed] = useState<AgentBrandId | null>(null);
  const intent = useRef(0);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(panel, { threshold: 0.3 });

  // The timer runs only once scripts are in, motion is allowed and nobody is choosing.
  useEffect(() => setLive(true), []);
  useEffect(() => () => window.clearTimeout(intent.current), []);
  const auto = live && !reduced && !held;
  const running = auto && inView && visible;

  const select = (index: number, focus = false) => {
    const next = (index + ITEMS.length) % ITEMS.length;
    setActive(next);
    if (focus) tabs.current[next]?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowRight: active + 1,
      ArrowUp: active - 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: ITEMS.length - 1,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target, true);
  };

  // The cycle holds while the pointer or the focus is anywhere in the panel.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") setHeld(true);
    };
    const leave = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !node.contains(document.activeElement)) setHeld(false);
    };
    const focusIn = () => setHeld(true);
    const focusOut = (event: FocusEvent) => {
      if (!node.contains(event.relatedTarget as Node | null)) setHeld(false);
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focusIn);
    node.addEventListener("focusout", focusOut);
    return () => {
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focusIn);
      node.removeEventListener("focusout", focusOut);
    };
  }, []);

  return (
    <section className="section caps" aria-labelledby="caps-title">
      <div className="wrap">
        <p className="section-kicker" data-reveal="">
          THE WORK / 01
        </p>
        <h2 id="caps-title" className="title title-stack" data-reveal="">
          Built for long turns. <span>And for changing your mind.</span>
        </h2>
        <div
          className="caps-frame"
          data-reveal=""
          ref={panel}
          data-auto={auto ? "" : undefined}
          data-running={running ? "" : undefined}
        >
          <div className="caps-panel">
            <div className="caps-side">
              <div
                className="caps-tabs"
                role="tablist"
                aria-orientation="vertical"
                aria-label="What auracode does"
                onKeyDown={onKey}
              >
                {ITEMS.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`caps-tab-${item.id}`}
                    className="caps-tab"
                    aria-selected={i === active}
                    aria-controls={`caps-note-${item.id}`}
                    tabIndex={i === active ? 0 : -1}
                    ref={(node) => {
                      tabs.current[i] = node;
                    }}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "mouse") return;
                      // Hover intent: a pointer passing over the rows (on its way to the agents'
                      // marks under them) does not switch the view; one that rests does.
                      window.clearTimeout(intent.current);
                      intent.current = window.setTimeout(() => select(i), HOVER_INTENT_MS);
                    }}
                    onPointerLeave={() => window.clearTimeout(intent.current)}
                    onClick={() => select(i)}
                    onFocus={() => select(i)}
                  >
                    <span className="caps-tab-title">{item.title}</span>
                    <span className="caps-track" aria-hidden="true">
                      <span
                        className="caps-fill"
                        onAnimationEnd={() => {
                          if (i === active) select(active + 1);
                        }}
                      />
                    </span>
                  </button>
                ))}
              </div>
              <div className="caps-notes">
                {ITEMS.map((item, i) => (
                  <div
                    key={item.id}
                    role="tabpanel"
                    id={`caps-note-${item.id}`}
                    aria-labelledby={`caps-tab-${item.id}`}
                    className={i === active ? "caps-note is-active" : "caps-note"}
                  >
                    <p>{item.text}</p>
                    {item.id === "agents" ? (
                      <AgentStrip
                        agents={ALL_AGENTS}
                        active={i === active}
                        label="Agents auracode runs"
                        onPoint={setPointed}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="caps-view" aria-hidden="true">
              {ITEMS.map((item, i) => (
                <div key={item.id} className={i === active ? "m-scene is-active" : "m-scene"}>
                  {item.view(pointed)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
