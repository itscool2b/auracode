import { createContext } from "react";

/** The background task a transcript tool call started, as the call's Open action needs it. */
export interface TaskLink {
  readonly title: string;
  readonly open: () => void;
}

/** Answers the task a tool call started, by the call's id; `null` outside a chat view. */
export const TaskLinkContext = createContext<((toolCallId: string) => TaskLink | null) | null>(
  null,
);
