import type { LabState } from "../lab/states";
import type { TranscriptModel } from "../model/types";
import { APPROVAL } from "./approval";
import { GOLDEN } from "./golden";
import type { ChatRecording, ChatStatus, Composer, Workspace } from "./types";
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
  /** The chat's events, or null for a new chat. */
  readonly recording: ChatRecording | null;
  /** `loop`: play from the start in real time and loop. `end`: hold the finished recording. */
  readonly playback: "loop" | "end";
  /** The open chat, or null for a new chat. */
  readonly chatId: string | null;
  readonly projectId: string;
  readonly composer: Composer;
}

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
    case "permission":
      return scene(state, APPROVAL, "end", CHAT_ACP);
    case "empty":
      return {
        state,
        recording: null,
        playback: "end",
        chatId: null,
        projectId: PROJECT_AURACODE,
        composer: NEW_CHAT_COMPOSER,
      };
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
    playback,
    chatId,
    projectId: PROJECT_AURACODE,
    composer: COMPOSERS[chatId] ?? NEW_CHAT_COMPOSER,
  };
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
 * The workspace for a scene at one moment: the base sidebar and dock, the scene's open chat and
 * composer, and the open chat's row following the transcript.
 */
export function workspaceFor(scene: Scene, model: TranscriptModel): Workspace {
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
  };
}
