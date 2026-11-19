import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "../bindings";
import { updateBusy, updateOffered } from "./updates";

const status = (phase: UpdateStatus["phase"], version: string | null = null): UpdateStatus => ({
  channel: "stable",
  phase,
  current_version: "0.1.1570",
  automatic: true,
  version,
  notes: null,
  downloaded_bytes: 0,
  total_bytes: null,
  message: null,
});

describe("the Update pill", () => {
  it("shows nothing while the app is current, checking, or cannot update itself", () => {
    expect(updateOffered(null)).toBe(false);
    for (const phase of ["disabled", "idle", "checking"] as const)
      expect(updateOffered(status(phase))).toBe(false);
  });

  it("shows from the moment a newer version is found until the restart", () => {
    for (const phase of [
      "available",
      "downloading",
      "ready",
      "waiting_for_idle",
      "installing",
      "restart_required",
    ] as const)
      expect(updateOffered(status(phase, "0.1.1571"))).toBe(true);
  });

  it("keeps a failure in view only when a version is known", () => {
    // A check that could not reach the network is not news.
    expect(updateOffered(status("failed"))).toBe(false);
    // A download that failed is: the person asked for it.
    expect(updateOffered(status("failed", "0.1.1571"))).toBe(true);
  });

  it("is busy only while something runs", () => {
    expect(["checking", "downloading", "installing"].every((p) => updateBusy(p as never))).toBe(
      true,
    );
    expect(["available", "ready", "failed", "idle"].some((p) => updateBusy(p as never))).toBe(
      false,
    );
  });
});
