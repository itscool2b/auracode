import type { OrbState } from "@auracode/ui";
import type { ChatState } from "./chatStore";
import { hasProcess, type RenderedSegment, toolDisplayStatus } from "./transcript";

/** Visible protocol activity, with requests taking precedence over a concurrent tool or stream. */
export function chatActivity(state: ChatState): OrbState {
  const status = state.session?.status ?? state.chat?.status ?? "stopped";
  if (status === "failed") return "error";
  if (status === "auth_required") return "waiting";
  if (
    !hasProcess(status) ||
    status === "ready" ||
    status === "stopping" ||
    status === "cancelling"
  ) {
    return "idle";
  }
  for (const item of state.transcript.items.values()) {
    if (
      (item.kind === "permission" ||
        (item.kind === "question" && item.request.prompt.type !== "notify")) &&
      item.resolution === null
    ) {
      const request = state.requests.get(item.request.request_id);
      if (!request?.gone && !request?.busy) return "waiting";
    }
  }
  const segment = state.transcript.segments.at(-1);
  if (status !== "running") return "idle";
  if (!segment) return "thinking";
  for (let index = segment.itemKeys.length - 1; index >= 0; index--) {
    const item = state.transcript.items.get(segment.itemKeys[index] ?? "");
    if (segment.end === null && item?.kind === "message" && !item.completed) return "streaming";
    if (segment.end === null && item?.kind === "thought" && !item.completed) return "thinking";
    if (item?.kind === "tool") {
      const display = toolDisplayStatus(item, segment.end, true);
      if (display === "pending" || display === "in_progress") return "tool";
    }
  }
  return "thinking";
}

/** A live line already owns the gutter, so the pending row must not duplicate it. */
export function hasLiveLine(segment: RenderedSegment | undefined): boolean {
  return (
    segment?.items.some(
      (item) =>
        (segment.end === null &&
          (item.kind === "thought" || item.kind === "message") &&
          !item.completed) ||
        (item.kind === "tool" && (item.display === "pending" || item.display === "in_progress")),
    ) ?? false
  );
}
