import { Check } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DISCOVERY } from "../../fixture/discovery";
import type { AgentInfo, AgentModel, Workspace } from "../../kit";
import {
  agentLetters,
  cursorToAgent,
  cursorToModel,
  openCursor,
  type PickerCursor,
  pickerKey,
} from "./keys";
import { OrbitMark } from "./OrbitMark";
import type { ComposerState } from "./state";
import { Keycap, popover, useOutsideClose, useReduced } from "./ui";

/*
 * Agent > model > effort (visual-language.md 4.10): three columns in one 640px panel. Agents as
 * X Money's two-line switcher items with Notion Calendar's letter keys; models as Grok's menu with
 * a one-line subtitle; efforts as Aside's ladder with numeral keys, consequences from Claude's
 * effort sheet. Letters jump, digits set the effort, arrows move, Enter commits all three. With the
 * mouse, choosing a model commits it (with the effort it keeps or its default), as Grok's and
 * Gemini's menus do; an effort click commits too; the effort column is an optional refinement.
 */

/** One meaningful line per model (Grok's menu): the fixture's descriptions, cut to fit a row. */
const SHORT: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "Most capable",
  "claude-sonnet-5-5": "Fast, everyday coding",
  "claude-haiku-5-5": "Quickest, small edits",
  "gpt-5.5-codex": "Tuned for agentic coding",
  "gpt-5.5": "General reasoning",
  "gpt-5.5-mini": "Fast and light",
  "gemini-3.5-pro": "Deep reasoning",
  "gemini-3.5-flash": "Fast",
  "hermes-4.5-405b": "Largest open model",
  "hermes-4.5-70b": "Faster, lighter",
};

/** How to install an agent that is missing, from the discovery scan. */
const INSTALL: ReadonlyMap<string, string> = new Map(
  DISCOVERY.events.flatMap((entry) =>
    entry.event.type === "agent_missing"
      ? [[entry.event.agent, entry.event.installCommand] as const]
      : [],
  ),
);

/** Context windows for the fixture's models, shown at the right of each model row. */
const CONTEXT: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "1M",
  "claude-sonnet-5-5": "1M",
  "claude-haiku-5-5": "200k",
  "gpt-5.5-codex": "400k",
  "gpt-5.5": "400k",
  "gpt-5.5-mini": "400k",
  "gemini-3.5-pro": "1M",
  "gemini-3.5-flash": "1M",
  "hermes-4.5-405b": "128k",
  "hermes-4.5-70b": "128k",
};

/** What each effort costs, in one line (the picker's footer shows the focused one). */
const CONSEQUENCE: Readonly<Record<string, string>> = {
  off: "answers without thinking first",
  minimal: "thinks only when a step needs it",
  low: "quick on simple steps; saves limits",
  medium: "balanced for everyday work",
  high: "thinks longer on hard steps; uses limits faster",
  xhigh: "thinks hardest on every step; slower",
  max: "the hardest problems; takes longest",
};

function agentLine(agent: AgentInfo): {
  readonly text: string;
  readonly action: "update" | "sign-in" | null;
} {
  if (!agent.installed) return { text: "Not installed", action: null };
  if (agent.update && agent.version)
    return { text: `${agent.version} → ${agent.update}`, action: "update" };
  if (agent.signedIn === false) return { text: agent.version ?? "", action: "sign-in" };
  return { text: `${agent.version ?? ""} · signed in`, action: null };
}

function EffortTicks({ level, of }: { readonly level: number; readonly of: number }) {
  return (
    <span className="o-ticks" aria-hidden="true">
      {Array.from({ length: Math.max(of, 1) }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional.
        <span key={index} className="o-tick" data-on={index <= level ? "" : undefined} />
      ))}
    </span>
  );
}

