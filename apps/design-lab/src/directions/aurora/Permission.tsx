import { CircleCheck, CircleX, ShieldAlert } from "lucide-react";
import type { Autonomy, PermissionModel, PermissionOption } from "../../kit";
import { Glass } from "./Glass";
import { Kbd } from "./ui";

/**
 * The shortcut each kind of answer gets on the card. While the composer holds text, Enter sends
 * that text instead, so allowing takes Command as well.
 */
function hintsFor(typing: boolean): Partial<Readonly<Record<PermissionOption["kind"], string>>> {
  return {
    allow_once: typing ? "⌘ ↵" : "↵",
    allow_always: typing ? "⌥ ⌘ ↵" : "⌥ ↵",
    reject_once: "esc",
    reject_always: "esc",
  };
}

/** An answer in the past tense: the chip on the run it held, or the card once answered. */
export const ANSWER_TEXT: Readonly<Record<PermissionOption["kind"], string>> = {
  allow_once: "Allowed once",
  allow_always: "Always allowed",
  reject_once: "Rejected",
  reject_always: "Always rejected",
};

const WHY: Readonly<Record<Autonomy, string>> = {
  full_auto: "",
  auto_edit: "Auto-edit asks before running commands.",
  ask: "Ask mode checks every step with you.",
};

/** Which option a key answers with: only the first option of a kind gets a key. */
export function optionForKey(
  options: readonly PermissionOption[],
  key: "allow" | "always" | "reject",
): PermissionOption | null {
  const kinds =
    key === "allow"
      ? ["allow_once"]
      : key === "always"
        ? ["allow_always"]
        : ["reject_once", "reject_always"];
  return options.find((option) => kinds.includes(option.kind)) ?? null;
}

export function hintFor(
  option: PermissionOption,
  options: readonly PermissionOption[],
  typing = false,
): string | null {
  const hints = hintsFor(typing);
  const hint = hints[option.kind];
  if (!hint) return null;
  // Only the first option of a kind gets the key, so one key never means two answers.
  const first = options.find((candidate) => hints[candidate.kind] === hint);
  return first === option ? hint : null;
}

/**
 * An inline permission card, where the agent asked, standing in for the run it holds. Amber like
 * the light behind it: the one moment the agent waits for you. The first answer is the primary
 * one; each answer shows its key, and the keys work from the composer too.
 */
export function PermissionCard({
  permission,
  agentName,
  autonomy,
  typing,
  onAnswer,
}: {
  readonly permission: PermissionModel;
  readonly agentName: string;
  /** The turn's own autonomy, which is why it asked. */
  readonly autonomy: Autonomy;
  /** The composer holds text: Enter sends it, so the hints show Command. */
  readonly typing: boolean;
  readonly onAnswer: (option: PermissionOption) => void;
}) {
  const tool = permission.tool;
  const command = tool?.kind === "execute" ? tool.target : null;
  const why = WHY[autonomy];
  return (
    <Glass
      level={3}
      radius={16}
      className="au-perm"
      data-state="pending"
      role="group"
      aria-label={`${agentName} asks: ${permission.title}`}
    >
      <div className="au-perm-ask">
        <div className="au-perm-top">
          <span className="au-perm-icon">
            <ShieldAlert size={16} strokeWidth={1.75} />
          </span>
          <div className="au-perm-heading">
            <p className="au-perm-eyebrow">{agentName} needs your approval</p>
            <p className="au-perm-title">{command ? "Run this command?" : permission.title}</p>
          </div>
          {why ? <span className="au-perm-why">{why}</span> : null}
        </div>
        {command ? (
          <div className="au-perm-cmd">
            <span className="au-term-prompt">$</span>
            <code>{command}</code>
          </div>
        ) : null}
        <div className="au-perm-actions">
          {permission.options.map((option, index) => {
            const hint = hintFor(option, permission.options, typing);
            const tone = option.kind.startsWith("reject")
              ? "reject"
              : index === 0
                ? "primary"
                : "secondary";
            return (
              <button
                key={option.option_id}
                type="button"
                className="au-perm-btn"
                data-tone={tone}
                onClick={() => onAnswer(option)}
              >
                {option.label}
                {hint ? <Kbd>{hint}</Kbd> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Glass>
  );
}

/** A request with no run to stand in for, once answered: one quiet line where the card was. */
export function PermissionDone({
  permission,
  answer,
}: {
  readonly permission: PermissionModel;
  readonly answer: PermissionOption | null;
}) {
  const allowed = answer ? answer.kind.startsWith("allow") : permission.status === "allowed";
  return (
    <Glass
      level={3}
      radius={16}
      className="au-perm"
      data-state={allowed ? "allowed" : "rejected"}
      role="group"
      aria-label={permission.title}
    >
      <div className="au-perm-done">
        {allowed ? (
          <CircleCheck size={15} strokeWidth={1.75} className="au-perm-done-ok" />
        ) : (
          <CircleX size={15} strokeWidth={1.75} className="au-perm-done-no" />
        )}
        <span>{answer ? ANSWER_TEXT[answer.kind] : allowed ? "Allowed" : "Not run"}</span>
        <span className="au-run-spacer" />
        <span className="au-perm-done-title">{permission.title}</span>
      </div>
    </Glass>
  );
}
