import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { Logo } from "@auracode/ui/graphite";
import type { CSSProperties } from "react";
import { Check, Composer, Header, Icon, SendDisc, Stat, Tool, TurnAgent } from "./Mock";
import { AGENTS, SpriteMark } from "./Sprite";

/*
 * The product views the cards and the agents section show: authored illustrations of supported app
 * states, drawn from the same parts as the hero window (Mock.tsx). They are decorative and sit in
 * aria-hidden frames; the words beside them carry the meaning.
 */

/** The agents New chat finds in this view; the rest wait under "Other agents". */
const FOUND: readonly AgentBrandId[] = ["claude-code", "codex", "cursor", "opencode"];

/**
 * New chat: the logo, one line, and the card that picks an agent and a folder. `chosen` is the
 * agent picked beside it: its pill is chosen, or "Other agents" lights when it is not one of the
 * found ones.
 */
export function NewChatView({ chosen }: { chosen: AgentBrandId }) {
  const found = FOUND.includes(chosen);
  return (
    <div className="m-window m-new">
      <div className="m-new-column">
        <Logo size={30} className="m-new-logo" />
        <p className="m-new-title">What are we working on?</p>
        <div className="m-card">
          <div className="m-card-row">
            <span className="m-pills">
              {FOUND.map((agent, i) => (
                <span
                  key={agent}
                  className={agent === chosen ? "m-pill is-on" : "m-pill"}
                  style={{ "--n": i } as CSSProperties}
                >
                  <SpriteMark agent={agent} size={20} />
                  {AGENT_BRANDS[agent].name}
                </span>
              ))}
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
          {found ? (
            <>
              Other agents <span className="m-count">{AGENTS.length - FOUND.length}</span>
            </>
          ) : (
            <>
              <SpriteMark agent={chosen} size={16} />
              {AGENT_BRANDS[chosen].name}
            </>
          )}
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
      <div className="handoff-prior m-window">
        <Header title="Review the pacing change" project="auracode" />
        <div className="m-body">
          <p className="m-user">Check the pacing change before we ship.</p>
          <div className="m-turn">
            <TurnAgent agent="claude-code" />
            <Tool icon="edit" verb="Edited" object="src/pacing.ts">
              <Stat add={12} del={3} />
            </Tool>
            <p className="m-prose">
              Frame pacing now waits on the clock and the tests pass. I did not look at what happens
              when a frame lands late.
            </p>
          </div>
        </div>
      </div>
      <div className="handoff-next">
        <p className="m-handoff" data-shown="">
          <SpriteMark agent="codex" size={16} />
          <span className="m-handoff-text">Next message includes a handoff to Codex</span>
          <span className="m-strong">Preview</span>
        </p>
        <Composer
          agent="codex"
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

/** The Changes panel: a turn's files, the diff of the open one, and a revert to review. */
export function ChangesView() {
  return (
    <div className="m-window m-changes-window">
      <div className="m-changes">
        <div className="m-tabs">
          <span className="m-tab is-on">
            Changes <span className="m-count">2</span>
          </span>
          <span className="m-tab">Files</span>
          <span className="m-tab">Plan</span>
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
          <p className="m-file is-on" style={{ "--n": 0 } as CSSProperties}>
            <span className="m-box is-on">
              <Check />
            </span>
            <Icon name="file" size={14} />
            <code>src/pacing.ts</code>
            <span className="m-letter">M</span>
          </p>
          <p className="m-file" style={{ "--n": 1 } as CSSProperties}>
            <span className="m-box" />
            <Icon name="file" size={14} />
            <code>src/budget.ts</code>
            <span className="m-letter">M</span>
          </p>
          <div className="m-diff">
            <p className="m-diff-head">
              <code>
                <span className="m-quiet">src/</span>pacing.ts
              </code>
              <Stat add={12} del={3} />
            </p>
            {DIFF.map(([old, now, text, kind], i) => (
              <p
                key={`${old}-${now}`}
                className={kind ? `m-diff-line is-${kind}` : "m-diff-line"}
                style={{ "--n": i } as CSSProperties}
              >
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

/** A running turn with a message queued behind it, and a typed one ready to steer. */
export function QueueView() {
  return (
    <div className="m-window m-dock-window">
      <Header title="Tighten the sidebar" project="auracode" working />
      <div className="m-body">
        <p className="m-user">Make the sidebar easier to scan.</p>
        <div className="m-turn">
          <TurnAgent agent="codex" />
          <Tool icon="edit" verb="Edited" object="src/app/Sidebar.tsx">
            <Stat add={24} del={9} />
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
          agent="codex"
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

/** The terminal card's session, as the agent's own interface draws it. */
const SESSION: readonly { kind: string; text: string }[] = [
  { kind: "prompt", text: "> Fix the header's spacing" },
  { kind: "blank", text: "" },
  { kind: "tool", text: "Read src/shell.css" },
  { kind: "note", text: "  1,612 lines" },
  { kind: "tool", text: "Update src/shell.css" },
  { kind: "del", text: "  - gap: var(--g-space-6);" },
  { kind: "add", text: "  + gap: var(--g-space-8);" },
  { kind: "add", text: "  + align-items: center;" },
  { kind: "blank", text: "" },
  { kind: "reply", text: "The header's controls now share one gap and sit centred." },
];

/**
 * A chat open in its agent's own interface, in auracode's terminal, with Chat one click away. Its
 * lines print one after another when its card scrolls into view.
 */
export function TerminalView() {
  return (
    <div className="tm">
      <div className="tm-bar">
        <span className="tm-title">
          Fix the header spacing <span className="tm-project">auracode</span>
        </span>
        <span className="tm-switch">
          <span>Chat</span>
          <span data-on="">Terminal</span>
        </span>
      </div>
      <div className="tm-screen">
        {SESSION.map((line, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed transcript; the position is identity.
            key={i}
            className="tm-line"
            data-kind={line.kind}
            style={{ "--l": i } as CSSProperties}
          >
            {line.kind === "tool" || line.kind === "reply" ? (
              <span className="tm-dot">●</span>
            ) : null}
            {line.text || " "}
          </span>
        ))}
        <span className="tm-line tm-input" style={{ "--l": SESSION.length } as CSSProperties}>
          {"> "}
          <span className="tm-cursor" />
        </span>
      </div>
    </div>
  );
}
