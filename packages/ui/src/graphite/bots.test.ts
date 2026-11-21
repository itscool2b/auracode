import { describe, expect, it } from "vitest";
import openclaw from "./bot-logos/openclaw.svg?raw";
import { BOTS, botNamed } from "./bots";

describe("the assistants linked as bots", () => {
  it("names four, each once", () => {
    expect(BOTS.map((bot) => bot.id)).toEqual(["grok", "muse", "hermes", "openclaw"]);
    expect(new Set(BOTS.map((bot) => bot.name)).size).toBe(BOTS.length);
  });

  it("finds the assistant a link's name names, and none in a name of the owner's own", () => {
    expect(botNamed("Grok Bot")).toBe("grok");
    expect(botNamed("my grok")).toBe("grok");
    expect(botNamed("Muse")).toBe("muse");
    expect(botNamed("Hermes at home")).toBe("hermes");
    expect(botNamed("OpenClaw")).toBe("openclaw");
    expect(botNamed("open claw")).toBe("openclaw");
    expect(botNamed("Research bot")).toBeNull();
    expect(botNamed("")).toBeNull();
    // Every default name finds its own assistant.
    for (const bot of BOTS) expect(botNamed(bot.name)).toBe(bot.id);
  });

  it("stores OpenClaw's mark as a still picture that runs and loads nothing", () => {
    expect(openclaw).toMatch(/^<svg [^>]*role="img"[^>]*aria-label="OpenClaw"/);
    expect(openclaw).toContain("<title>OpenClaw</title>");
    // Its own gradient is the only reference; no script, style, animation, raster or link.
    expect(openclaw).not.toMatch(
      /<(script|style|animate|animateTransform|image|foreignObject|a)\b/,
    );
    expect(openclaw).not.toMatch(/\bon[a-z]+=|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(openclaw.match(/url\(#[^)]+\)/g)?.every((use) => use === "url(#lobster-gradient)")).toBe(
      true,
    );
  });
});
