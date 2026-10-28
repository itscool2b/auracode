import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatCreatePreview, ChatMove, ProjectFolder, WorkspaceChat } from "../../bindings";
import { chatSummary } from "../../lib/chat/testing";
import { busyElsewhere, moveChat, moveRequest } from "../../lib/chatMove";
import { MoveBusyWarning } from "./ChatActionsDialog";

const folder: ProjectFolder = {
  id: "folder-b",
  project_id: "project-b",
  display_name: "app",
  path: "/Users/me/code/app",
  folder_state: "ok",
  unavailable_reason: null,
  kind: "local",
  git_remote_url: null,
  git_default_branch: null,
};
const moving = chatSummary("moving", { status: "stopped" });
const other = chatSummary("other", { title: "Fix the pacing test", status: "running" });

/** A workspace API whose destination folder holds `busy`, recording every move. */
function api(busy: ReturnType<typeof chatSummary>[]) {
  const moves: ChatMove[] = [];
  const previews: string[] = [];
  return {
    moves,
    previews,
    preview: async (folderId: string): Promise<ChatCreatePreview> => {
      previews.push(folderId);
      return { folder, busy_chats: busy };
    },
    move: async (id: string, request: ChatMove): Promise<WorkspaceChat> => {
      moves.push(request);
      return {
        chat: chatSummary(id),
        project_id: request.project_id,
        folder_id: request.folder_id,
        pinned: false,
        archived: false,
      };
    },
  };
}

describe("moving a chat into a busy folder", () => {
  const target = { projectId: "project-b", folderId: "folder-b" };

  it("never counts the chat being moved as busy work", () => {
    expect(busyElsewhere({ folder, busy_chats: [moving, other] }, "moving")).toEqual([other]);
    expect(busyElsewhere(null, "moving")).toEqual([]);
  });

  it("holds the move until the warning is acknowledged", async () => {
    const fake = api([other]);
    const outcome = await moveChat(fake, "moving", target, false);
    expect(outcome).toEqual({ kind: "busy", busy: [other] });
    expect(fake.moves).toEqual([]);
  });

  it("sends the override only after the explicit acknowledgment", async () => {
    const fake = api([other]);
    const outcome = await moveChat(fake, "moving", target, true);
    expect(outcome.kind).toBe("moved");
    expect(fake.moves).toEqual([
      { project_id: "project-b", folder_id: "folder-b", allow_busy_folder: true },
    ]);
  });

  it("never sends the override for a quiet folder, even when acknowledged earlier", async () => {
    const fake = api([moving]);
    await moveChat(fake, "moving", target, true);
    expect(fake.moves).toEqual([
      { project_id: "project-b", folder_id: "folder-b", allow_busy_folder: false },
    ]);
  });

  it("keeps the working folder without a folder check", async () => {
    const fake = api([other]);
    await moveChat(fake, "moving", { projectId: "project-b", folderId: null }, false);
    expect(fake.previews).toEqual([]);
    expect(fake.moves).toEqual([
      { project_id: "project-b", folder_id: null, allow_busy_folder: false },
    ]);
  });

  it("builds no request while the warning waits", () => {
    expect(moveRequest(target, [other], false)).toBeNull();
    expect(moveRequest(target, [], false)?.allow_busy_folder).toBe(false);
  });

  it("shows the active chats and one unchecked acknowledgment", () => {
    const html = renderToStaticMarkup(
      <MoveBusyWarning busy={[other]} acknowledged={false} onAcknowledge={() => {}} />,
    );
    expect(html).toContain("This folder has active work");
    expect(html).toContain("Fix the pacing test");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
    expect(html).toContain("Move this chat into it anyway. Agents may edit the same files.");
    expect(
      renderToStaticMarkup(
        <MoveBusyWarning busy={[]} acknowledged={false} onAcknowledge={() => {}} />,
      ),
    ).toBe("");
  });
});
