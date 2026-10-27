import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileStatus, syncStatusLabel } from "./ProfileStatus";

describe("profile identity", () => {
  it("preserves distinct Local names without claiming account sync", () => {
    const html = renderToStaticMarkup(
      <ProfileStatus
        profile={{
          id: "local-copy",
          kind: "local",
          display_name: "Retained workspace",
          created_at: 1,
        }}
        onSettings={() => {}}
        onDiagnostics={() => {}}
      />,
    );
    expect(html).toContain("Retained workspace");
    expect(html).toContain("Stored on this device");
    expect(html).toContain('aria-label="Open settings"');
    expect(html).not.toContain("Sync status");
  });

  it("identifies an Account before its cached status arrives", () => {
    const html = renderToStaticMarkup(
      <ProfileStatus
        profile={{ id: "account", kind: "account", display_name: "Work", created_at: 1 }}
        onDiagnostics={() => {}}
      />,
    );
    expect(html).toContain("Work");
    expect(html).toContain("Sync status loading");
    expect(html).not.toContain("Stored on this device");
  });

  it("does not call a never-synced or pending workspace synced", () => {
    const status = {
      state: "idle" as const,
      pending_changes: 0,
      last_sync_at: null,
      message: null,
    };
    expect(syncStatusLabel(status)).toBe("Sync ready");
    expect(syncStatusLabel({ ...status, last_sync_at: 100, pending_changes: 2 })).toBe(
      "2 changes pending",
    );
    expect(syncStatusLabel({ ...status, last_sync_at: 100 })).toBe("Synced");
    expect(syncStatusLabel({ ...status, state: "paused", pending_changes: 3 })).toBe(
      "Sync paused · 3 pending",
    );
    expect(syncStatusLabel({ ...status, state: "offline" })).toBe("Offline");
    expect(syncStatusLabel({ ...status, state: "inactive" })).toBe("Sync inactive");
  });
});
