import { AgentMark, DitherField, Keycap } from "@auracode/ui/graphite";
import { useEffect, useRef, useState } from "react";
import { FILM_FIELD } from "../fields";
import { useInView, usePageVisible, useReducedMotion } from "../motion";

/*
 * x.ai's film card ("The SpaceXAI team runs on Grok Bot": a centred one-line heading over one
 * rounded card, Play and a caption at its left), with one turn of the real app replayed from
 * Graphite fragments instead of a
 * video: the prompt types in, the agent thinks, tool rows land, an approval card resolves, the diff
 * appears and a receipt closes the turn. Times are milliseconds from the start of the replay.
 */
const PROMPT = "Fix the pacing bug, then run the tests.";
const TYPE_FROM = 300;
const TYPE_TO = 1500;
const SENT = 1800;
const THINKING = 2100;
const READ = 3300;
const EDITED = 3900;
const ASKED = 4800;
const ALLOWED = 6400;
const RAN = 6900;
const DIFF = 7500;
const RECEIPT = 8600;
const END = 10400;
const TICK = 50;

/** The field stays calm behind the Play button and the caption. */
const COPY_CLEARING = { x: 0.2, y: 0.5, rx: 0.3, ry: 0.62 };

const CAPTIONS: readonly [number, string][] = [
  [0, "You ask in plain words."],
  [SENT, "The agent works in its own harness."],
  [READ, "Each tool call lands as it runs."],
  [ASKED, "You approve what matters."],
  [ALLOWED, "The change is right there."],
  [RECEIPT, "A receipt closes the turn."],
];

function captionAt(t: number): string {
  let text = CAPTIONS[0]?.[1] ?? "";
  for (const [at, caption] of CAPTIONS) if (t >= at) text = caption;
  return text;
}

/** A diffstat: lines added in green, removed in red, in mono. */
function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="mini-stat">
      <span className="mini-add">+{added}</span>
      <span className="mini-del">−{removed}</span>
    </span>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg
      className="film-icon"
      width="18"
      height="20"
      viewBox="0 0 18 20"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {playing ? (
        <path d="M2 2h5v16H2zM11 2h5v16h-5z" />
      ) : (
        <path d="M2 2h3v16H2zM5 4h3v12H5zM8 6h3v8H8zM11 8h3v4h-3z" />
      )}
    </svg>
  );
}

