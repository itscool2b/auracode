import type {
  AgentAuthStatus,
  AgentEntry,
  AgentMaintenance,
  Autonomy,
  BlobText,
  ChatAttach,
  ChatStatusUpdate,
  ChatSummary,
  ConfigValue,
  EnvStatus,
  EventBatch,
  HistoryPage,
  PromptAck,
  SessionLists,
  StorageStatus,
  UiAnswer,
} from "../../bindings";
import { changesApi } from "../changes";
import { type ComposerTransport, composerApi } from "../composer";
import {
  agentAuthStatus,
  agentMaintenance,
  agentsList,
  agentsRefresh,
  agentUpdate,
  chatAttach,
  chatBlob,
  chatCancelQueued,
  chatCreate,
  chatDetach,
  chatForceStop,
  chatHistory,
  chatInterrupt,
  chatLists,
  chatRespondPermission,
  chatRespondUi,
  chatResumeQueue,
  chatRevealLog,
  chatSend,
  chatSetAutonomy,
  chatSetOption,
  chatStart,
  chatStop,
  chatsList,
  envRefresh,
  envStatus,
  pickFolder,
  statusSubscribe,
  storageStatus,
} from "../ipc";

/**
 * Everything the chat screens ask of the shell. The stores take this interface, so Vitest drives
 * them with a fake (`testing.ts`); `tauriTransport` is the real one over `lib/ipc.ts`, whose
 * wrappers throw `CommandError`s with the shell's codes.
 */
export interface Transport {
  readonly changes?: import("../changes").ChangesTransport;
  readonly composer?: ComposerTransport;
  agentMaintenance(agentId: string): Promise<AgentMaintenance>;
  agentAuthStatus(agentId: string): Promise<AgentAuthStatus>;
  agentUpdate(agentId: string): Promise<void>;
  agentsList(): Promise<AgentEntry[]>;
  agentsRefresh(): Promise<AgentEntry[]>;
  envStatus(): Promise<EnvStatus>;
  envRefresh(): Promise<EnvStatus>;
  pickFolder(): Promise<string | null>;
  chatsList(): Promise<ChatSummary[]>;
  chatCreate(agentId: string, folder: string): Promise<ChatSummary>;
  statusSubscribe(onUpdate: (update: ChatStatusUpdate) => void, onEnd: () => void): Promise<string>;
  storageStatus(): Promise<StorageStatus>;

  /** The join protocol's first half: frames reach `onFrame` from before this resolves on. */
  attach(
    chatId: string,
    onFrame: (frame: EventBatch) => void,
    onEnd: () => void,
  ): Promise<ChatAttach>;
  detach(subscriptionId: string): Promise<void>;
  history(chatId: string, beforeSeq: number): Promise<HistoryPage>;
  lists(chatId: string): Promise<SessionLists>;
  send(chatId: string, text: string): Promise<PromptAck>;
  cancelQueued(chatId: string, promptId: string): Promise<void>;
  resumeQueue(chatId: string): Promise<void>;
  interrupt(chatId: string): Promise<void>;
  forceStop(chatId: string): Promise<void>;
  start(chatId: string, fresh: boolean): Promise<void>;
  stop(chatId: string): Promise<void>;
  respondPermission(chatId: string, requestId: string, optionId: string | null): Promise<void>;
  respondUi(chatId: string, requestId: string, answer: UiAnswer | null): Promise<void>;
  setOption(chatId: string, optionId: string, value: ConfigValue): Promise<SessionLists>;
  setAutonomy(chatId: string, autonomy: Autonomy): Promise<SessionLists>;
  blob(chatId: string, sha256: string, offset: number, len: number): Promise<BlobText>;
  revealLog(chatId: string): Promise<void>;
}

/** The shell, through the typed command wrappers. */
export const tauriTransport: Transport = {
  changes: changesApi,
  composer: composerApi,
  agentMaintenance,
  agentAuthStatus,
  agentUpdate,
  agentsList,
  agentsRefresh,
  envStatus,
  envRefresh,
  pickFolder,
  chatsList,
  chatCreate,
  statusSubscribe,
  storageStatus,
  attach: chatAttach,
  detach: chatDetach,
  history: (chatId, beforeSeq) => chatHistory(chatId, beforeSeq),
  lists: chatLists,
  send: chatSend,
  cancelQueued: chatCancelQueued,
  resumeQueue: chatResumeQueue,
  interrupt: chatInterrupt,
  forceStop: chatForceStop,
  start: chatStart,
  stop: chatStop,
  respondPermission: chatRespondPermission,
  respondUi: chatRespondUi,
  setOption: chatSetOption,
  setAutonomy: chatSetAutonomy,
  blob: chatBlob,
  revealLog: chatRevealLog,
};
