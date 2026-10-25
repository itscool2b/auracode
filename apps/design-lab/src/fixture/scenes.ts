import type { LabState } from "../lab/states";
import { reduceDiscovery } from "../model/discovery";
import type { TranscriptModel } from "../model/types";
import { APPROVAL } from "./approval";
import { DISCOVERY } from "./discovery";
import { GOLDEN, GOLDEN_EDITED_FILES } from "./golden";
import type {
  ChatRecording,
  ChatStatus,
  Composer,
  DiscoveryTimeline,
  RightPanel,
  Workspace,
} from "./types";
import {
  BASE_WORKSPACE,
  CHAT_ACP,
  CHAT_PACING,
  COMPOSERS,
  NEW_CHAT_COMPOSER,
  PROJECT_AURACODE,
} from "./workspace";

/** What a lab state shows: which recording, how it plays, and which chat is open. */
export interface Scene {
  readonly state: LabState;
  /** The chat's events, or null for a new chat (and for onboarding, which has no chat yet). */
  readonly recording: ChatRecording | null;
  /** First-run agent discovery, played by the player like a recording; null outside onboarding. */
  readonly discovery: DiscoveryTimeline | null;
  /** `loop`: play from the start in real time and loop. `end`: hold the finished timeline. */
  readonly playback: "loop" | "end";
  /** The open chat, or null for a new chat. */
  readonly chatId: string | null;
  readonly projectId: string;
  readonly composer: Composer;
  /** The right panel, when the state opens it. */
  readonly rightPanel: RightPanel | null;
  /**
   * How long the scene runs on after its last event, ms. The permission state holds 9 s past the
   * request, so its frame shows the request at rest (the wait reads 0:09) instead of the instant
   * it arrived.
   */
  readonly holdMs: number;
}

/** The permission state's hold after the request arrives, ms. */
export const PERMISSION_HOLD_MS = 9000;

/** The `changes` state: the Changes tab on this turn's edits, with the renderer's file open. */
export const CHANGES_PANEL: RightPanel = {
  tab: "changes",
  scope: "turn",
  expandedFile: GOLDEN_EDITED_FILES[0] ?? null,
};

export function sceneFor(state: LabState): Scene {
  switch (state) {
    case "streaming":
      return scene(state, GOLDEN, "loop", CHAT_PACING);
    case "settled":
      return scene(state, GOLDEN, "end", CHAT_PACING);
    case "picker":
      return {
        ...scene(state, GOLDEN, "end", CHAT_PACING),
        composer: { ...(COMPOSERS[CHAT_PACING] ?? NEW_CHAT_COMPOSER), pickerOpen: true },
      };
    case "changes":
      return { ...scene(state, GOLDEN, "end", CHAT_PACING), rightPanel: CHANGES_PANEL };
    case "permission":
      return { ...scene(state, APPROVAL, "end", CHAT_ACP), holdMs: PERMISSION_HOLD_MS };
    case "empty":
      return newChat(state, null, "end");
    case "onboarding":
      return newChat(state, DISCOVERY, "loop");
  }
}

function scene(
  state: LabState,
  recording: ChatRecording,
  playback: Scene["playback"],
  chatId: string,
): Scene {
  return {
    state,
    recording,
    discovery: null,
    playback,
    chatId,
    projectId: PROJECT_AURACODE,
    composer: COMPOSERS[chatId] ?? NEW_CHAT_COMPOSER,
    rightPanel: null,
    holdMs: 0,
  };
}

function newChat(
  state: LabState,
  discovery: DiscoveryTimeline | null,
  playback: Scene["playback"],
): Scene {
  return {
    state,
    recording: null,
    discovery,
    playback,
    chatId: null,
    projectId: PROJECT_AURACODE,
    composer: NEW_CHAT_COMPOSER,
    rightPanel: null,
    holdMs: 0,
  };
}

/**
 * How long a scene's timeline runs, in ms: its recording, else its discovery scan, else 0, plus
 * the scene's hold after its last event.
 */
export function sceneDuration(scene: Scene): number {
  return (scene.recording?.duration ?? scene.discovery?.duration ?? 0) + scene.holdMs;
}

/** The open chat's sidebar status, from what its agent is doing right now. */
export function liveStatus(model: TranscriptModel): ChatStatus {
  switch (model.activity) {
    case "thinking":
    case "streaming":
    case "tool":
      return "running";
    case "waiting":
      return "needs_approval";
    case "error":
      return "error";
    default:
      // Done while the user watches is seen, so it is not "done, unseen".
      return "idle";
  }
}

/**
 * The workspace for a scene at one moment: the base sidebar and dock, the scene's open chat,
 * composer and right panel, the open chat's row following the transcript, and the discovery scan
 * after `discoveryCount` of its events (all of them by default).
 */
export function workspaceFor(
  scene: Scene,
  model: TranscriptModel,
  discoveryCount?: number,
): Workspace {
  const status = liveStatus(model);
  return {
    ...BASE_WORKSPACE,
    activeChatId: scene.chatId,
    activeProjectId: scene.projectId,
    composer: scene.composer,
    projects: BASE_WORKSPACE.projects.map((project) => ({
      ...project,
      // The open chat's project is always expanded, so its row is visible.
      expanded: project.expanded || project.id === scene.projectId,
      chats: project.chats.map((chat) =>
        chat.id === scene.chatId ? { ...chat, status, updated: "now" } : chat,
      ),
    })),
    rightPanel: scene.rightPanel,
    discovery: scene.discovery
      ? reduceDiscovery(
          scene.discovery,
          discoveryCount ?? scene.discovery.events.length,
          BASE_WORKSPACE.agents,
        )
      : null,
  };
}
