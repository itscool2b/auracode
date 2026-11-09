import {
  type ComposerAttachment,
  type ComposerDraft,
  type ComposerInput,
  commands,
  type FileMention,
  type ProjectFilePreview,
  type PromptAck,
  type SteeringAck,
} from "../bindings";
import { type DictationApi, dictationApi } from "./dictation";
import { settle } from "./ipc";

export type ComposerContext = Pick<ComposerInput, "attachments" | "mentions">;

/** UI orchestration only. Rust validates, stores, normalizes and resolves every context item. */
export interface ComposerTransport {
  readonly dictation?: DictationApi;
  file?(chatId: string, path: string): Promise<ProjectFilePreview>;
  draft(chatId: string): Promise<ComposerDraft>;
  saveDraft(chatId: string, input: ComposerInput): Promise<void>;
  pick(chatId: string): Promise<ComposerAttachment | null>;
  import(chatId: string, path: string): Promise<ComposerAttachment>;
  /** An image's bytes; `name` is a PNG file name of the page's own (the canvas's drawing). */
  paste(chatId: string, bytes: number[], name?: string): Promise<ComposerAttachment>;
  mentions(chatId: string, query: string): Promise<FileMention[]>;
  send(chatId: string, input: ComposerInput): Promise<PromptAck>;
  steer?(chatId: string, expectedTurnId: string, input: ComposerInput): Promise<SteeringAck>;
}

export const composerApi: ComposerTransport = {
  dictation: dictationApi,
  file: async (id, path) => settle(commands.projectFilePreview(id, path)),
  draft: async (id) => settle(commands.composerDraft(id)),
  saveDraft: async (id, input) => {
    await settle(commands.composerSaveDraft(id, input));
  },
  pick: async (id) => settle(commands.composerPick(id)),
  import: async (id, path) => settle(commands.composerImport(id, path)),
  paste: async (id, bytes, name) => settle(commands.composerPaste(id, bytes, name ?? null)),
  mentions: async (id, query) => settle(commands.composerMentions(id, query)),
  send: async (id, input) => settle(commands.composerSend(id, input)),
  steer: async (id, turn, input) => settle(commands.composerSteer(id, turn, input)),
};
