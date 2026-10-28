import { agentCode, Shallows, type SwimmerSpec, Swimmers } from "@auracode/ui/graphite";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * Harvey's timer tabs in a Shallows panel (visual language 5.4): six one-line rows at left, one
 * live view of the app at right. The active row runs a 2px timer and the next takes over when it
 * fills; hovering, focusing or clicking a row shows its view at once and holds the cycle while the
 * pointer or focus stays in the panel. Views cross-fade by opacity and a small rise. The rows are
 * a real tab list (arrow keys, Home, End); each tab's panel is its one-sentence description, and
 * the views beside them illustrate it, so they stay out of the accessibility tree.
 */

const SEAL: readonly SwimmerSpec[] = [
  {
    kind: "seal",
    x: 0.14,
    y: 0.86,
    size: "clamp(120px, 14vw, 200px)",
    depth: 0.35,
    speed: 7,
    phase: 4,
  },
];

function Mark({ agent }: { agent: string }) {
  return (
    <span className="m-mark" aria-hidden="true">
      {agentCode(agent)}
    </span>
  );
}

function Chip({ agent, name }: { agent: string; name: string }) {
  return (
    <span className="m-chip">
      <Mark agent={agent} />
      {name}
    </span>
  );
}

function Head({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="m-head">
      <span className="m-title">{title}</span>
      {meta ? <span className="m-meta">{meta}</span> : null}
      <span className="m-head-end">{children}</span>
    </div>
  );
}

