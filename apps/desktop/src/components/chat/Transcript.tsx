import { OrbitMark } from "@auracode/ui/orbit";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chatActivity, hasLiveLine } from "../../lib/chat/activity";
import type { ChatState } from "../../lib/chat/chatStore";
import { type RenderedItem, renderCache } from "../../lib/chat/transcript";
import { useStickToBottom } from "../../lib/hooks";
import type { StickToBottom } from "../../lib/stick";
import { type DisclosureChoices, DisclosureMemory } from "./DisclosureMemory";
import { ToolGroup } from "./ToolGroup";
import { type TurnActions, TurnView } from "./TurnView";
import { type TranscriptRow, VirtualRows } from "./VirtualRows";

/**
 * The chat's turns: "Load earlier" at the top while older pages remain, a marker when the oldest
 * loaded turn was cut by a page, then every turn as it renders. Follows the bottom while content
 * grows, unless the reader scrolled up.
 */
export function Transcript({
  state,
  live,
  actions,
  onLoadEarlier,
  dockedRequests,
}: {
  readonly state: ChatState;
  /** The session has a process (tools still running may finish). */
  readonly live: boolean;
  readonly actions: TurnActions;
  readonly onLoadEarlier: () => void;
  readonly dockedRequests?: ReadonlySet<string>;
}) {
  const [render] = useState(renderCache);
  const [disclosures] = useState<DisclosureChoices>(() => new Map());
  const [groups, setGroups] = useState<DisclosureChoices>(() => new Map());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const segments = useMemo(() => render(state.transcript, live), [render, state.transcript, live]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef<StickToBottom | null>(null);
  const captureHistory = useRef<(() => void) | null>(null);
  const [pinned, setPinned] = useState(true);
  const followRef = useStickToBottom<HTMLDivElement>(state.transcript, stick, setPinned);
  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      return followRef(node);
    },
    [followRef],
  );
  const first = segments[0];
  const last = segments.at(-1);
  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  const activity = chatActivity(state);
  const agentId = state.chat?.agent_id ?? "generic";
  const agentName = state.session?.agent_name ?? state.chat?.agent_name ?? "Agent";
  const pendingLabel =
    activity === "waiting"
      ? "Waiting on you"
      : status === "starting"
        ? "Starting session"
        : status === "cancelling" || status === "stopping"
          ? "Stopping"
          : status === "running" && !hasLiveLine(last)
            ? last?.end === null
              ? "Thinking"
              : "Working"
            : null;
  const rows: TranscriptRow[] = [];
  let focusedGroupKey: string | null = null;
  let focusedGroupPhase = "";
  let leading: ReactNode = null;
  if (state.hasMore || first?.partial || state.skipped > 0)
    leading = (
      <div className="chat-segment">
        {state.hasMore ? (
          <div className="ui-row">
            <button
              type="button"
              className="ui-button"
              data-kind="quiet"
              data-testid="load-earlier"
              disabled={state.loadingEarlier}
              onClick={() => {
                captureHistory.current?.();
                onLoadEarlier();
              }}
            >
              {state.loadingEarlier ? "Loading…" : "Load earlier"}
            </button>
            {state.earlierError !== null ? (
              <span role="alert" className="ui-error">
                {state.earlierError}
              </span>
            ) : null}
          </div>
        ) : null}
        {first?.partial ? (
          <p className="chat-marker">Earlier part of this turn not loaded</p>
        ) : null}
        {state.skipped > 0 ? (
          <p className="chat-marker">
            {state.skipped === 1
              ? "1 entry was written by a newer auracode and can't be shown."
              : `${state.skipped} entries were written by a newer auracode and can't be shown.`}
          </p>
        ) : null}
      </div>
    );
  for (const segment of segments) {
    const active = status === "running" && segment === last && segment.end === null;
    let prompt: TranscriptRow["prompt"];
    const addItem = (index: number, item: RenderedItem, grouped = false) =>
      rows.push({
        key: JSON.stringify([segment.key, item.key]),
        estimate: item.kind === "message" ? 200 : item.kind === "user" ? 70 : 48,
        prompt,
        retain:
          (item.kind === "question" || item.kind === "permission") &&
          item.resolution === null &&
          actions.requests.get(item.request.request_id)?.gone !== true &&
          (item.kind !== "question" || item.request.prompt.type !== "notify"),
        content: (
          <TurnView
            segment={segment}
            part={index}
            actions={actions}
            agentId={agentId}
            agentName={agentName}
            active={active}
            live={live}
            suppressByline={grouped}
          />
        ),
      });
    for (let index = 0; index < segment.items.length; index++) {
      const item = segment.items[index];
      if (!item) continue;
      if (item.kind === "permission" && dockedRequests?.has(item.request.request_id)) continue;
      if (item.kind === "user")
        prompt = { key: JSON.stringify([segment.key, item.key]), text: item.text };
      const tools: Extract<RenderedItem, { kind: "tool" }>[] = [];
      if (item.kind === "tool") {
        for (let next = index; next < segment.items.length; next++) {
          const candidate = segment.items[next];
          if (candidate?.kind !== "tool") break;
          tools.push(candidate);
        }
      }
      if (tools.length < 2) {
        addItem(index, item);
        continue;
      }
      const key = JSON.stringify([segment.key, "tool-group", item.key]);
      const failed = tools.some((tool) => tool.display === "failed");
      const phase = failed
        ? "failed"
        : tools.some((tool) => tool.display === "pending" || tool.display === "in_progress")
          ? "running"
          : "settled";
      const choice = groups.get(key);
      const ownsFocus = tools.some(
        (tool) => JSON.stringify([segment.key, tool.key]) === focusedKey,
      );
      if (ownsFocus) {
        focusedGroupKey = key;
        focusedGroupPhase = phase;
      }
      const expanded =
        ownsFocus || (choice?.phase === phase || choice?.open === true ? choice.open : failed);
      rows.push({
        key,
        estimate: 32,
        prompt,
        content: (
          <ToolGroup
            tools={tools}
            expanded={expanded}
            agentId={agentId}
            agentName={agentName}
            byline={
              !segment.partial &&
              index === segment.items.findIndex((candidate) => candidate.kind !== "user")
            }
            onToggle={() =>
              setGroups((current) => new Map(current).set(key, { phase, open: !expanded }))
            }
          />
        ),
      });
      if (expanded)
        tools.forEach((tool, offset) => {
          addItem(index + offset, tool, true);
        });
      index += tools.length - 1;
    }
    if (segment.end !== null || (segment.plan?.length ?? 0) > 0)
      rows.push({
        key: JSON.stringify([segment.key, "footer"]),
        estimate: 50,
        prompt,
        content: (
          <TurnView
            segment={segment}
            part="footer"
            actions={actions}
            agentId={agentId}
            agentName={agentName}
          />
        ),
      });
  }
  if (pendingLabel)
    rows.push({
      key: `now:${last?.key ?? "new"}:${pendingLabel}`,
      estimate: 28,
      content: (
        <NowRow
          key={`${last?.key ?? "new"}:${pendingLabel}`}
          agentId={agentId}
          agentName={agentName}
          label={pendingLabel}
          activity={activity}
          delay={
            (pendingLabel === "Thinking" || pendingLabel === "Working") &&
            (last?.items.some((item) => item.kind !== "user") ?? false)
          }
        />
      ),
    });
  if (segments.length === 0 && state.phase === "live" && pendingLabel === null)
    rows.push({
      key: "empty",
      estimate: 100,
      content: <p className="chat-centered">Nothing here yet. Send a message to start.</p>,
    });
  useLayoutEffect(() => {
    if (focusedGroupKey === null) return;
    const key = focusedGroupKey;
    // A new group may form around a focused call. Keep it open when focus moves to its header,
    // so the header does not collapse before the user's subsequent click can toggle it.
    setGroups((current) =>
      current.get(key)?.open === true
        ? current
        : new Map(current).set(key, { phase: focusedGroupPhase, open: true }),
    );
  }, [focusedGroupKey, focusedGroupPhase]);
  return (
    <div className="chat-transcript-shell">
      <div
        ref={scrollRef}
        className="chat-transcript"
        role="log"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scroll regions need keyboard navigation and a focus target after jumping to latest.
        tabIndex={0}
        aria-label="Transcript"
        data-testid="transcript"
      >
        <DisclosureMemory.Provider value={disclosures}>
          <VirtualRows
            rows={rows}
            leading={leading}
            scroller={scroller}
            stick={stick}
            historyRevision={state.historyRevision}
            historyError={state.earlierError}
            captureHistory={captureHistory}
            focusedKey={focusedKey}
            onFocusKey={setFocusedKey}
          />
        </DisclosureMemory.Provider>
      </div>
      {!pinned ? (
        <button
          type="button"
          className="chat-latest"
          data-testid="jump-latest"
          onClick={() => {
            scroller.current?.focus({ preventScroll: true });
            stick.current?.pin();
          }}
        >
          <span aria-hidden="true">↓</span> Latest
        </button>
      ) : null}
    </div>
  );
}

/** Gaps shorter than 1.2 seconds remain quiet; a new turn and requests show immediately. */
function NowRow({
  agentId,
  agentName,
  label,
  activity,
  delay,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly label: string;
  readonly activity: ReturnType<typeof chatActivity>;
  readonly delay: boolean;
}) {
  const [visible, setVisible] = useState(!delay);
  useEffect(() => {
    if (!delay) return;
    const timeout = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timeout);
  }, [delay]);
  if (!visible) return null;
  return (
    <div className="chat-now" data-state={activity} role="status">
      <OrbitMark
        agent={agentId}
        state={activity}
        size={16}
        label={`${agentName}, ${label.toLowerCase()}`}
      />
      <span>{label}</span>
    </div>
  );
}
