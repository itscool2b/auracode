import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelMark } from "./ModelMark";
import { MODEL_MAKERS, modelMaker } from "./modelMakers";

describe("the company behind a model", () => {
  it("is read from the model's name", () => {
    const maker = (model: string) => modelMaker(model)?.id ?? null;
    expect(maker("Opus 5.5")).toBe("anthropic");
    expect(maker("claude-sonnet-5-5")).toBe("anthropic");
    expect(maker("Fable 5.1")).toBe("anthropic");
    expect(maker("gpt-5.5-codex")).toBe("openai");
    expect(maker("o4-mini")).toBe("openai");
    expect(maker("Gemini 3 Pro")).toBe("google");
    expect(maker("grok-code-fast")).toBe("xai");
    expect(maker("deepseek-v4")).toBe("deepseek");
    expect(maker("Devstral Medium")).toBe("mistral");
    expect(maker("Llama 4 Maverick")).toBe("meta");
    expect(maker("qwen3-coder")).toBe("qwen");
    expect(maker("Kimi K2")).toBe("moonshot");
  });

  it("falls back to an agent that runs one company's models, else knows nothing", () => {
    expect(modelMaker("Default (recommended)", "claude")?.id).toBe("anthropic");
    expect(modelMaker(null, "codex")?.id).toBe("openai");
    expect(modelMaker("Default", "opencode")).toBeNull();
    expect(modelMaker(undefined)).toBeNull();
  });

  it("draws every maker it knows from a stored mark", () => {
    for (const id of [
      "anthropic",
      "openai",
      "google",
      "xai",
      "deepseek",
      "mistral",
      "meta",
      "qwen",
      "moonshot",
    ] as const) {
      expect(MODEL_MAKERS[id]?.logo.shapes.length, id).toBeGreaterThan(0);
    }
  });

  it("shows the maker's mark on a tile, or the agent's own when the maker is unknown", () => {
    const opus = renderToStaticMarkup(
      createElement(ModelMark, { model: "Opus 5.5", agent: "claude" }),
    );
    expect(opus).toContain('data-maker="anthropic"');
    expect(opus).toContain('aria-hidden="true"');
    const unknown = renderToStaticMarkup(
      createElement(ModelMark, { model: "Default", agent: "opencode" }),
    );
    expect(unknown).not.toContain("data-maker");
    expect(unknown).toContain('data-agent="opencode"');
  });

  it("records the source of every mark it adds", () => {
    const notes = readFileSync(
      new URL("../../../../third-party/brand-marks.md", import.meta.url),
      "utf8",
    );
    for (const name of ["Google Gemini", "DeepSeek", "Mistral AI", "Meta", "Qwen", "Moonshot AI"])
      expect(notes, name).toContain(name);
  });
});
