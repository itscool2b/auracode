import { describe, expect, it } from "vitest";
import { parseRemembered, rememberedNames } from "./terminalMemory";

const NOW = 1_800_000_000_000;

describe("a remembered terminal panel", () => {
  it("reads the shells, names and Run it kept, and nothing malformed or stale", () => {
    const text = JSON.stringify({
      tabs: [
        { kind: "shell", shell: "power_shell", title: "PowerShell", named: false },
        { kind: "shell", shell: "fish", title: "Unknown shell", named: false },
        { kind: "shell", shell: "bash", title: "x".repeat(41), named: true },
        { kind: "run" },
        { kind: "command", program: "rm" },
        null,
      ],
      open: true,
      savedAt: NOW - 1000,
    });
    expect(parseRemembered(text, NOW)).toEqual({
      tabs: [
        { kind: "shell", shell: "power_shell", title: "PowerShell", named: false },
        { kind: "run" },
      ],
      open: true,
      savedAt: NOW - 1000,
    });
    for (const bad of [null, "", "{", "[]", JSON.stringify({ tabs: [], savedAt: NOW })])
      expect(parseRemembered(bad, NOW), String(bad)).toBeNull();
    // A month later the offer is gone.
    const old = JSON.stringify({
      tabs: [{ kind: "run" }],
      open: false,
      savedAt: NOW - 31 * 86_400_000,
    });
    expect(parseRemembered(old, NOW)).toBeNull();
  });

  it("names what it offers in a sentence", () => {
    expect(rememberedNames([{ kind: "run" }])).toBe("Run");
    expect(
      rememberedNames([
        { kind: "shell", shell: "power_shell", title: "PowerShell", named: false },
        { kind: "shell", shell: "command_prompt", title: "Tests", named: true },
        { kind: "run" },
      ]),
    ).toBe("PowerShell, Tests and Run");
  });
});
