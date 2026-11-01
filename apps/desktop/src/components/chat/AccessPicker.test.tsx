import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionLists } from "../../bindings";
import { lists } from "../../lib/chat/testing";
import { AccessPicker } from "./AccessPicker";

const nativeLists = (): SessionLists =>
  lists(1, {
    controls: {
      version: 1,
      access: {
        requested: "review",
        effective: "review",
        pending: null,
        native_mode: "nativeReview",
        note: null,
        choices: [
          {
            value: "review",
            name: "Review every action",
            description: "Native access policy",
            legacy_autonomy: null,
          },
        ],
      },
      workflow: {
        requested: "plan",
        effective: "plan",
        pending: null,
        native_mode: null,
        note: null,
        choices: [
          { value: "plan", name: "Plan", description: null, legacy_autonomy: null },
          { value: "execute", name: "Execute", description: null, legacy_autonomy: null },
        ],
      },
    },
  });
const render = (overrides: Partial<Parameters<typeof AccessPicker>[0]> = {}) =>
  renderToStaticMarkup(
    <AccessPicker
      lists={nativeLists()}
      autonomy="full_auto"
      saving={null}
      status="ready"
      error={null}
      onSetAutonomy={() => {}}
      onSetControl={() => {}}
      {...overrides}
    />,
  );
describe("native access and planning", () => {
  it("offers advertised native access without inventing Full access", () => {
    const html = render();
    expect(html).toContain("Review every action");
    expect(html).not.toContain("Full access");
    expect(html).toContain("Approve and execute");
    expect(html).toContain("Approve execution before changing access.");
  });
  it("keeps an unavailable native setting visible without a legacy full-access fallback", () => {
    const state = nativeLists();
    if (!state.controls?.access) throw new Error("Missing fixture control");
    state.controls.access.effective = null;
    expect(render({ lists: state })).toContain("Access unavailable");
    expect(render({ lists: state })).not.toContain("Full access");
  });
  it("disables mode transitions while queued or awaiting acknowledgement", () => {
    for (const state of [
      { transitionBlocked: true },
      {
        controlSaving: {
          type: "workflow" as const,
          value: "execute",
          implementation_approved: true,
        },
      },
    ]) {
      const html = render(state);
      expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
    }
  });
  it("reports unavailable native planning and offers no fabricated choices", () => {
    const html = render({ lists: lists(1) });
    expect(html).toContain("Native Plan mode is not available on this connection.");
    expect(html).toContain('aria-label="Mode unavailable. Working mode"');
    expect(html).not.toContain('aria-label="Execute. Working mode"');
    expect(html).not.toContain('data-testid="picker-access-choice"');
  });
  it("keeps advertised legacy access subject to the same idle admission", () => {
    const state = lists(1, {
      capabilities: {
        images: false,
        steer: false,
        interrupt: false,
        resume: false,
        fork: false,
        rewind: false,
        set_model: false,
        set_effort: false,
        permissions: true,
        plans: false,
        usage: false,
        limits: false,
        slash_commands: false,
        add_dirs: false,
        autonomy_levels: ["ask", "full_auto"],
      },
    });
    for (const gate of [{ status: "running" as const }, { transitionBlocked: true }]) {
      expect(render({ lists: state, ...gate }).match(/<button[^>]*disabled/g)).toHaveLength(2);
    }
    expect(render({ lists: state }).match(/<button[^>]*disabled/g)).toBeNull();
  });
});
