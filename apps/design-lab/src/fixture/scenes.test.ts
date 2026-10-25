import { describe, expect, it } from "vitest";
import { LAB_STATES } from "../lab/states";
import { shareStructure } from "../model/share";
import { EMPTY_TRANSCRIPT, eventsAt, reduceTranscript } from "../model/transcript";
import { APPROVAL } from "./approval";
import { GOLDEN } from "./golden";
import { liveStatus, sceneFor, workspaceFor } from "./scenes";
import { CHAT_ACP, CHAT_PACING, findChat, PROJECT_AURACODE } from "./workspace";

const goldenAt = (seconds: number) =>
  reduceTranscript(GOLDEN.events.slice(0, eventsAt(GOLDEN.events, seconds * 1000)));

describe("sceneFor", () => {
  it("maps every state to its recording, playback and chat", () => {
    const summary = Object.fromEntries(
      LAB_STATES.map((state) => {
        const scene = sceneFor(state);
        return [
          state,
          [
            scene.recording?.chatId ?? null,
            scene.playback,
            scene.chatId,
            scene.composer.pickerOpen,
          ],
        ];
      }),
    );
    expect(summary).toEqual({
      streaming: [CHAT_PACING, "loop", CHAT_PACING, false],
      settled: [CHAT_PACING, "end", CHAT_PACING, false],
      empty: [null, "end", null, false],
      permission: [CHAT_ACP, "end", CHAT_ACP, false],
      picker: [CHAT_PACING, "end", CHAT_PACING, true],
    });
    for (const state of LAB_STATES) expect(sceneFor(state).projectId).toBe(PROJECT_AURACODE);
  });

  it("uses each chat's own composer", () => {
    expect(sceneFor("settled").composer).toMatchObject({
      agent: "claude-code",
      autonomy: "full_auto",
    });
    expect(sceneFor("permission").composer).toMatchObject({
      agent: "codex",
      autonomy: "auto_edit",
    });
    expect(sceneFor("empty").composer).toMatchObject({ agent: "claude-code", draft: "" });
  });
});

describe("workspaceFor", () => {
  it("keeps the open chat's row in step with the transcript", () => {
    const scene = sceneFor("streaming");
    const status = (seconds: number) =>
      findChat(workspaceFor(scene, goldenAt(seconds)), CHAT_PACING)?.status;
    expect(status(5)).toBe("running");
    expect(status(24)).toBe("running");
    expect(status(60)).toBe("idle");
    expect(findChat(workspaceFor(scene, goldenAt(60)), CHAT_PACING)?.updated).toBe("now");
  });

  it("shows the Codex chat waiting for approval, and leaves other rows alone", () => {
    const workspace = workspaceFor(sceneFor("permission"), reduceTranscript(APPROVAL.events));
    expect(workspace.activeChatId).toBe(CHAT_ACP);
    expect(findChat(workspace, CHAT_ACP)?.status).toBe("needs_approval");
    expect(findChat(workspace, CHAT_PACING)?.status).toBe("running");
  });

  it("opens a new chat with no row selected", () => {
    const workspace = workspaceFor(sceneFor("empty"), EMPTY_TRANSCRIPT);
    expect(workspace.activeChatId).toBeNull();
    expect(workspace.projects.find((project) => project.id === PROJECT_AURACODE)?.expanded).toBe(
      true,
    );
    expect(workspace.composer.pickerOpen).toBe(false);
  });

  it("keeps unchanged parts identical between renders, once shared", () => {
    const scene = sceneFor("streaming");
    const before = workspaceFor(scene, goldenAt(10));
    expect(shareStructure(before, workspaceFor(scene, goldenAt(11)))).toBe(before);
    const after = shareStructure(before, workspaceFor(scene, goldenAt(60)));
    expect(after).not.toBe(before);
    expect(after.agents).toBe(before.agents);
    expect(after.projects[1]).toBe(before.projects[1]);
    expect(after.projects[0]?.chats[1]).toBe(before.projects[0]?.chats[1]);
    expect(after.projects[0]?.chats[0]).not.toBe(before.projects[0]?.chats[0]);
  });

  it("opens the picker only in the picker state", () => {
    expect(workspaceFor(sceneFor("picker"), goldenAt(60)).composer.pickerOpen).toBe(true);
    expect(workspaceFor(sceneFor("settled"), goldenAt(60)).composer.pickerOpen).toBe(false);
  });
});

describe("liveStatus", () => {
  it("reads the sidebar dot from the agent's activity", () => {
    expect(liveStatus(EMPTY_TRANSCRIPT)).toBe("idle");
    expect(liveStatus(goldenAt(3))).toBe("running");
    expect(liveStatus(reduceTranscript(APPROVAL.events))).toBe("needs_approval");
    expect(
      liveStatus(
        reduceTranscript([
          { at: 0, event: { type: "turn_started", turn_id: "t" } },
          {
            at: 1,
            event: { type: "turn_ended", turn_id: "t", stop_reason: "error", usage: null },
          },
        ]),
      ),
    ).toBe("error");
  });
});
