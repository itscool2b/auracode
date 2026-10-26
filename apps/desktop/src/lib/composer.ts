import {
  type ComposerAttachment,
  type ComposerDraft,
  type ComposerInput,
  commands,
  type FileMention,
  type PromptAck,
} from "../bindings";
import { settle } from "./ipc";

export type ComposerContext = Pick<ComposerInput, "attachments" | "mentions">;

/** UI orchestration only. Rust validates, stores, normalizes and resolves every context item. */
export interface ComposerTransport {
  draft(chatId: string): Promise<ComposerDraft>;
  saveDraft(chatId: string, input: ComposerInput): Promise<void>;
  pick(chatId: string): Promise<ComposerAttachment | null>;
  import(chatId: string, path: string): Promise<ComposerAttachment>;
  paste(chatId: string, bytes: number[]): Promise<ComposerAttachment>;
  mentions(chatId: string, query: string): Promise<FileMention[]>;
  send(chatId: string, input: ComposerInput): Promise<PromptAck>;
}

export const composerApi: ComposerTransport = {
  draft: async (id) => settle(commands.composerDraft(id)),
  saveDraft: async (id, input) => settle(commands.composerSaveDraft(id, input)),
  pick: async (id) => settle(commands.composerPick(id)),
  import: async (id, path) => settle(commands.composerImport(id, path)),
  paste: async (id, bytes) => settle(commands.composerPaste(id, bytes)),
  mentions: async (id, query) => settle(commands.composerMentions(id, query)),
  send: async (id, input) => settle(commands.composerSend(id, input)),
};