/** One turn, replayed: the transcript and the composer as they are at time `t`. */
function Replay({ t }: { t: number }) {
  const typed = Math.max(
    0,
    Math.min(PROMPT.length, Math.round(((t - TYPE_FROM) / (TYPE_TO - TYPE_FROM)) * PROMPT.length)),
  );
  const asking = t >= ASKED && t < ALLOWED;
  const working = t >= THINKING && t < RECEIPT;
  return (
    <div className="film-window">
      <div className="film-transcript">
        {t < SENT ? (
          <p className="film-empty">
            <AgentMark agent="claude-code" size={28} />
            <span>
              <span className="mini-strong">Claude Code</span> is ready in{" "}
              <span className="mini-strong">auracode</span>.
            </span>
          </p>
        ) : (
          <p className="mini-user film-enter">{PROMPT}</p>
        )}
        {t >= THINKING ? (
          <div className="mini-byline film-enter">
            <AgentMark
              agent="claude-code"
              state={asking ? "waiting" : working ? "thinking" : "done"}
              size={16}
            />
            <span className="mini-strong">Claude Code</span>
            {working && !asking ? <span className="mini-quiet">Working</span> : null}
          </div>
        ) : null}
        {t >= READ ? (
          <div className="film-tool film-enter">
            <span className="mini-tool">Read</span>
            <span className="mini-code">src/pacing.ts</span>
          </div>
        ) : null}
        {t >= EDITED ? (
          <div className="film-tool film-enter">
            <span className="mini-tool">Edited</span>
            <span className="mini-code">src/pacing.ts</span>
            <Stat added={12} removed={3} />
          </div>
        ) : null}
        {t >= RAN ? (
          <div className="film-tool film-enter">
            <span className="mini-tool">Ran</span>
            <span className="mini-code">cargo test</span>
            <span className="mini-quiet">14 passed</span>
          </div>
        ) : null}
        {t >= DIFF ? (
          <div className="mini-diff film-enter">
            <div className="mini-hunk">src/pacing.ts @@ -41,2 +41,3 @@</div>
            <div className="mini-del-line">
              <span className="mini-ln">42</span>
              <span className="mini-mk">−</span>
              <span>if (late) skip(frame);</span>
            </div>
            <div className="mini-add-line">
              <span className="mini-ln">42</span>
              <span className="mini-mk">+</span>
              <span>if (late) return defer(frame);</span>
            </div>
            <div className="mini-add-line">
              <span className="mini-ln">43</span>
              <span className="mini-mk">+</span>
              <span>budget.record(frame);</span>
            </div>
          </div>
        ) : null}
        {t >= RECEIPT ? (
          <div className="film-receipt film-enter">
            <span className="mini-num">48s</span>
            <span>2 files</span>
            <Stat added={59} removed={12} />
            <span className="film-receipt-end">Claude Code</span>
          </div>
        ) : null}
      </div>
      {asking ? (
        <div className="mini-card film-enter">
          <div className="mini-card-head">
            <AgentMark agent="claude-code" state="waiting" size={16} />
            <p className="mini-ask">
              <span className="mini-quiet">Run</span> <span className="mini-code">cargo test</span>
            </p>
          </div>
          <div className="mini-actions">
            <span className="mini-button mini-button-primary">
              Allow once <Keycap>1</Keycap>
            </span>
            <span className="mini-button mini-button-ghost">
              Deny <Keycap>Esc</Keycap>
            </span>
          </div>
        </div>
      ) : (
        <div className="film-composer">
          {t < SENT && typed > 0 ? (
            <span className="mini-typed">
              {PROMPT.slice(0, typed)}
              <span className="mini-caret" />
            </span>
          ) : (
            <span className="mini-quiet">Message Claude Code</span>
          )}
          <span className="film-chip">
            <AgentMark agent="claude-code" size={14} />
            Claude Code
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The film card. It plays once when it first comes into view and then holds the finished turn;
 * Play replays it and Pause holds it. Without JavaScript or under reduced motion it shows the
 * finished turn, which is also what the server renders.
 */
export function Film() {
  const card = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const inView = useInView(card, { threshold: 0.35 });
  const [t, setT] = useState(END);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);

  // Play once, the first time the card is well in view.
  useEffect(() => {
    if (reduced || !inView || started.current) return;
    started.current = true;
    setT(0);
    setPlaying(true);
  }, [inView, reduced]);

  useEffect(() => {
    if (!playing || reduced || !visible || !inView) return;
    const id = window.setInterval(() => setT((now) => Math.min(END, now + TICK)), TICK);
    return () => window.clearInterval(id);
  }, [playing, reduced, visible, inView]);

  useEffect(() => {
    if (t >= END) setPlaying(false);
  }, [t]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (t >= END) setT(0);
    started.current = true;
    setPlaying(true);
  };

  return (
    <section className="section film" aria-labelledby="film-title">
      <div className="wrap">
        <h2 id="film-title" className="title title-center" data-reveal="">
          One turn, <span>start to finish.</span>
        </h2>
        <div className="film-card" ref={card} data-reveal="">
          <DitherField
            className="film-field"
            cell={FILM_FIELD.cell}
            density={FILM_FIELD.density}
            ceiling={FILM_FIELD.ceiling}
            accent={FILM_FIELD.accent}
            palette={FILM_FIELD.palette}
            seed={FILM_FIELD.seed}
            clearing={COPY_CLEARING}
            transparent
          />
          <div className="film-copy">
            <button
              type="button"
              className="film-play"
              onClick={toggle}
              aria-controls="film-replay"
              hidden={reduced}
            >
              <PlayIcon playing={playing} />
              {playing ? "Pause" : "Play"}
            </button>
            <p className="film-caption">{captionAt(t)}</p>
          </div>
          <div className="film-replay" id="film-replay" aria-hidden="true">
            <Replay t={reduced ? END : t} />
          </div>
        </div>
      </div>
    </section>
  );
}
