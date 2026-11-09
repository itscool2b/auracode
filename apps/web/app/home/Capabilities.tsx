import { AGENT_BRANDS, type AgentBrandId } from "@auracode/ui";
import { Logo } from "@auracode/ui/graphite";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";
import { Words } from "../reveal";
import {
  Actions,
  Check,
  Composer,
  Fold,
  Header,
  Icon,
  Loader,
  SendDisc,
  Stat,
  Tool,
  TurnAgent,
} from "./Mock";
import { AGENTS, SpriteMark } from "./Sprite";

/** How long the pointer rests on a row before its view shows. */
const HOVER_INTENT_MS = 90;

/*
 * Six rows at left and one product view at right, on the page's night band. A glass capsule glides
 * to the active row and fills as its timer runs; the next row takes over when it fills. Focusing or
 * clicking a row shows its view at once, a pointer resting on one for 90ms does too, and the cycle
 * holds while the pointer or focus stays in the panel. The rows are a real tab list (arrow keys,
 * Home, End); each tab's panel is its one-sentence description, and the views illustrate them, so
 * the views stay out of the accessibility tree. Each view plays its own short scene when shown.
 */

/** The agents New chat finds in this view; the rest wait under "Other agents". */
const FOUND: readonly AgentBrandId[] = ["claude-code", "codex", "cursor", "opencode"];

/**
 * New chat: the logo, one line, and the card that picks an agent and a folder. `pointed` is the
 * agent under the pointer in the row beside it: its pill is chosen, or "Other agents" lights when
 * it is not one of the found ones.
 */
function AgentsView({ pointed }: { pointed: AgentBrandId | null }) {
  const found = pointed === null || FOUND.includes(pointed);
  const chosen = pointed !== null && found ? pointed : "claude-code";
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
          Other agents <span className="m-count">{AGENTS.length - FOUND.length}</span>
          <Icon name="chevron" size={12} />
        </p>
      </div>
    </div>
  );
}

