import { describe, expect, it } from "vitest";
import { ORB_FRAGMENT_SHADER, ORB_UNIFORMS, ORB_VERTEX_SHADER } from "./shader";

/*
 * Static checks only: the real compile happens in WebKit and Chromium. These catch the mistakes
 * that silently break one engine, like a missing version line or a stray texture lookup.
 */
describe("orb shaders", () => {
  it("are GLSL ES 3.00 with the version directive on the very first line", () => {
    expect(ORB_VERTEX_SHADER.startsWith("#version 300 es\n")).toBe(true);
    expect(ORB_FRAGMENT_SHADER.startsWith("#version 300 es\n")).toBe(true);
  });

  it("declares highp precision for floats and the integer hash", () => {
    expect(ORB_FRAGMENT_SHADER).toContain("precision highp float;");
    expect(ORB_FRAGMENT_SHADER).toContain("precision highp int;");
  });

  it("declares every uniform the renderer sets, with the right types", () => {
    const types: Record<(typeof ORB_UNIFORMS)[number], string> = {
      uTime: "float",
      uResolution: "vec2",
      uPalette: "vec3",
      uEnergy: "float",
      uSpeed: "float",
      uTurbulence: "float",
      uRingFrequency: "float",
      uDrift: "vec2",
      uSeed: "float",
    };
    for (const name of ORB_UNIFORMS) {
      const suffix = name === "uPalette" ? "\\[4\\]" : "";
      expect(ORB_FRAGMENT_SHADER).toMatch(new RegExp(`uniform ${types[name]} ${name}${suffix};`));
    }
  });

  it("reads the attributes OGL's Triangle geometry provides", () => {
    expect(ORB_VERTEX_SHADER).toContain("in vec2 position;");
    expect(ORB_VERTEX_SHADER).toContain("in vec2 uv;");
    expect(ORB_FRAGMENT_SHADER).toContain("in vec2 vUv;");
    expect(ORB_FRAGMENT_SHADER).toContain("out vec4 fragColor;");
  });

  it("is fully procedural and extension-free", () => {
    for (const source of [ORB_VERTEX_SHADER, ORB_FRAGMENT_SHADER]) {
      expect(source).not.toMatch(/\bsampler\w*\b|\btexture\w*\s*\(|#extension/);
    }
  });

  it("never scales time-like uniforms inside the shader", () => {
    // Speed and drift are integrated on the CPU; multiplying them by the phase again would make
    // every change fling the animation forward.
    expect(ORB_FRAGMENT_SHADER).not.toMatch(/uTime\s*\*\s*uSpeed|uSpeed\s*\*\s*uTime/);
    expect(ORB_FRAGMENT_SHADER).not.toMatch(
      /uDrift\s*\*\s*t\b|uDrift\s*\*\s*\(t\b|uDrift\s*\*\s*uTime/,
    );
  });

  it("writes premultiplied alpha", () => {
    expect(ORB_FRAGMENT_SHADER).toContain("fragColor = vec4(rgb * alpha, alpha);");
  });
});
