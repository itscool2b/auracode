import { describe, expect, it } from "vitest";
import { projectEvent } from "./projectEvent";

describe("projectEvent", () => {
  it("reads the title and what was sent after it", () => {
    expect(
      projectEvent(
        '[auracode project event] Worker report\n\nWorker "api" finished a turn.\n\nDone.',
      ),
    ).toEqual({ title: "Worker report", body: 'Worker "api" finished a turn.\n\nDone.' });
    expect(projectEvent("[auracode project event] Routine: Watch pull requests")).toEqual({
      title: "Routine: Watch pull requests",
      body: "",
    });
  });

  it("leaves the person's own messages alone, also ones that mention the marker", () => {
    for (const text of [
      "What does [auracode project event] mean?",
      " [auracode project event] Worker report",
      "[auracode project event]",
      "[auracode project event] \nbody",
      "",
    ]) {
      expect(projectEvent(text)).toBeNull();
    }
  });
});
