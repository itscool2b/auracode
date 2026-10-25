import type { AgentBrandId } from "@auracode/ui";
import type { AuraEvent } from "../../../desktop/src/bindings";

/*
 * The event model is aura-protocol's AuraEvent (crates/aura-protocol/src/lib.rs, the source of
 * truth), exported to TypeScript by tauri-specta into apps/desktop/src/bindings.ts. These are
 * type-only re-exports: nothing from the desktop app is bundled into the lab, and when the protocol
 * changes, the fixture stops type-checking instead of drifting from it.
 */
export type {
  AuraEvent,
  Cost,
  LimitWindow,
  NoticeLevel,
  PermissionDecision,
  PermissionOption,
  PermissionOptionKind,
  PermissionRequest,
  PlanEntry,
  PlanPriority,
  PlanStatus,
  SessionInfo,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolContent,
  ToolKind,
  ToolLocation,
  ToolStatus,
  ToolUpdate,
  UsageInfo,
  Value,
} from "../../../desktop/src/bindings";

/**
 * What the user sent. Not an AuraEvent: the UI already knows what it sent, and the core stores it
 * with the turn. The lab puts it in the timeline so one list describes the whole chat.
 */
export interface UserMessageEvent {
  readonly type: "user_message";
  readonly message_id: string;
  readonly text: string;
  /** The agent the message went to. A chat can switch agents between turns. */
  readonly agent: AgentBrandId;
}

/** Anything a recorded chat timeline holds. */
export type LabEvent = AuraEvent | UserMessageEvent;

/** One event and when it arrived, in ms from the start of the recording. */
export interface TimedEvent {
  readonly at: number;
  readonly event: LabEvent;
}

/** A recorded chat: its events in arrival order. */
export interface ChatRecording {
  readonly chatId: string;
  readonly events: readonly TimedEvent[];
  /** When the last event arrives, in ms. */
  readonly duration: number;
}

/** Autonomy levels, mirroring aura-protocol's `Autonomy` (not exported to TypeScript yet). */
export type Autonomy = "full_auto" | "auto_edit" | "ask";

/**
 * The live mini-orb on a sidebar row: a turn running, waiting for approval, finished while the chat
 * was not open (done, unseen), failed, or nothing going on.
 */
export type ChatStatus = "running" | "needs_approval" | "done_unseen" | "error" | "idle";

export interface ChatSummary {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  /** The agent that drives the chat now. */
  readonly agent: AgentBrandId;
  readonly status: ChatStatus;
  /** Relative time for the row ("now", "4m", "Tue"). Fixed text, so screenshots never drift. */
  readonly updated: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  /** The project's colour, `#rrggbb`. */
  readonly color: string;
  /** Whether the sidebar shows the project's chats. */
  readonly expanded: boolean;
  readonly chats: readonly ChatSummary[];
}

export interface AgentEffort {
  /** The value the agent takes ("high", "xhigh"). */
  readonly id: string;
  /** What the picker shows ("High", "Extra high"). */
  readonly label: string;
}

export interface AgentModel {
  /** The id the agent reports in `session_updated` ("claude-opus-5-5"). */
  readonly id: string;
  /** What the picker and the composer pill show ("Opus 5.5"). */
  readonly label: string;
  /** One line under the label in the picker. */
  readonly description: string;
  /** Effort levels, lowest first. Empty when the model has no effort setting. */
  readonly efforts: readonly AgentEffort[];
  readonly defaultEffort: string | null;
}

export interface AgentInfo {
  readonly id: AgentBrandId;
  readonly name: string;
  readonly installed: boolean;
  /** Installed version, or null when the agent is not installed. */
  readonly version: string | null;
  /** A newer version the vendor offers, or null when the install is current. */
  readonly update: string | null;
  /** Whether the agent is signed in, or null when it is not installed. */
  readonly signedIn: boolean | null;
  /** Models in picker order. Empty for agents that are not installed. */
  readonly models: readonly AgentModel[];
  readonly defaultModel: string | null;
  /** The autonomy levels the agent supports. Pi never asks, so it only has Full auto. */
  readonly autonomy: readonly Autonomy[];
}

/** The composer under the transcript: who the next message goes to, and how. */
export interface Composer {
  readonly agent: AgentBrandId;
  /** An `AgentModel.id` of that agent. */
  readonly model: string;
  /** An `AgentEffort.id` of that model, or null when the model has no effort setting. */
  readonly effort: string | null;
  readonly autonomy: Autonomy;
  /** Text already typed. */
  readonly draft: string;
  /** Whether the agent > model > effort picker is open (the `picker` state). */
  readonly pickerOpen: boolean;
}

/** Everything around the transcript: sidebar, agent dock, composer. */
export interface Workspace {
  readonly projects: readonly Project[];
  /** The agent dock, in display order. */
  readonly agents: readonly AgentInfo[];
  /** The chat in the main pane, or null for a new chat with no messages yet. */
  readonly activeChatId: string | null;
  /** The project the active chat (or the new chat) belongs to. */
  readonly activeProjectId: string;
  readonly composer: Composer;
  /** Signed out: the base app needs no account. */
  readonly account: { readonly kind: "local"; readonly label: string };
}
