import { Check, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Autonomy, type PermissionModel, type Player, plural } from "../../kit";
import { InsteadField, WaitClock } from "./Composer";
import { focusOf, permissionKey } from "./keys";
import type { AnswerKind, PermissionAnswer } from "./state";
import { commandRule, formatClock } from "./text";
import { Keycap, TearLine } from "./ui";

/*
 * The permission card (visual-language.md 4.6) takes the composer's place until it is answered
 * (Codex iOS, Perplexity): an orange eyebrow, X Money's sentence with the command as the object,
 * the reason, a tear line over key-value rows, the real answers as pills with their keys, the
 * rule a standing answer saves, and a field to tell the agent what to do instead. Risk is said in
 * words; the buttons stay ink.
 */

const AUTONOMY_DETAIL: Readonly<Record<Autonomy, string>> = {
  full_auto: "Full auto · never asks",
  auto_edit: "Auto-edit · asks before commands",
  ask: "Ask · asks before every step",
};

/** Why the agent asked, from the level it was asked under (not whatever the chip says now). */
const REASON: Readonly<Record<Autonomy, string>> = {
  full_auto: "Final confirm asks before this command.",
  auto_edit: "Auto-edit asks before running commands.",
  ask: "Ask asks before every edit and command.",
};

/** What the agent wants: the command, or the call's title without its question mark. */
function requestedCommand(permission: PermissionModel): string {
  const target = permission.tool?.target;
  if (target) return target;
  return permission.title.replace(/^Run\s+/i, "").replace(/\?$/, "");
}

type Hovered = AnswerKind | "instead" | null;