/** A chat handed from Claude Code to Codex: the handoff waits in view above the composer. */
function HandoffView() {
  return (
    <div className="handoff-stage">
      <div className="handoff-prior m-window">
        <Header title="Review the pacing change" project="auracode" />
        <div className="m-body">
          <p className="m-user">Check the pacing change for edge cases before we ship.</p>
          <div className="m-turn">
            <TurnAgent agent="claude-code" />
            <Fold>Thought for 3.1 s</Fold>
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
      <span className="handoff-link" aria-hidden="true">
        <span className="handoff-bead" />
      </span>
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

/** The chat beside its Changes panel: every turn's files, and a revert from its checkpoint. */
function CheckpointView() {
  return (
    <div className="m-window m-split">
      <div className="m-split-chat">
        <Header title="Fix the frame pacing" project="auracode" />
        <div className="m-body">
          <p className="m-user">Stop dropping late frames.</p>
          <div className="m-turn">
            <TurnAgent agent="claude-code" />
            <Fold>Thought for 2.4 s</Fold>
            <Tool icon="edit" verb="Edited" object="src/pacing.ts">
              <Stat add={12} del={3} />
            </Tool>
            <Tool icon="terminal" verb="Ran" object="cargo test">
              <span className="m-result">14 passed</span>
            </Tool>
            <Actions time="48 s" />
          </div>
        </div>
      </div>
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

/** The picker over the composer: the agent, the model, effort, and access beside it. */
function AutonomyView() {
  return (
    <div className="m-window m-dock-window">
      <Header title="Port the parser to Rust" project="parser" />
      <div className="m-body">
        <p className="m-user">Port the parser to Rust and keep every test green.</p>
        <div className="m-turn">
          <TurnAgent agent="claude-code" />
          <p className="m-prose">
            Ported the tokenizer and the parser. 212 tests pass, and the benchmark runs 3.1 times
            faster.
          </p>
        </div>
      </div>
      <div className="m-dock">
        <div className="m-picker">
          <p className="m-picker-agent">
            <SpriteMark agent="claude-code" size={16} />
            <span className="m-strong">Claude Code</span>
            <code className="m-version">2.1.310</code>
            <Check />
          </p>
          <p className="m-picker-model">
            <span>
              <span className="m-strong">Sonnet</span>
              <span className="m-quiet">Balanced coding and reasoning</span>
            </span>
            <Check />
          </p>
          <p className="m-field">
            <span className="m-field-name">Effort</span>
            <span className="m-segments">
              <span>Low</span>
              <span className="is-on">Medium</span>
              <span>High</span>
            </span>
          </p>
        </div>
        <Composer
          agent="claude-code"
          model="Sonnet"
          placeholder="Message Claude Code"
          send={<SendDisc />}
        />
      </div>
    </div>
  );
}

/** A running turn with a message queued behind it, and a typed one ready to steer. */
function QueueView() {
  return (
    <div className="m-window m-dock-window">
      <Header title="Tighten the sidebar" project="auracode" working />
      <div className="m-body">
        <p className="m-user">Make the sidebar easier to scan and keep the active chat in view.</p>
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

/** The sidebar beside the open chat: every chat's state at its end, the one that needs you first. */
function SessionsView() {
  let row = 0;
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
          Needs you <span className="m-badge">1</span>
        </p>
        <p className="m-row m-attention" style={{ "--n": row++ } as CSSProperties}>
          <span className="m-dot is-volt" />
          <span className="m-row-title">
            Port the parser to Rust<span className="m-quiet"> · parser</span>
          </span>
        </p>
        <p className="m-section">Projects</p>
        {PROJECTS.map((project) => (
          <div key={project.name} className="m-project">
            <p className="m-row m-project-name" style={{ "--n": row++ } as CSSProperties}>
              <Icon name="folder" size={14} />
              {project.name}
            </p>
            {project.chats.map((chat) => (
              <p
                key={chat.title}
                className={`m-row m-chat is-${chat.status}${chat.open ? " is-open" : ""}`}
                style={{ "--n": row++ } as CSSProperties}
              >
                <span className="m-row-title">{chat.title}</span>
                {chat.status === "waiting" ? (
                  <span className="m-trail m-needs">
                    <span className="m-dot is-volt" />
                    Needs you
                  </span>
                ) : (
                  <span className="m-trail">
                    {chat.status === "running" ? <Loader /> : null}
                    {chat.status === "done" ? <span className="m-dot is-done" /> : null}
                    <span className="m-time">{chat.time}</span>
                  </span>
                )}
              </p>
            ))}
          </div>
        ))}
        <div className="m-foot">
          <Logo size={20} />
          <span className="m-icon-button">
            <Icon name="settings" />
          </span>
        </div>
      </div>
      <div className="m-shell-pane">
        <Header title="Fix the flaky login test" project="auracode" working />
        <div className="m-body">
          <p className="m-user">The login test fails one run in ten. Find out why.</p>
          <div className="m-turn">
            <TurnAgent agent="cursor" />
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

/** The agent marks under the first row; pointing at one chooses it in the view beside. */
function AgentRow({ onPoint }: { onPoint: (agent: AgentBrandId | null) => void }) {
  return (
    <ul
      className="caps-agents"
      aria-label="Agents auracode runs"
      onPointerLeave={() => onPoint(null)}
    >
      {AGENTS.map((agent) => (
        <li
          key={agent}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onPoint(agent);
          }}
        >
          <SpriteMark agent={agent} size={24} />
          <span className="sr-only">{AGENT_BRANDS[agent].name}</span>
        </li>
      ))}
    </ul>
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

  // On narrow screens the rows are a sideways strip of pills: keep the active one in view.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = list.current;
    const tab = tabs.current[active];
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({
      left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [active, reduced]);

  return (
    <section
      className="section caps night"
      id="capabilities"
      aria-labelledby="caps-title"
      data-zone=""
    >
      <div className="caps-sky" aria-hidden="true" />
      <div className="wrap">
        <h2 id="caps-title" className="title">
          <Words text="Built for long turns." />{" "}
          <span className="title-soft">
            <Words text="And for changing your mind." offset={4} />
          </span>
        </h2>
        <div
          className="caps-frame"
          data-reveal=""
          ref={panel}
          data-auto={auto ? "" : undefined}
          data-running={running ? "" : undefined}
          style={{ "--active": active } as CSSProperties}
        >
          <div className="caps-side">
            <div
              className="caps-tabs"
              ref={list}
              role="tablist"
              aria-orientation="vertical"
              aria-label="What auracode does"
              onKeyDown={onKey}
            >
              <span className="caps-glider" aria-hidden="true" />
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
                  <span className="caps-tab-index" aria-hidden="true">
                    <span className="caps-tab-dot" />
                  </span>
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
                  {item.id === "agents" ? <AgentRow onPoint={setPointed} /> : null}
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
    </section>
  );
}
