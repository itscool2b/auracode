import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentEntry, AppInfo } from "../../bindings";
import { DEFAULT_GENERAL, preselectAgent } from "../../lib/setup";
import {
  autonomyDetail,
  defaultAgentChoices,
  defaultModelChoices,
  GeneralPanel,
} from "./GeneralPanel";

const ready = { state: "ready", version: "1.0.0", path: "/bin/agent" } as const;
const agent = (id: string, availability: AgentEntry["availability"] = ready): AgentEntry => ({
  id,
  name: id === "claude" ? "Claude Code" : id === "codex" ? "Codex" : id,
  description: id,
  availability,
  launch: id,
  needs_download: false,
  last_verified: "",
  installation: null,
  latest_release: null,
});

describe("Settings' General defaults", () => {
  it("keeps full auto and every background service on by default", () => {
    expect(DEFAULT_GENERAL).toEqual({
      default_agent: null,
      default_model: null,
      default_autonomy: "full_auto",
      notifications: true,
      keep_awake: true,
      close_to_tray: true,
    });
  });

  it("offers the agents that can run here and never drops the saved one", () => {
    const agents = [
      agent("claude"),
      agent("codex"),
      agent("pi", { state: "missing", reason: "Not installed." }),
    ];
    expect(defaultAgentChoices(agents, null).map((choice) => choice.id)).toEqual([
      "claude",
      "codex",
    ]);
    expect(defaultAgentChoices(agents, "pi").at(-1)).toEqual({ id: "pi", name: "pi (not found)" });
    expect(defaultAgentChoices([], "codex")).toEqual([{ id: "codex", name: "codex (not found)" }]);
  });

  it("offers the models the agent reported, keeping a saved one it no longer lists", () => {
    const reported = [{ value: "small", name: "Small", description: null, group: null }];
    expect(defaultModelChoices(reported, null)).toEqual([{ value: "small", name: "Small" }]);
    expect(defaultModelChoices(reported, "retired")).toEqual([
      { value: "small", name: "Small" },
      { value: "retired", name: "retired" },
    ]);
    expect(defaultModelChoices([], null)).toEqual([]);
  });

  it("says what each autonomy level does in one line", () => {
    expect(autonomyDetail("full_auto")).toContain("checkpoint");
    for (const level of ["full_auto", "auto_edit", "ask"] as const)
      expect(autonomyDetail(level)).not.toMatch(/\n|\u2014/);
  });

  it("selects the default agent in a fresh New chat only once it can run", () => {
    const agents = [agent("codex"), agent("claude", { state: "checking" })];
    expect(preselectAgent("codex", agents, null)).toBe("codex");
    expect(preselectAgent("claude", agents, null)).toBe("wait");
    expect(preselectAgent("codex", null, null)).toBe("wait");
    expect(preselectAgent("pi", agents, null)).toBeNull();
    // A choice already made (the dock, a click) is never replaced; no default, no selection.
    expect(preselectAgent("codex", agents, "claude")).toBeNull();
    expect(preselectAgent(null, agents, null)).toBeNull();
  });

  it("lays out one control per row: two selects, the autonomy track and three switches", () => {
    const info = { os: "windows", data_dir: "C:/data" } as AppInfo;
    const html = renderToStaticMarkup(
      <GeneralPanel
        info={info}
        api={{ snapshot: () => new Promise(() => {}), apply: () => new Promise(() => {}) }}
        general={{ agents: async () => [], models: async () => [] }}
        onSetup={() => {}}
        reveal={async () => {}}
      />,
    );
    expect(html).toContain('aria-label="Default agent"');
    expect(html).toContain(">Choose each time</option>");
    // No default agent yet: no model row.
    expect(html).not.toContain('aria-label="Default model"');
    for (const level of ["Ask", "Auto-edit", "Full auto"])
      expect(html).toContain(`>${level}</span>`);
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    for (const name of ["Notifications", "Keep awake", "Keep running in the tray"])
      expect(html).toContain(`aria-label="${name}"`);
    // Nothing is editable before the saved preferences load.
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