export function PermissionCard({
  permission,
  agentName,
  projectName,
  autonomy,
  player,
  answer,
  onAnswer,
}: {
  readonly permission: PermissionModel;
  readonly agentName: string;
  readonly projectName: string;
  /** The autonomy the request was asked under. */
  readonly autonomy: Autonomy;
  readonly player: Player;
  readonly answer: PermissionAnswer | null;
  readonly onAnswer: (kind: AnswerKind, instructions: string | null) => void;
}) {
  const [instead, setInstead] = useState("");
  const [hovered, setHovered] = useState<Hovered>(null);
  const [truncated, setTruncated] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const command = requestedCommand(permission);
  const isCommand = permission.tool?.kind === "execute" || /^Run\s/i.test(permission.title);
  const answered = answer !== null;
  const rule = commandRule(command);

  // The decision is where the hands are: the card takes focus, so 1, 2, 3, Enter and Esc answer
  // at once, without a heavy focus ring sitting on Allow once at rest.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  // The full command shows as a row only when the title had to cut it.
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (title) setTruncated(title.scrollHeight > title.clientHeight + 1);
  }, []);

  useEffect(() => {
    if (answered) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const kind = permissionKey(event.key, {
        focus: focusOf(event.target),
        // Nothing answers under a menu or a modal sheet.
        menuOpen: document.querySelector('[data-orbit-menu], [aria-modal="true"]') !== null,
        onButton: target instanceof HTMLButtonElement,
        inCard: target?.closest(".o-permission") !== null && target !== null,
      });
      if (!kind) return;
      event.preventDefault();
      onAnswer(kind, null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, onAnswer]);

  const allowedLabel =
    answer?.kind === "allow_chat"
      ? "Allowed in this chat"
      : answer?.kind === "allow_always"
        ? "Always allowed"
        : "Allowed";
  const ruleCode = <code className="o-perm-rule">{rule}</code>;
  const hint =
    hovered === "allow_once" ? (
      <>Runs this command once. The next one asks again.</>
    ) : hovered === "allow_chat" ? (
      <>Saves the rule {ruleCode} for this chat only.</>
    ) : hovered === "allow_always" ? (
      <>
        Saves the rule {ruleCode} for {projectName}. Change it in Settings.
      </>
    ) : hovered === "deny" ? (
      <>{agentName} gets a no and decides what to do next.</>
    ) : (
      <>Allow in this chat and Always allow save the rule {ruleCode}.</>
    );
  const hover = (kind: Hovered) => ({
    onMouseEnter: () => setHovered(kind),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(kind),
    onBlur: () => setHovered(null),
  });

  return (
    <section
      ref={cardRef}
      className="o-permission"
      data-answered={answered ? answer.kind : undefined}
      aria-label={`${agentName} needs you`}
      role="alertdialog"
      tabIndex={-1}
    >
      <div className="o-perm-eyebrow">
        <span className="o-diamond" aria-hidden="true" />
        <span className="o-t-caps o-signal-text">{agentName} needs you</span>
        <span className="o-perm-wait o-t-mono o-mono-11 o-c3">
          {answer ? (
            <span className="o-num">{formatClock(answer.at - permission.requestedAt)}</span>
          ) : (
            <WaitClock player={player} since={permission.requestedAt} />
          )}
        </span>
      </div>
      <h2 ref={titleRef} className="o-perm-title o-t-sentence">
        {isCommand ? (
          <>
            <span className="o-c3">Run </span>
            <code className="o-perm-literal">{command}</code>
            <span className="o-c3"> in </span>
            <code className="o-perm-literal">{projectName}</code>
          </>
        ) : (
          <span className="o-c1">{permission.title}</span>
        )}
      </h2>
      <p className="o-perm-reason o-t-ui o-c2">
        {agentName} wants to run a command. {REASON[autonomy]}
      </p>
      <TearLine className="o-perm-tear" />
      <dl className="o-perm-rows o-t-ui">
        {truncated ? (
          <div className="o-perm-row">
            <dt className="o-c3">Command</dt>
            <dd className="o-t-mono o-c1 o-perm-command">{command}</dd>
          </div>
        ) : null}
        <div className="o-perm-row">
          <dt className="o-c3">Directory</dt>
          <dd className="o-t-mono o-c1">~/Desktop/{projectName}</dd>
        </div>
        <div className="o-perm-row">
          <dt className="o-c3">Network</dt>
          <dd className="o-c1">Off</dd>
        </div>
        <div className="o-perm-row">
          <dt className="o-c3">Autonomy</dt>
          <dd className="o-c1">{AUTONOMY_DETAIL[autonomy]}</dd>
        </div>
        <div className="o-perm-row">
          <dt className="o-c3">Seen before</dt>
          <dd className="o-c1">Approved {plural(3, "time")} in this project</dd>
        </div>
      </dl>
      <div className="o-perm-actions">
        {instead.trim() !== "" ? (
          <button
            type="button"
            className="o-btn o-btn-ink"
            onClick={() => onAnswer("deny", instead.trim())}
          >
            Send
            <Keycap onInk label="Enter">
              {"↵"}
            </Keycap>
          </button>
        ) : (
          <button
            type="button"
            className="o-btn o-btn-ink o-perm-primary"
            data-done={answer && answer.kind !== "deny" ? "" : undefined}
            disabled={answered}
            onClick={() => onAnswer("allow_once", null)}
            {...hover("allow_once")}
          >
            {answer && answer.kind !== "deny" ? (
              <>
                <Check className="o-drawn" size={14} strokeWidth={2.25} aria-hidden="true" />
                {allowedLabel}
              </>
            ) : (
              <>
                Allow once
                <span className="o-keys">
                  <Keycap onInk>1</Keycap>
                  <Keycap onInk label="Enter">
                    {"↵"}
                  </Keycap>
                </span>
              </>
            )}
          </button>
        )}
        <button
          type="button"
          className="o-btn o-btn-soft"
          disabled={answered}
          onClick={() => onAnswer("allow_chat", null)}
          {...hover("allow_chat")}
        >
          Allow in this chat
          <Keycap>2</Keycap>
        </button>
        <button
          type="button"
          className="o-btn o-btn-soft"
          disabled={answered}
          onClick={() => onAnswer("allow_always", null)}
          {...hover("allow_always")}
        >
          Always allow in {projectName}
          <Keycap>3</Keycap>
        </button>
        <span className="o-perm-gap" />
        <button
          type="button"
          className="o-btn o-btn-ghost o-perm-deny"
          data-done={answer?.kind === "deny" ? "" : undefined}
          disabled={answered}
          onClick={() => onAnswer("deny", null)}
          {...hover("deny")}
        >
          {answer?.kind === "deny" ? (
            <>
              <X className="o-del" size={14} strokeWidth={2.25} aria-hidden="true" />
              Denied
            </>
          ) : (
            <>
              Deny
              <Keycap>esc</Keycap>
            </>
          )}
        </button>
      </div>
      <p className="o-perm-hint o-t-meta o-c3" aria-live="polite">
        {hint}
      </p>
      <div className="o-perm-instead">
        <InsteadField
          agentName={agentName}
          value={instead}
          onChange={setInstead}
          onSubmit={() => onAnswer("deny", instead.trim())}
        />
      </div>
    </section>
  );
}