function Composer({
  agent,
  name,
  text,
  typed,
}: {
  agent: string;
  name: string;
  text: string;
  typed?: boolean;
}) {
  return (
    <div className="m-composer">
      <span className={typed ? "m-typed" : "m-placeholder"}>
        {text}
        {typed ? <span className="m-caret" /> : null}
      </span>
      <span className="m-composer-row">
        <Chip agent={agent} name={name} />
        <span className="m-chip m-chip-ghost">
          Full auto
          <Chevron />
        </span>
        <span className="m-send">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M6 10V2.5M2.75 5.5 6 2.25 9.25 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </span>
      </span>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="m-chevron" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="m-check" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2.5 6.2 2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const AGENTS: readonly { id: string; name: string; state: string }[] = [
  { id: "claude-code", name: "Claude Code", state: "Signed in" },
  { id: "codex", name: "Codex", state: "Signed in" },
  { id: "cursor", name: "Cursor", state: "Signed in" },
  { id: "grok", name: "Grok Build", state: "Signed in" },
  { id: "opencode", name: "OpenCode", state: "Ready" },
  { id: "pi", name: "Pi", state: "Install" },
];

function AgentsView() {
  return (
    <>
      <Head title="New chat" meta="auracode / main" />
      <div className="m-body m-center">
        <div className="m-menu">
          <p className="m-menu-title">Run this chat with</p>
          {AGENTS.map((agent, i) => (
            <div className={i === 0 ? "m-menu-row is-on" : "m-menu-row"} key={agent.id}>
              <Mark agent={agent.id} />
              <span className="m-strong">{agent.name}</span>
              <span className="m-quiet">{agent.state}</span>
              {i === 0 ? <Check /> : <span className="m-check-space" />}
            </div>
          ))}
          <p className="m-menu-foot">Or any agent that speaks ACP</p>
        </div>
      </div>
    </>
  );
}

function HandoffView() {
  return (
    <>
      <Head title="Review the pacing change">
        <Chip agent="codex" name="Codex" />
      </Head>
      <div className="m-body">
        <p className="m-user">Check the pacing change for edge cases before we ship.</p>
        <div className="m-turn">
          <p className="m-by">
            <Mark agent="claude-code" />
            <span className="m-strong">Claude Code</span>
            <span className="m-quiet">1m 12s</span>
          </p>
          <p className="m-text">
            Frame pacing now waits on the clock. Tests pass. I did not look at what happens when a
            frame lands late.
          </p>
        </div>
        <p className="m-handoff">
          <span className="m-quiet">Handed to</span>
          <span className="m-strong">Codex</span>
          <span className="m-quiet">with the last 3 turns</span>
        </p>
        <div className="m-turn">
          <p className="m-by">
            <Mark agent="codex" />
            <span className="m-strong">Codex</span>
            <span className="m-quiet m-working">Working</span>
          </p>
          <p className="m-text">
            Read the handoff from Claude Code. One edge case is left: a late frame calls{" "}
            <code className="m-code">defer()</code> twice.
          </p>
        </div>
      </div>
      <div className="m-dock">
        <Composer agent="codex" name="Codex" text="Ask Codex anything" />
      </div>
    </>
  );
}

function CheckpointView() {
  return (
    <>
      <Head title="Fix the frame pacing" meta="auracode / main">
        <Chip agent="claude-code" name="Claude Code" />
      </Head>
      <div className="m-body">
        <div className="m-turn">
          <p className="m-by">
            <Mark agent="claude-code" />
            <span className="m-strong">Claude Code</span>
            <span className="m-quiet">48s</span>
          </p>
          <p className="m-tool">
            <span className="m-quiet">Edited</span>
            <code className="m-code">src/pacing.ts</code>
            <span className="m-add">+12</span>
            <span className="m-del">−3</span>
          </p>
          <p className="m-tool">
            <span className="m-quiet">Ran</span>
            <code className="m-code">cargo test</code>
            <span className="m-add">14 passed</span>
          </p>
          <div className="m-diff">
            <p className="m-diff-head">src/pacing.ts</p>
            <p>
              <span className="m-ln">41</span> const frame = clock.now();
            </p>
            <p className="m-diff-del">
              <span className="m-ln">42</span>- if (late) skip(frame);
            </p>
            <p className="m-diff-add">
              <span className="m-ln">42</span>+ if (late) return defer(frame);
            </p>
            <p className="m-diff-add">
              <span className="m-ln">43</span>+ budget.record(frame);
            </p>
          </div>
        </div>
        <div className="m-checkpoint">
          <span className="m-checkpoint-copy">
            <span className="m-strong">Checkpoint</span>
            <span className="m-quiet">Your files before this turn</span>
          </span>
          <span className="m-pill">Restore</span>
        </div>
      </div>
    </>
  );
}

const LEVELS = [
  { title: "Full auto", note: "Edits and runs commands" },
  { title: "Auto-edit", note: "Asks before commands" },
  { title: "Ask", note: "Asks before every change" },
] as const;

function AutonomyView() {
  return (
    <>
      <Head title="Port the parser to Rust" meta="parser / main">
        <Chip agent="claude-code" name="Claude Code" />
      </Head>
      <div className="m-body">
        <p className="m-user">Port the parser to Rust and keep every test green.</p>
        <div className="m-turn">
          <p className="m-by">
            <Mark agent="claude-code" />
            <span className="m-strong">Claude Code</span>
            <span className="m-quiet">2m 40s</span>
          </p>
          <p className="m-text">
            Ported the tokenizer and the parser. 212 tests pass, and the benchmark runs 3.1 times
            faster.
          </p>
        </div>
      </div>
      <div className="m-dock">
        <div className="m-menu m-menu-up">
          {LEVELS.map((level, i) => (
            <div className={i === 0 ? "m-menu-row is-on" : "m-menu-row"} key={level.title}>
              <span className="m-menu-copy">
                <span className="m-strong">{level.title}</span>
                <span className="m-quiet">{level.note}</span>
              </span>
              {i === 0 ? <Check /> : <span className="m-check-space" />}
            </div>
          ))}
        </div>
        <Composer agent="claude-code" name="Claude Code" text="Ask Claude Code anything" />
      </div>
    </>
  );
}

function QueueView() {
  return (
    <>
      <Head title="Tighten the sidebar" meta="auracode / main">
        <Chip agent="claude-code" name="Claude Code" />
      </Head>
      <div className="m-body">
        <p className="m-user">Make the sidebar easier to scan and keep the active chat in view.</p>
        <div className="m-turn">
          <p className="m-by">
            <Mark agent="claude-code" />
            <span className="m-strong">Claude Code</span>
            <span className="m-quiet m-working">Working</span>
          </p>
          <p className="m-tool">
            <span className="m-quiet">Edited</span>
            <code className="m-code">src/app/Sidebar.tsx</code>
            <span className="m-add">+24</span>
            <span className="m-del">−9</span>
          </p>
          <p className="m-tool">
            <span className="m-quiet">Running</span>
            <code className="m-code">pnpm test sidebar</code>
          </p>
        </div>
      </div>
      <div className="m-dock">
        <div className="m-queued">
          <span className="m-quiet">Queued</span>
          <span className="m-queued-text">Then update the changelog</span>
          <span className="m-pill m-pill-ghost">Steer</span>
        </div>
        <div className="m-composer">
          <span className="m-typed">
            Add a test for late frames
            <span className="m-caret" />
          </span>
          <span className="m-composer-row">
            <Chip agent="claude-code" name="Claude Code" />
            <span className="m-pill m-pill-light">Queue</span>
          </span>
        </div>
      </div>
    </>
  );
}

type Status = "running" | "waiting" | "done";

const CHATS: readonly { title: string; agent: string; name: string; status: Status }[] = [
  {
    title: "Fix the flaky login test",
    agent: "claude-code",
    name: "Claude Code",
    status: "running",
  },
  { title: "Port the parser to Rust", agent: "codex", name: "Codex", status: "waiting" },
  { title: "Update the changelog", agent: "opencode", name: "OpenCode", status: "done" },
  { title: "Bump the dependencies", agent: "pi", name: "Pi", status: "running" },
  { title: "Tighten the hero spacing", agent: "cursor", name: "Cursor", status: "done" },
];

const STATUS: Record<Status, string> = { running: "Running", waiting: "Needs you", done: "Done" };

function SessionsView() {
  return (
    <>
      <Head title="Chats" meta="5 open" />
      <div className="m-body">
        <ul className="m-chats">
          {CHATS.map((chat) => (
            <li key={chat.title} className={`m-chat is-${chat.status}`}>
              <span className="m-chat-title">{chat.title}</span>
              <span className="m-chat-agent">
                <Mark agent={chat.agent} />
                {chat.name}
              </span>
              <span className="m-chat-status">
                <span className="m-dot" />
                {STATUS[chat.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

const ITEMS: readonly { id: string; title: string; text: string; view: () => ReactNode }[] = [
  {
    id: "agents",
    title: "Your agents, as they are",
    text: "Claude Code, Codex, Cursor and six more run through their own harnesses and sign-ins, plus any agent that speaks ACP.",
    view: () => <AgentsView />,
  },
  {
    id: "handoff",
    title: "Switch agents mid-chat",
    text: "Hand the chat to another agent at any turn. The handoff stays in view, so you always know who did what.",
    view: () => <HandoffView />,
  },
  {
    id: "checkpoint",
    title: "A checkpoint every turn",
    text: "Before each turn your files are saved to a private shadow Git repository, so any turn can be undone. Your own index and branches stay untouched.",
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
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [live, setLive] = useState(false);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(panel, { threshold: 0.3 });

  // The timer runs only once scripts are in, motion is allowed and nobody is choosing.
  useEffect(() => setLive(true), []);
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
          <Shallows className="caps-panel">
            <Swimmers swimmers={SEAL} className="caps-swimmers" giveWay={false} />
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
                      if (event.pointerType === "mouse") select(i);
                    }}
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
                  <p
                    key={item.id}
                    role="tabpanel"
                    id={`caps-note-${item.id}`}
                    aria-labelledby={`caps-tab-${item.id}`}
                    className={i === active ? "caps-note is-active" : "caps-note"}
                  >
                    {item.text}
                  </p>
                ))}
              </div>
            </div>
            <div className="caps-view" aria-hidden="true">
              {ITEMS.map((item, i) => (
                <div key={item.id} className={i === active ? "m-scene is-active" : "m-scene"}>
                  {item.view()}
                </div>
              ))}
            </div>
          </Shallows>
        </div>
      </div>
    </section>
  );
}
