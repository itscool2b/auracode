import { PixelLoader } from "@auracode/ui/graphite";
import type { CSSProperties, ReactNode } from "react";

/*
 * Miniatures of the real app, built from Graphite tokens rather than drawn (docs/design/
 * visual-language.md 6.5 and 6.9). They are illustrations, so they are hidden from assistive
 * technology and described in words beside them.
 */

const row = (index: number) => ({ "--row": index }) as CSSProperties;

export function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="mini-stat">
      <span className="mini-add">+{added}</span>
      <span className="mini-del">−{removed}</span>
    </span>
  );
}

function Step({
  state,
  children,
  index,
}: {
  state: "done" | "active" | "pending";
  children: ReactNode;
  index: number;
}) {
  return (
    <li className={`mini-step is-${state} mini-enter`} style={row(index)}>
      <span className="mini-node">
        {state === "active" ? <PixelLoader size={14} tempo="thinking" /> : null}
        {state === "done" ? (
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            shapeRendering="crispEdges"
            aria-hidden="true"
          >
            <path d="M1 4h2v2H1zM3 5h1v2H3zM4 3h1v2H4zM5 2h1v2H5zM6 1h1v2H6z" />
          </svg>
        ) : null}
      </span>
      <span className="mini-step-label">{children}</span>
    </li>
  );
}

export function PlanMini() {
  return (
    <div className="mini mini-plan">
      <div className="mini-plan-card">
        <div className="mini-plan-head mini-enter" style={row(0)}>
          <span className="mini-strong">Plan</span>
          <span className="mini-quiet">2 of 3</span>
        </div>
        <ol className="mini-steps">
          <Step state="done" index={1}>
            Read the frame pacing module
          </Step>
          <Step state="active" index={2}>
            Defer late frames instead of skipping
          </Step>
          <Step state="pending" index={3}>
            Run the pacing tests
          </Step>
        </ol>
        <div className="mini-plan-foot mini-enter" style={row(4)}>
          Updated by Claude Code · <span className="mini-num">0:24</span>
        </div>
      </div>
      <div className="mini-segment mini-enter" style={row(5)}>
        <span className="mini-meta">Plan 2 of 3</span>
        <span className="mini-segment-text">Defer late frames instead of skipping</span>
        <span className="mini-ticks">
          <span className="is-done" />
          <span className="is-active" />
          <span />
        </span>
      </div>
    </div>
  );
}
