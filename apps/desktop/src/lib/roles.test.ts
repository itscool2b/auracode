import { describe, expect, it } from "vitest";
import type { AgentEntry, ChatRoles, SessionLists } from "../bindings";
import { buildOffer, buildPrompt, NO_ROLES, planRole, roleChoice, roleLabel } from "./roles";

const agent = (id: string, name: string, ready = true) =>
  ({
    id,
    name,
    availability: ready
      ? { state: "ready", version: null, path: "x" }
      : { state: "missing", reason: "x" },
  }) as unknown as AgentEntry;
const AGENTS = [agent("claude", "Claude Code"), agent("codex", "Codex"), agent("pi", "Pi", false)];

const lists = (model: string, effort: string) =>
  ({
    options: [
      {
        id: "model",
        name: "Model",
        description: null,
        category: "model",
        pending: null,
        kind: {
          type: "select",
          current: model,
          choices: [
            { value: "claude-fable-5-2", name: "Fable 5.2", description: null, group: null },
            { value: "claude-opus-5-5", name: "Opus 5.5", description: null, group: null },
          ],
        },
      },
      {
        id: "thinking",
        name: "Thinking",
        description: null,
        category: "effort",
        pending: null,
        kind: {
          type: "select",
          current: effort,
          choices: [
            { value: "medium", name: "Medium", description: null, group: null },
            { value: "high", name: "High", description: null, group: null },
          ],
        },
      },
    ],
  }) as unknown as SessionLists;

const roles = (build: ChatRoles["build"]): ChatRoles => ({ ...NO_ROLES, build });

describe("a chat's plan and build", () => {
  it("names a role by its agent, model and thinking level", () => {
    expect(roleLabel({ agent: "codex", model: "gpt-6-astra", effort: "high" }, AGENTS)).toBe(
      "Codex · gpt-6-astra · High",
    );
    // A model the agent listed is named as it names it.
    expect(
      roleLabel({ agent: "claude", model: "claude-fable-5-2", effort: null }, AGENTS, [
        { value: "claude-fable-5-2", name: "Fable 5.2", description: null, group: null },
      ]),
    ).toBe("Claude Code · Fable 5.2");
    expect(roleLabel({ agent: "codex", model: null, effort: null }, AGENTS)).toBe("Codex");
    expect(roleLabel({ agent: "gone", model: null, effort: null }, null)).toBe("gone");
  });

  it("finds a role's choice by value or name, and says when it is already chosen", () => {
    const offered = lists("claude-fable-5-2", "medium");
    expect(roleChoice(offered, "model", "Opus 5.5")).toMatchObject({
      value: "claude-opus-5-5",
      current: false,
    });
    expect(roleChoice(offered, "model", "CLAUDE-FABLE-5-2")).toMatchObject({ current: true });
    expect(roleChoice(offered, "effort", "high")).toMatchObject({ value: "high", current: false });
    // A model this agent does not list, no choice asked for, and no lists yet: nothing to set.
    expect(roleChoice(offered, "model", "gpt-6-astra")).toBeNull();
    expect(roleChoice(offered, "model", null)).toBeNull();
    expect(roleChoice(null, "model", "claude-opus-5-5")).toBeNull();
  });

  it("offers nothing while no building role is chosen or its agent cannot run here", () => {
    const offered = lists("claude-fable-5-2", "medium");
    expect(buildOffer(NO_ROLES, "claude", offered, AGENTS)).toBeNull();
    expect(buildOffer(null, "claude", offered, AGENTS)).toBeNull();
    expect(
      buildOffer(roles({ agent: "pi", model: null, effort: null }), "claude", offered, AGENTS),
    ).toBeNull();
    expect(
      buildOffer(roles({ agent: "codex", model: null, effort: null }), "claude", offered, null),
    ).toBeNull();
  });

  it("offers another agent with the plan handed over", () => {
    expect(
      buildOffer(
        roles({ agent: "codex", model: "gpt-6-astra", effort: null }),
        "claude",
        lists("claude-fable-5-2", "medium"),
        AGENTS,
      ),
    ).toMatchObject({ sameAgent: false, label: "Codex · gpt-6-astra" });
  });

  it("offers the chat's own agent only when the model or thinking level would change", () => {
    const opus = roles({ agent: "claude", model: "claude-opus-5-5", effort: null });
    expect(buildOffer(opus, "claude", lists("claude-fable-5-2", "medium"), AGENTS)).toMatchObject({
      sameAgent: true,
      label: "Claude Code · Opus 5.5",
    });
    // Already on it: Accept plan is the whole of it.
    expect(buildOffer(opus, "claude", lists("claude-opus-5-5", "medium"), AGENTS)).toBeNull();
    const high = roles({ agent: "claude", model: "claude-opus-5-5", effort: "high" });
    expect(buildOffer(high, "claude", lists("claude-opus-5-5", "medium"), AGENTS)).not.toBeNull();
    expect(buildOffer(high, "claude", lists("claude-opus-5-5", "high"), AGENTS)).toBeNull();
    // A role that names only the agent changes nothing in that agent's own chat.
    expect(
      buildOffer(
        roles({ agent: "claude", model: null, effort: null }),
        "claude",
        lists("x", "y"),
        AGENTS,
      ),
    ).toBeNull();
  });

  it("plans with its Plan with only while the chat is on that agent", () => {
    const fable = { agent: "claude", model: "claude-fable-5-2", effort: "high" };
    expect(planRole({ plan: fable, build: null }, "claude")).toBe(fable);
    // The chat moved to another agent since: its Plan with was for the old one.
    expect(planRole({ plan: fable, build: null }, "codex")).toBeNull();
    expect(planRole(NO_ROLES, "claude")).toBeNull();
    expect(planRole(null, "claude")).toBeNull();
    expect(planRole({ plan: fable, build: null }, null)).toBeNull();
  });

  it("hands the plan over whole, and says who wrote it", () => {
    const prompt = buildPrompt("  1. Add the table.\n2. Backfill.  ", "Claude Code");
    expect(
      prompt.startsWith(
        "Implement this plan. Claude Code wrote it in this chat and I accepted it.",
      ),
    ).toBe(true);
    expect(prompt.endsWith("\n\n1. Add the table.\n2. Backfill.")).toBe(true);
  });
});
