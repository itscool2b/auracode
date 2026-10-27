import { type KeyboardEvent, useRef, useState } from "react";
import { useInView, usePageVisible, useReducedMotion } from "../motion";
import { ApprovalMini, ChangesMini, HandoffMini, PlanMini } from "./minis";

const CAPABILITIES = [
  {
    id: "approvals",
    title: "Approvals",
    text: "Choose how much an agent may do alone. When it asks, the request takes the composer's place, and Allow once or Deny is one key away.",
    picture:
      "A permission card from Claude Code asking to run cargo test in auracode, with Allow once, Allow in this chat and Deny.",
    Mini: ApprovalMini,
  },
  {
    id: "changes",
    title: "Changes",
    text: "Every turn is checkpointed before it runs. Read each file's diff and revert a turn, without touching your Git index.",
    picture:
      "The Changes panel after a turn: two files, 59 lines added and 12 removed, a diff, and Revert.",
    Mini: ChangesMini,
  },
  {
    id: "plans",
    title: "Plans",
    text: "When an agent shares its plan, the steps stay in view and the current one is marked as the work moves.",
    picture:
      "A plan card with three steps: one done, one in progress and one waiting, updated by Claude Code.",
    Mini: PlanMini,
  },
  {
    id: "handoffs",
    title: "Handoffs",
    text: "Switch agents in the middle of a chat. The next one gets a handoff you can read first, never a hidden prompt.",
    picture:
      "A chat switching from Claude Code to Codex, with the visible handoff and its token count above the composer.",
    Mini: HandoffMini,
  },
] as const;

/**
 * Harvey's timer tabs: the active capability's 2px rule fills linearly over 7500ms, then the next
 * opens. Hovering or focusing the list pauses it, as does leaving the viewport or hiding the tab.
 * Arrow keys, Home and End move between tabs. Reduced motion never advances on its own.
 */
export function Capabilities() {
  const band = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [run, setRun] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(band, { threshold: 0.25 });
  const paused = hovered || focused || !visible || !inView;
  const count = CAPABILITIES.length;

  const select = (index: number, focus = false) => {
    setActive(index);
    setRun((value) => value + 1);
    if (focus) tabs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowRight: active + 1,
      ArrowUp: active - 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select((next + count) % count, true);
  };

  return (
    <section className="section capabilities" ref={band} aria-labelledby="capabilities-title">
      <div className="frame">
        <div className="section-inner">
          <h2 id="capabilities-title" className="section-title" data-reveal="">
            Agents do the work. <span>You make the calls.</span>
          </h2>
          <div className="cap-grid" data-paused={paused ? "" : undefined}>
            <div
              className="cap-list"
              role="tablist"
              aria-label="Capabilities"
              aria-orientation="vertical"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setFocused(false);
              }}
            >
              {CAPABILITIES.map((item, i) => {
                const selected = i === active;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      tabs.current[i] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`cap-tab-${item.id}`}
                    className="cap-tab"
                    aria-selected={selected}
                    aria-controls={`cap-panel-${item.id}`}
                    aria-labelledby={`cap-title-${item.id}`}
                    aria-describedby={`cap-text-${item.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => select(i)}
                    onKeyDown={onKeyDown}
                  >
                    <span className="cap-track" aria-hidden="true">
                      <span
                        key={selected ? `run-${run}` : "idle"}
                        className="cap-fill"
                        onAnimationEnd={() => {
                          if (selected && !reduced) select((i + 1) % count);
                        }}
                      />
                    </span>
                    <span className="cap-title" id={`cap-title-${item.id}`}>
                      {item.title}
                    </span>
                    <span className="cap-text">
                      <span id={`cap-text-${item.id}`}>{item.text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="cap-stage">
              {CAPABILITIES.map((item, i) => {
                const selected = i === active;
                const Mini = item.Mini;
                return (
                  <div
                    key={item.id}
                    role="tabpanel"
                    id={`cap-panel-${item.id}`}
                    className="cap-panel"
                    aria-labelledby={`cap-tab-${item.id}`}
                    data-active={selected ? "" : undefined}
                    tabIndex={selected ? 0 : -1}
                  >
                    <p className="sr-only">{item.picture}</p>
                    <div className="cap-tile" aria-hidden="true">
                      <Mini key={selected ? `shown-${run}` : "hidden"} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
