import { describe, expect, it, vi } from "vitest";
import type { AppInfo, SmokePlan } from "../bindings";
import { SMOKE_AGENT_CHECKS, SMOKE_CHAT_CHECKS, SMOKE_CHAT_REOPEN_CHECKS } from "../bindings";
import {
  AGENT_PROMPT,
  CHAT_TRANSCRIPT,
  Checks,
  DEMO_AGENT_PROMPT,
  echoed,
  isOk,
  PROMPTS,
  runChatSmoke,
  SEGMENTS,
} from "./smokeChat";

const PLAN: SmokePlan = { scenario: "chat", agent_id: "mock", folder: "/tmp/smoke chat" };

function info(fatal: string | null = null): AppInfo {
  return {
    app_version: "0.1.0",
    tauri_version: "2.12.5",
    os: "macos",
    os_version: "26.6.2",
    arch: "aarch64",
    data_dir: "/data",
    device: null,
    profile: null,
    profile_locked: false,
    profile_switching: false,
    db: null,
    glass: "none",
    launch: { type: "smoke", plan: PLAN },
    notices: [],
    recovery_notice: null,
    fatal,
  };
}

describe("Checks", () => {
  it("records every check of its list in the list's order", async () => {
    const checks = new Checks(["first", "second", "third"] as const);
    await checks.run("second", () => Promise.resolve("two"));
    await checks.run("first", () => Promise.resolve("one"));
    await checks.run("third", () => Promise.resolve("three"));
    expect(checks.results()).toEqual([
      { name: "first", ok: true, detail: "one" },
      { name: "second", ok: true, detail: "two" },
      { name: "third", ok: true, detail: "three" },
    ]);
    expect(checks.stopped).toBe(false);
  });

  it("stops at the first failure: the checks after it say they did not run, and why", async () => {
    const checks = new Checks(["a", "b", "c", "d"] as const);
    const later = vi.fn(() => Promise.resolve("never"));
    await checks.run("a", () => Promise.resolve("fine"));
    await checks.run("b", () => Promise.reject(new Error("timed out waiting for the card")));
    await checks.run("c", later);
    expect(later).not.toHaveBeenCalled();
    expect(checks.stopped).toBe(true);
    expect(checks.results()).toEqual([
      { name: "a", ok: true, detail: "fine" },
      { name: "b", ok: false, detail: "timed out waiting for the card" },
      { name: "c", ok: false, detail: "not run: b failed" },
      { name: "d", ok: false, detail: "not run: b failed" },
    ]);
  });

  it("reports a check the run never reached, and one it made twice, as failed", async () => {
    const unreached = new Checks(["a", "b"] as const);
    await unreached.run("a", () => Promise.resolve("fine"));
    expect(unreached.results()[1]).toEqual({
      name: "b",
      ok: false,
      detail: "not run: the scenario never got to it",
    });

    const twice = new Checks(["a", "b"] as const);
    await twice.run("a", () => Promise.resolve("fine"));
    await twice.run("a", () => Promise.resolve("again"));
    expect(twice.results()).toEqual([
      { name: "a", ok: false, detail: "the scenario made this check twice" },
      { name: "b", ok: false, detail: "not run: a was made twice" },
    ]);
  });

  it("can be stopped before any check runs", async () => {
    const checks = new Checks(["a"] as const);
    checks.stop("startup failed");
    await checks.run("a", () => Promise.resolve("fine"));
    expect(checks.results()).toEqual([{ name: "a", ok: false, detail: "not run: startup failed" }]);
  });
});

describe("runChatSmoke", () => {
  it("fails every check of the scenario, touching nothing, when startup failed", async () => {
    const showChats = vi.fn(() => Promise.resolve());
    const report = await runChatSmoke(info("Could not open the database."), PLAN, { showChats });
    expect(showChats).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
    expect(report.scenario).toBe("chat");
    expect(report.stream).toBeNull();
    expect(report.errors).toEqual(["startup failed: Could not open the database."]);
    expect(report.checks.map((check) => check.name)).toEqual([...SMOKE_CHAT_CHECKS]);
    expect(report.checks.every((check) => check.detail === "not run: startup failed")).toBe(true);
  });

  it("reports each scenario under its own name, with its own checks", async () => {
    const hooks = { showChats: () => Promise.resolve() };
    for (const [scenario, names] of [
      ["chat_reopen", SMOKE_CHAT_REOPEN_CHECKS],
      ["agent", SMOKE_AGENT_CHECKS],
    ] as const) {
      const report = await runChatSmoke(info("broken"), { ...PLAN, scenario }, hooks);
      expect(report.scenario).toBe(scenario);
      expect(report.checks.map((check) => check.name)).toEqual([...names]);
    }
  });

  it("refuses the stream check, which is not a chat scenario", async () => {
    const report = await runChatSmoke(
      info(),
      { scenario: "stream", agent_id: null, folder: null },
      { showChats: () => Promise.resolve() },
    );
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(["the stream check is not a chat scenario"]);
  });
});

describe("the chat scenario's script", () => {
  const prompts: string[] = Object.values(PROMPTS);
  const turns = Object.values(SEGMENTS).filter((segment) => segment.kind === "turn");

  it("sends every prompt once, so each turn is found by its prompt", () => {
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(turns.map((turn) => turn.prompt).sort()).toEqual([...prompts].sort());
  });

  it("expects every turn but the one running at quit, and the prompt held then, before it reports", () => {
    const expected = CHAT_TRANSCRIPT.filter((segment) => segment.kind === "turn").map(
      (turn) => turn.prompt,
    );
    expect(new Set(expected).size).toBe(expected.length);
    expect([...expected, PROMPTS.atQuit, PROMPTS.heldAtQuit].sort()).toEqual([...prompts].sort());
    expect(CHAT_TRANSCRIPT.filter((segment) => segment.kind === "outside")).toHaveLength(2);
  });

  it("asks the demo agent's magic prompts, whose first word picks what it does", () => {
    // mock_driver.rs reads the first word: these must stay commands, with words after them.
    expect(PROMPTS.autoApproved.split(" ")[0]).toBe("/permission");
    expect(PROMPTS.dismiss.split(" ")[0]).toBe("/ask");
    expect(PROMPTS.atQuit.split(" ")[0]).toBe("/ignore-cancel");
    for (const prompt of [PROMPTS.busy, PROMPTS.beforeFail, PROMPTS.beforeCrash]) {
      expect(prompt.split(" ")[0]).toBe("/slow");
    }
    // A plain prompt plays the demo turn.
    expect(PROMPTS.demo.startsWith("/")).toBe(false);
  });

  it("knows what the demo agent echoes", () => {
    expect(echoed(PROMPTS.echo)).toBe("Hello from the smoke run");
    expect(echoed("/echo   spaced  out")).toBe("spaced  out");
    expect(echoed(DEMO_AGENT_PROMPT)).toBe("ok");
  });
});

describe("the agent scenario", () => {
  it("asks for exactly ok, and takes it in any case, with or without a final period", () => {
    expect(AGENT_PROMPT).toBe("Reply with exactly: ok");
    for (const reply of ["ok", "OK", " Ok. ", "ok!"]) expect(isOk(reply), reply).toBe(true);
    for (const reply of ["okay", "ok ok", "", "Sure, ok", "ok.."]) {
      expect(isOk(reply), reply).toBe(false);
    }
  });
});
