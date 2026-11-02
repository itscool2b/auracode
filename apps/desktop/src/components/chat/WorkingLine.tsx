import { getBrand, type OrbState, usePrefersReducedMotion } from "@auracode/ui";
import { AgentMark } from "@auracode/ui/graphite";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  formatElapsed,
  rotationDelay,
  seedOf,
  type WorkingContext,
  workingVerb,
} from "../../lib/chat/working";

/** What the tail of a running turn shows in place of its footer. */
export type LiveTail =
  | {
      readonly kind: "working";
      /** The turn's key: it seeds the words, so the turn always reads the same. */
      readonly seed: string;
      readonly context: WorkingContext;
      /** False while the turn's newest output is text streaming in: the text is the live part. */
      readonly visible: boolean;
      /** When the UI first saw the turn working (ms since the epoch). */
      readonly since: number;
    }
  | { readonly kind: "waiting" }
  | { readonly kind: "stopping" };

/** After streamed text ends, the line waits this long before it returns: a turn may end first. */
const RETURN_DELAY_MS = 450;

/** The longest a leaving verb stays, in case its animation never reports its end. */
const LEAVE_MS = 400;

/**
 * The working line (docs/design/visual-language.md): one quiet line at the tail of a running turn.
 * A halo in the agent's own glow breathes in the gutter on the composer rim's 2400ms rhythm, and a
 * playful verb stands in for the agent's reasoning, swapping every 2.5 to 3.5 seconds with a soft
 * crossfade while a sheen passes over it. The elapsed time sits at the line's end in metadata
 * type. Screen readers hear "<agent> is working" once; the verbs and the time are not announced.
 * Under reduced motion (the OS's or the app's setting) the first verb stays and nothing moves.
 */
export function WorkingLine({
  seed,
  context,
  visible,
  since,
  agentId,
  agentName,
  reduced,
}: {
  readonly seed: string;
  readonly context: WorkingContext;
  readonly visible: boolean;
  readonly since: number;
  readonly agentId: string;
  readonly agentName: string;
  /** Overrides the motion preference (server rendering cannot read it). */
  readonly reduced?: boolean;
}) {
  const preference = usePrefersReducedMotion();
  const still = reduced ?? preference;
  const number = useMemo(() => seedOf(seed), [seed]);
  const [word, setWord] = useState(() => ({ tick: 0, verb: workingVerb(number, 0, context) }));
  const [leaving, setLeaving] = useState<{ tick: number; verb: string } | null>(null);
  const [shown, setShown] = useState(visible);
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef({ word, context });
  latest.current = { word, context };

  // Text streaming in hides the line at once; it returns only once the text has rested a moment.
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  // The rotation rests while the line is hidden or the window is.
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (still || !shown || hidden) return;
    const timer = setTimeout(
      () => {
        const current = latest.current.word;
        const tick = current.tick + 1;
        setLeaving(current);
        setWord({ tick, verb: workingVerb(number, tick, latest.current.context) });
      },
      rotationDelay(number, word.tick),
    );
    return () => clearTimeout(timer);
  }, [still, shown, hidden, number, word.tick]);

  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="chat-working"
      data-testid="working-line"
      data-hidden={shown ? undefined : ""}
      data-still={still ? "" : undefined}
      data-test-verb={word.verb}
      style={{ "--agent-glow": getBrand(agentId).glow } as CSSProperties}
    >
      {/* One text node, so the live region reads as one sentence. */}
      <span className="sr-only" role="status">{`${agentName} is working`}</span>
      <span className="chat-gutter" aria-hidden="true">
        <span className="chat-working-halo" />
      </span>
      <span className="chat-working-words" aria-hidden="true">
        {leaving !== null && !still ? (
          <span
            key={`verb-${leaving.tick}`}
            className="chat-working-verb"
            data-leaving=""
            onAnimationEnd={() => setLeaving(null)}
          >
            {leaving.verb}…
          </span>
        ) : null}
        <span
          key={`verb-${word.tick}`}
          className="chat-working-verb"
          data-entering={word.tick > 0 ? "" : undefined}
        >
          {word.verb}…
          {still ? null : (
            <span className="chat-working-sheen">
              <span>{word.verb}…</span>
            </span>
          )}
        </span>
      </span>
      <span className="chat-working-time" aria-hidden="true">
        {formatElapsed(now - since)}
      </span>
    </div>
  );
}

/** A plain live line: the agent's mark in its state, and what it waits on ("Waiting on you"). */
export function NowLine({
  agentId,
  agentName,
  label,
  state,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly label: string;
  readonly state: OrbState;
}) {
  return (
    <div className="chat-now" data-state={state} role="status">
      <span className="chat-gutter">
        <AgentMark
          agent={agentId}
          state={state}
          size={16}
          label={`${agentName}, ${label.toLowerCase()}`}
        />
      </span>
      <span>{label}</span>
    </div>
  );
}

/** The tail of a running turn: the working line, or what the agent waits on. */
export function LiveTailLine({
  tail,
  agentId,
  agentName,
}: {
  readonly tail: LiveTail;
  readonly agentId: string;
  readonly agentName: string;
}) {
  switch (tail.kind) {
    case "working":
      return (
        <WorkingLine
          seed={tail.seed}
          context={tail.context}
          visible={tail.visible}
          since={tail.since}
          agentId={agentId}
          agentName={agentName}
        />
      );
    case "waiting":
      return (
        <NowLine agentId={agentId} agentName={agentName} label="Waiting on you" state="waiting" />
      );
    case "stopping":
      return <NowLine agentId={agentId} agentName={agentName} label="Stopping" state="idle" />;
  }
}
