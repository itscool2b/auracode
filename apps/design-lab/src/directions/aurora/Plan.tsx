import { Check, ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { PlanModel } from "../../kit";
import { Glass } from "./Glass";
import { Collapse, Spinner } from "./ui";

export function ProgressRing({ value, done }: { readonly value: number; readonly done: boolean }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <span className="au-ring" data-done={done ? "" : undefined} aria-hidden="true">
      <svg className="au-ring-svg" viewBox="0 0 18 18" width={18} height={18} aria-hidden="true">
        <circle className="au-ring-track" cx="9" cy="9" r={radius} />
        <circle
          className="au-ring-value"
          cx="9"
          cy="9"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
        />
      </svg>
      {done ? <Check className="au-ring-check" size={9} strokeWidth={3} /> : null}
    </span>
  );
}

/** The steps, each with its mark: a quiet check when done, a spinner on the live one. */
export function PlanSteps({ plan }: { readonly plan: PlanModel }) {
  const listRef = useRef<HTMLOListElement>(null);
  const currentIndex = plan.entries.findIndex((entry) => entry.status === "in_progress");

  // A long plan scrolls inside its list; the step in progress stays in view (the page never moves).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || currentIndex < 0) return;
    const row = list.children[currentIndex];
    if (!(row instanceof HTMLElement)) return;
    // The list is positioned, so offsets are in its own scroll content.
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [currentIndex]);

  return (
    <ol ref={listRef} className="au-plan-list">
      {plan.entries.map((entry, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: plan entries are positional; each update replaces the plan.
          key={index}
          className="au-plan-entry"
          data-status={entry.status}
        >
          <span className="au-plan-mark" aria-hidden="true">
            {entry.status === "completed" ? (
              <span key="done" className="au-plan-check">
                <Check size={9} strokeWidth={3} />
              </span>
            ) : entry.status === "in_progress" ? (
              <Spinner size={14} />
            ) : (
              <span className="au-plan-dot" />
            )}
          </span>
          <span className="au-plan-text">{entry.content}</span>
          <span className="au-sr">
            {entry.status === "completed"
              ? "done"
              : entry.status === "in_progress"
                ? "in progress"
                : "to do"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The live plan, docked above the composer: one line by default (progress ring, the step in
 * progress, the count), opening to the checklist on click. It leaves the dock when its turn ends;
 * the turn's footer keeps it from then on.
 */
export function PlanCard({ plan }: { readonly plan: PlanModel }) {
  const [open, setOpen] = useState(false);
  const progress = plan.total === 0 ? 0 : plan.completed / plan.total;
  return (
    <Glass level={2} radius={16} className="au-plan" data-done={plan.done ? "" : undefined}>
      <button
        type="button"
        className="au-plan-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ProgressRing value={progress} done={plan.done} />
        <span className="au-plan-title">Plan</span>
        {!open && plan.current ? (
          <>
            <span className="au-plan-sep" aria-hidden="true" />
            <span className="au-plan-current">{plan.current.content}</span>
          </>
        ) : null}
        <span className="au-run-spacer" />
        <span className="au-plan-count">
          {plan.completed} of {plan.total}
        </span>
        <ChevronDown className="au-chevron" data-open={open ? "" : undefined} size={14} />
      </button>
      <Collapse open={open}>
        <PlanSteps plan={plan} />
      </Collapse>
    </Glass>
  );
}
