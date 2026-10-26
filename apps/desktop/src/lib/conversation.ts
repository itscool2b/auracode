import {
  type ContinuationAction,
  type ContinuationPreview,
  type ContinuationResult,
  type ConversationTurns,
  commands,
  type EditablePrompt,
  type PendingHandoff,
} from "../bindings";
import { settle } from "./ipc";

export interface ConversationTransport {
  pending(chat: string): Promise<PendingHandoff | null>;
  turns(chat: string, before: number | null): Promise<ConversationTurns>;
  editable(chat: string, turn: string): Promise<EditablePrompt>;
  preview(chat: string, action: ContinuationAction): Promise<ContinuationPreview>;
  apply(chat: string, token: string): Promise<ContinuationResult>;
}
export const conversationApi: ConversationTransport = {
  pending: (chat) => settle(commands.conversationPending(chat)),
  turns: (chat, before) => settle(commands.conversationTurns(chat, before)),
  editable: (chat, turn) => settle(commands.conversationEditable(chat, turn)),
  preview: (chat, action) => settle(commands.continuationPreview(chat, action)),
  apply: (chat, token) => settle(commands.continuationApply(chat, token)),
};
