import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PermissionRequest } from "../../bindings";
import type { PermissionItem } from "../../lib/chat/transcript";
import { PermissionCard } from "./PermissionCard";
import { planApproval, planFeedback } from "./PlanCard";

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  request_id: "exit-plan",
  tool_call_id: null,
  title: "ExitPlanMode",
  kind: "switch_mode",
  raw_input: { plan: "# Ship it\n\n1. Build the picker" },
  content: [],
  locations: [],
  options: [
    { option_id: "allow", kind: "allow_once", label: "Allow once" },
    { option_id: "deny", kind: "reject_once", label: "Deny" },
  ],
  truncated: null,
  ...overrides,
});

const item = (ask: PermissionRequest, resolved: string | null = null) =>
  ({
    kind: "permission",
    key: ask.request_id,
    request: ask,
    resolution:
      resolved === null
        ? null
        : { by: "user", decision: { type: "selected", option_id: resolved } },
  }) as unknown as PermissionItem;

describe("a plan waiting for review", () => {
  it("is a mode switch that carries a plan and both an allow and a reject", () => {
    expect(planApproval(request())?.plan).toContain("# Ship it");
    expect(planApproval(request({ kind: "execute" }))).toBeNull();
    expect(planApproval(request({ raw_input: { plan: "  " } }))).toBeNull();
    expect(planApproval(request({ raw_input: null }))).toBeNull();
    expect(
      planApproval(request({ options: [{ option_id: "a", kind: "allow_once", label: "A" }] })),
    ).toBeNull();
  });

  it("sets the plan as prose with Accept plan and Add to the plan", () => {
    const html = renderToStaticMarkup(
      <PermissionCard
        item={item(request())}
        request={undefined}
        onRespond={() => {}}
        agentName="Claude Code"
        onAddToPlan={async () => {}}
        blobs={new Map()}
        onLoadBlob={() => {}}
      />,
    );
    expect(html).toContain('data-kind="plan-approval"');
    expect(html).toContain("Plan ready for review");
    expect(html).toMatch(/<h3[^>]*>Ship it<\/h3>/);
    expect(html).toContain("Accept plan");
    expect(html).toContain("Add to the plan");
    expect(html).not.toContain("Allow once");
    expect(html).toContain("Accepting lets Claude Code start implementing.");
  });

  it("says what was decided once it is answered", () => {
    const accepted = renderToStaticMarkup(
      <PermissionCard
        item={item(request(), "allow")}
        request={undefined}
        onRespond={() => {}}
        blobs={new Map()}
        onLoadBlob={() => {}}
      />,
    );
    expect(accepted).toContain("Plan accepted.");
    expect(accepted).not.toContain("Accept plan");
    const declined = renderToStaticMarkup(
      <PermissionCard
        item={item(request(), "deny")}
        request={undefined}
        onRespond={() => {}}
        blobs={new Map()}
        onLoadBlob={() => {}}
      />,
    );
    expect(declined).toContain("Sent back to keep planning.");
  });

  it("asks the agent to fold the note into the plan", () => {
    expect(planFeedback("  also cover Codex  ")).toBe(
      "Before implementing, add this to the plan and show me the updated plan:\n\nalso cover Codex",
    );
  });
});