export function Picker({
  workspace,
  state,
  onCommit,
  onClose,
  anchor,
  onCopy,
}: {
  readonly workspace: Workspace;
  readonly state: ComposerState;
  readonly onCommit: (choice: {
    agent: ComposerState["agent"];
    model: string;
    effort: string | null;
  }) => void;
  readonly onClose: () => void;
  readonly anchor: { readonly current: HTMLElement | null };
  /** Copies a command (an agent's install command) and says so. */
  readonly onCopy: (text: string, done: string) => void;
}) {
  const reduced = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const start = { agent: state.agent, model: state.model, effort: state.effort };
  const [cursor, setCursor] = useState<PickerCursor>(() => openCursor(start));
  const [hoveredEffort, setHoveredEffort] = useState<string | null>(null);
  const agents = workspace.agents;
  const letters = agentLetters(agents);
  const installed = agents.filter((agent) => agent.installed);
  const missing = agents.filter((agent) => !agent.installed);
  const current = agents.find((agent) => agent.id === cursor.agent) ?? null;
  const models: readonly AgentModel[] = current?.models ?? [];
  const model = models.find((candidate) => candidate.id === cursor.model) ?? null;
  const efforts = model?.efforts ?? [];
  useOutsideClose(ref, onClose, anchor);

  const commit = (next: PickerCursor): void =>
    onCommit({
      agent: next.agent as ComposerState["agent"],
      model: next.model,
      effort: next.effort,
    });

  // The picker owns the keyboard while it is open, wherever focus is. `start` is the composer's
  // choice when the picker opened; it does not change while the picker is open.
  const latest = useRef({ cursor, commit, onClose, start });
  latest.current = { cursor, commit, onClose, start: latest.current.start };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Typing in a field elsewhere keeps its keys; arrows and Esc still reach the picker.
      const typing =
        target instanceof HTMLInputElement ||
        (target instanceof HTMLTextAreaElement && !target.closest(".o-composer"));
      if (typing && event.key.length === 1) return;
      const result = pickerKey(latest.current.cursor, event.key, agents, latest.current.start);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      if (result.action === "commit") latest.current.commit(result.cursor);
      else if (result.action === "close") latest.current.onClose();
      else setCursor(result.cursor);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [agents]);

  const focusedEffort =
    hoveredEffort ?? (cursor.column === 2 ? cursor.effort : null) ?? cursor.effort;
  const effortName = efforts.find((effort) => effort.id === focusedEffort)?.label ?? null;

  const agentRow = (agent: AgentInfo) => {
    const line = agentLine(agent);
    const selected = agent.id === cursor.agent;
    return (
      <button
        key={agent.id}
        type="button"
        role="option"
        aria-selected={selected}
        title={agent.installed ? undefined : "Copy the install command"}
        className="o-pick o-pick-agent"
        data-selected={selected ? "" : undefined}
        data-rail={selected && cursor.column === 0 ? "" : undefined}
        data-missing={agent.installed ? undefined : ""}
        onClick={() => {
          const install = INSTALL.get(agent.id);
          // A missing agent's row hands over its install command.
          if (!agent.installed) {
            if (install) onCopy(install, `Copied the install command for ${agent.name}`);
            return;
          }
          // A second click on the agent already chosen commits it as it stands.
          if (agent.id === cursor.agent) commit(cursor);
          else setCursor({ ...cursorToAgent(cursor, agent.id, agents, start), column: 0 });
        }}
      >
        <OrbitMark
          agent={agent.id}
          size={16}
          surface={selected ? "var(--o-pick-selected-surface)" : "var(--o-raised)"}
          ghost={!agent.installed}
          label={agent.name}
        />
        <span className="o-pick-text">
          <span className="o-pick-label o-t-ui o-w-strong">{agent.name}</span>
          <span className="o-pick-sub o-t-mono o-mono-11 o-c3">
            {line.action === "update" && agent.version && agent.update ? (
              // The newer version, in orange, says an update waits; the row's title says how.
              <span title={`Update to ${agent.update}`}>
                {agent.version} {"\u2192"} <span className="o-signal-text">{agent.update}</span>
              </span>
            ) : (
              line.text
            )}
            {line.action === "sign-in" ? (
              <span className="o-signal-text o-pick-action">Sign in</span>
            ) : null}
          </span>
        </span>
        {agent.installed ? (
          <Keycap>{letters.get(agent.id) ?? ""}</Keycap>
        ) : (
          <span
            className="o-text-btn o-t-meta o-pick-install"
            title={INSTALL.get(agent.id) ?? undefined}
          >
            Install
          </span>
        )}
      </button>
    );
  };

  return (
    <motion.div
      ref={ref}
      className="o-picker"
      role="dialog"
      aria-label="Choose agent, model and effort"
      data-orbit-menu=""
      {...popover(reduced)}
    >
      <div className="o-picker-cols">
        <div
          className="o-picker-col"
          data-col="agent"
          data-focus={cursor.column === 0 ? "" : undefined}
        >
          <p className="o-t-caps o-c3 o-picker-label">Agent</p>
          <div role="listbox" aria-label="Agent">
            {installed.map(agentRow)}
          </div>
          {missing.length > 0 ? (
            <>
              <div className="o-menu-rule" />
              <p className="o-t-caps o-c3 o-picker-label">Not installed</p>
              {missing.map(agentRow)}
            </>
          ) : null}
        </div>
        <div
          className="o-picker-col"
          data-col="model"
          data-focus={cursor.column === 1 ? "" : undefined}
        >
          <p className="o-t-caps o-c3 o-picker-label">Model</p>
          <div role="listbox" aria-label="Model">
            {models.map((item) => {
              const selected = item.id === cursor.model;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="o-pick o-pick-model"
                  data-selected={selected ? "" : undefined}
                  data-rail={selected && cursor.column === 1 ? "" : undefined}
                  onClick={() => commit({ ...cursorToModel(cursor, item.id, agents), column: 1 })}
                >
                  <span className="o-pick-text">
                    <span className="o-pick-label o-t-ui o-w-strong">{item.label}</span>
                    <span className="o-pick-sub o-t-meta o-c3" title={item.description}>
                      {SHORT[item.id] ?? item.description}
                    </span>
                  </span>
                  <span className="o-pick-side">
                    {CONTEXT[item.id] ? (
                      <span className="o-t-mono o-mono-11 o-c3">{CONTEXT[item.id]}</span>
                    ) : null}
                    {selected ? (
                      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <span className="o-check-slot" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="o-picker-col"
          data-col="effort"
          data-focus={cursor.column === 2 ? "" : undefined}
        >
          <p className="o-t-caps o-c3 o-picker-label">Effort</p>
          {efforts.length > 0 && model ? (
            <div role="listbox" aria-label="Effort">
              {efforts.map((item, index) => {
                const selected = item.id === cursor.effort;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="o-pick o-pick-effort"
                    data-selected={selected ? "" : undefined}
                    data-rail={selected && cursor.column === 2 ? "" : undefined}
                    onMouseEnter={() => setHoveredEffort(item.id)}
                    onMouseLeave={() => setHoveredEffort(null)}
                    onClick={() => commit({ ...cursor, effort: item.id, column: 2 })}
                  >
                    <EffortTicks level={index} of={efforts.length} />
                    <span className="o-pick-label o-t-ui">{item.label}</span>
                    {item.id === model.defaultEffort ? (
                      <span className="o-t-meta o-c3 o-pick-default">default</span>
                    ) : null}
                    <Keycap>{index + 1}</Keycap>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="o-t-meta o-c3 o-picker-none">No effort setting</p>
          )}
        </div>
      </div>
      <div className="o-picker-foot o-t-meta o-c3">
        <span className="o-legend">
          <Keycap label="Up">{"↑"}</Keycap>
          <Keycap label="Down">{"↓"}</Keycap> move
          <span className="o-c4"> · </span>
          <Keycap label="Left">{"←"}</Keycap>
          <Keycap label="Right">{"→"}</Keycap> column
          <span className="o-c4"> · </span>
          <Keycap label="Enter">{"↵"}</Keycap> choose
          <span className="o-c4"> · </span>
          <Keycap>esc</Keycap> close
        </span>
        {effortName && focusedEffort && CONSEQUENCE[focusedEffort] ? (
          <span className="o-picker-consequence">
            <span className="o-c2">{effortName}:</span> {CONSEQUENCE[focusedEffort]}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}
