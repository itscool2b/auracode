import { AgentMark, Keycap, PixelLoader } from "@auracode/ui/graphite";
import type { CSSProperties, ReactNode } from "react";

/*
 * Miniatures of the real app, built from Graphite tokens rather than drawn: the permission card,
 * the Changes panel, the plan card and the handoff segment (docs/design/visual-language.md 6.5,
 * 6.6, 6.9 and 6.14). They are illustrations, so they are hidden from assistive technology and
 * described in words by their panel.
 */

const row = (index: number) => ({ "--row": index }) as CSSProperties;

function Squares({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  const share = total ? Math.round((added / total) * 5) : 0;
  const green = removed > 0 ? Math.min(4, share) : share;
  const red = removed > 0 ? 5 - green : 0;
  return (
    <span className="mini-squares">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < green ? "is-add" : i < green + red ? "is-del" : undefined} />
      ))}
    </span>
  );
}

function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="mini-stat">
      <span className="mini-add">+{added}</span>
      <span className="mini-del">−{removed}</span>
    </span>
  );
}

export function ApprovalMini() {
  return (
    <div className="mini mini-approval">
      <p className="mini-user mini-enter" style={row(0)}>
        Fix the pacing bug, then run the tests.
      </p>
      <div className="mini-byline mini-enter" style={row(1)}>
        <AgentMark agent="claude-code" size={16} />
        <span className="mini-strong">Claude Code</span>
      </div>
      <div className="mini-context mini-enter" style={row(2)}>
        <span className="mini-tool">Edited</span>
        <span className="mini-code">src/pacing.ts</span>
        <Stat added={12} removed={3} />
      </div>
      <div className="mini-card mini-enter" style={row(3)}>
        <div className="mini-card-head">
          <AgentMark agent="claude-code" state="waiting" size={16} />
          <p className="mini-ask">
            <span className="mini-quiet">Run</span> <span className="mini-code">cargo test</span>{" "}
            <span className="mini-quiet">in</span> <span className="mini-code">auracode</span>
          </p>
          <span className="mini-time">0:09</span>
        </div>
        <p className="mini-reason">Auto-edit asks before running commands.</p>
        <div className="mini-tear" />
        <dl className="mini-rows">
          <div>
            <dt>Command</dt>
            <dd className="mini-code">cargo test -p aura-drivers</dd>
          </div>
          <div>
            <dt>Directory</dt>
            <dd className="mini-code">~/code/auracode</dd>
          </div>
          <div>
            <dt>Autonomy</dt>
            <dd>Auto-edit</dd>
          </div>
        </dl>
        <div className="mini-actions">
          <span className="mini-button mini-button-primary">
            Allow once <Keycap>1</Keycap>
          </span>
          <span className="mini-button">
            Allow in this chat <Keycap>2</Keycap>
          </span>
          <span className="mini-button mini-button-ghost">
            Deny <Keycap>Esc</Keycap>
          </span>
        </div>
      </div>
    </div>
  );
}

const FILES: readonly { path: string; name: string; added: number; removed: number }[] = [
  { path: "src/", name: "pacing.ts", added: 41, removed: 9 },
  { path: "src/", name: "pacing.test.ts", added: 18, removed: 3 },
];

export function ChangesMini() {
  return (
    <div className="mini mini-changes">
      <div className="mini-changes-head mini-enter" style={row(0)}>
        <span className="mini-big">
          <span className="mini-add">+59</span> <span className="mini-del">−12</span>
        </span>
        <Squares added={59} removed={12} />
        <span className="mini-meta">2 files · 48s · Claude Code</span>
      </div>
      <ul className="mini-files">
        {FILES.map((file, i) => (
          <li key={file.name} className="mini-enter" style={row(i + 1)}>
            <span className="mini-code">
              <span className="mini-quiet">{file.path}</span>
              {file.name}
            </span>
            <Stat added={file.added} removed={file.removed} />
            <span className="mini-status">M</span>
          </li>
        ))}
      </ul>
      <div className="mini-diff mini-enter" style={row(3)}>
        <div className="mini-hunk">@@ -40,6 +40,9 @@</div>
        <div>
          <span className="mini-ln">41</span>
          <span className="mini-mk" />
          <span>const frame = clock.now();</span>
        </div>
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
      <div className="mini-foot mini-enter" style={row(4)}>
        <span className="mini-meta">Checkpoint saved before this turn</span>
        <span className="mini-button">Revert</span>
      </div>
    </div>
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

export function HandoffMini() {
  return (
    <div className="mini mini-handoff">
      <div className="mini-event mini-enter" style={row(0)}>
        <AgentMark agent="claude-code" size={14} />
        <span className="mini-strong">Claude Code</span>
        <span className="mini-quiet">finished · 2 files</span>
        <Stat added={59} removed={12} />
      </div>
      <div className="mini-event mini-enter" style={row(1)}>
        <span className="mini-quiet">Switched to</span>
        <AgentMark agent="codex" size={14} />
        <span className="mini-strong">Codex</span>
      </div>
      <div className="mini-handoff-block mini-enter" style={row(2)}>
        <div className="mini-handoff-title">
          <span>Handoff</span>
          <span className="mini-quiet">visible in the prompt</span>
        </div>
        <pre className="mini-handoff-text">
          {
            "Earlier: Defer late frames instead of skipping.\nClaude Code changed 2 files: src/pacing.ts,\nsrc/pacing.test.ts (+59 −12)."
          }
        </pre>
      </div>
      <div className="mini-composer mini-enter" style={row(3)}>
        <div className="mini-composer-segment">
          <AgentMark agent="codex" size={14} />
          <span>
            Next message goes to <span className="mini-strong">Codex</span> with a handoff ·{" "}
            <span className="mini-num">412</span> tokens
          </span>
          <span className="mini-link">Preview</span>
        </div>
        <div className="mini-composer-input">Review the pacing change</div>
      </div>
    </div>
  );
}
