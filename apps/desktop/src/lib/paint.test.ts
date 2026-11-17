import { describe, expect, it } from "vitest";
import { isSoftwareRenderer, paintsOnCpu } from "./paint";

const nvidia = () => "NVIDIA GeForce RTX 5080/PCIe/SSE2";

describe("paintsOnCpu", () => {
  it("is a Linux question only", () => {
    expect(paintsOnCpu("macos", "cpu", () => null)).toBe(false);
    expect(paintsOnCpu("windows", "cpu", () => null)).toBe(false);
    expect(paintsOnCpu("linux", "cpu", nvidia)).toBe(true);
  });

  it("follows the shell's word, then the OpenGL renderer", () => {
    expect(paintsOnCpu("linux", undefined, nvidia)).toBe(false);
    expect(paintsOnCpu("linux", undefined, () => "llvmpipe (LLVM 19.1, 256 bits)")).toBe(true);
    expect(paintsOnCpu("linux", undefined, () => null)).toBe(true);
  });

  it("takes a software OpenGL, or none, for CPU painting", () => {
    expect(isSoftwareRenderer(null)).toBe(true);
    expect(isSoftwareRenderer("Google SwiftShader")).toBe(true);
    expect(isSoftwareRenderer("Mesa Intel(R) Xe Graphics (TGL GT2)")).toBe(false);
    expect(isSoftwareRenderer("AMD Radeon RX 7800 XT (radeonsi, navi32)")).toBe(false);
  });
});
