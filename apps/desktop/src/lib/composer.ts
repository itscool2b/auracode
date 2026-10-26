import {
  type ComposerAttachment,
  type ComposerInput,
  commands,
  type FileMention,
  type PromptAck,
} from "../bindings";
import { settle } from "./ipc";

export type ComposerContext = Pick<ComposerInput, "attachments" | "mentions">;

/** UI orchestration only. Rust validates, stores, normalizes and resolves every context item. */
export interface ComposerTransport {
  pick(chatId: string): Promise<ComposerAttachment | null>;
  import(chatId: string, path: string): Promise<ComposerAttachment>;
  paste(chatId: string, bytes: number[]): Promise<ComposerAttachment>;
  mentions(chatId: string, query: string): Promise<FileMention[]>;
  send(chatId: string, input: ComposerInput): Promise<PromptAck>;
}

export const composerApi: ComposerTransport = {
  pick: async (id) => settle(await commands.composerPick(id)),
  import: async (id, path) => settle(await commands.composerImport(id, path)),
  paste: async (id, bytes) => settle(await commands.composerPaste(id, bytes)),
  mentions: async (id, query) => settle(await commands.composerMentions(id, query)),
  send: async (id, input) => settle(await commands.composerSend(id, input)),
};
