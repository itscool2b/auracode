import { Check, ChevronRight, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { PlanEntry, PlanModel } from "../../kit";
import { Shimmer } from "./ui";

/*
 * The plan (visual-language.md 4.5): a stepper with X Money's dashed connector and Harvey's
 * two-tone ring spinner. Done steps strike through, the active one is bright, pending ones wait in
 * text-2. While the agent works it docks in the composer as one segment with three timer rules.
 */

function nodeState(entry: PlanEntry): "done" | "active" | "pending" {
  if (entry.status === "completed") return "done";
  if (entry.status === "in_progress") return "active";
  return "pending";
}

/** The steps: 32px rows with a 14px node on a dashed 3/3 spine. */
export function PlanSteps({ plan }: { readonly plan: PlanModel }) {
  return (
    <ol className="o-steps">
      {plan.entries.map((entry, index) => {
        const state = nodeState(entry);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a plan's entries are positional.
          <li key={index} className="o-step" data-state={state}>
            <span className="o-step-node" aria-hidden="true">
              {state === "done" ? <Check size={8} strokeWidth={3} /> : null}
            </span>
            <span className="o-step-label o-t-ui">{entry.content}</span>
            <span className="o-sr">
              {state === "done" ? "done" : state === "active" ? "in progress" : "to do"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The plan as a card: a 40px header, the steps, and who updated it last. */
export function PlanCard({
  plan,
  agentName,
  updated,
  onHide,
}: {
  readonly plan: PlanModel;
  readonly agentName: string;
  /** When it was last updated, as a clock ("0:27"). */
  readonly updated: string;
  readonly onHide?: () => void;
}) {
  return (
    <div className="o-plan-card">
      <div className="o-plan-card-head">
        <span className="o-t-ui o-w-strong">Plan</span>
        <span className="o-t-ui o-c3 o-num">
          {plan.completed} of {plan.total}
        </span>
        {onHide ? (
          <button type="button" className="o-ghost o-t-meta o-plan-hide" onClick={onHide}>
            Hide
          </button>
        ) : null}
      </div>
      <PlanSteps plan={plan} />
      <p className="o-plan-card-foot o-t-meta o-c3">
        Updated by {agentName} · {updated}
      </p>
    </div>
  );
}

/**
 * The plan segment, docked in the composer shell: PLAN 2/3, the current step with the shimmer,
 * three 24 x 2px timer rules (Harvey), a chevron that opens the card.
 */
export function PlanSegment({
  plan,
  open,
  onToggle,
}: {
  readonly plan: PlanModel;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const current = plan.current;
  return (
    <button
      type="button"
      className="o-segment o-plan-segment"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="o-t-caps o-c3">Plan</span>
      <span className="o-t-mono o-c2 o-num">
        {plan.completed}/{plan.total}
      </span>
      <span className="o-segment-text o-t-ui">
        {plan.done ? (
          <span className="o-plan-complete">
            <Check className="o-add" size={12} strokeWidth={2} aria-hidden="true" />
            Plan complete
          </span>
        ) : current ? (
          <Shimmer>{current.content}</Shimmer>
        ) : null}
      </span>
      <span className="o-rules" aria-hidden="true">
        {plan.entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one rule per entry, in order.
          <span key={index} className="o-rule-tick" data-state={nodeState(entry)} />
        ))}
      </span>
      <ChevronUp
        className="o-segment-chev"
        data-open={open ? "" : undefined}
        size={12}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}

/** A finished plan in the transcript: one line that opens onto its steps. */
export function PlanRow({ plan }: { readonly plan: PlanModel }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="o-plan-row" data-open={open ? "" : undefined}>
      <button
        type="button"
        className="o-tool-row"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {plan.done ? (
          <Check className="o-tool-icon o-add" size={14} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <ChevronRight className="o-tool-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="o-tool-text o-t-ui">
          <span className="o-tool-verb">{plan.done ? "Plan complete" : "Plan"}</span>{" "}
          <span className="o-tool-result o-num">
            {plan.completed} of {plan.total} steps
          </span>
        </span>
        <span className="o-tool-side">
          <ChevronRight
            className="o-tool-hover-chev"
            size={12}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
      </button>
      {open ? (
        <div className="o-well o-plan-well">
          <PlanSteps plan={plan} />
        </div>
      ) : null}
    </div>
  );
}
