import { describe, expect, it } from "vitest";
import {
  addsMarketplaces,
  ago,
  featureLabel,
  harnessText,
  harnessTone,
  sourceText,
  vendorTargetCopy,
} from "./format";

describe("Plugin library wording", () => {
  it("words every harness state and gives volt only to an update", () => {
    const update = {
      state: "update_available",
      version: "2.1.312",
      latest: "2.1.314",
      source: "npm latest",
      checked_at: 1,
    } as const;
    expect(harnessText("Claude Code", update)).toBe(
      "Claude Code 2.1.314 is available. This device has 2.1.312.",
    );
    expect(harnessTone(update)).toBe("volt");
    expect(harnessText("Pi", { state: "not_installed" })).toBe(
      "Pi is not installed on this device.",
    );
    expect(harnessText("Codex", { state: "checking" })).toBe("Checking for updates…");
    expect(harnessText("Codex", { state: "up_to_date", version: "0.162.1", checked_at: 1 })).toBe(
      "Up to date on 0.162.1.",
    );
    expect(
      harnessText("Codex", { state: "unknown", version: "0.162.1", reason: "You may be offline." }),
    ).toBe("You may be offline.");
    expect(harnessTone({ state: "failed", reason: "x" })).toBe("red");
    expect(harnessTone({ state: "checking" })).toBeNull();
  });

  it("names features per agent and says where rows came from", () => {
    expect(featureLabel("commands", "pi")).toBe("Prompt templates");
    expect(featureLabel("commands", "claude")).toBe("Slash commands");
    expect(featureLabel("subagents", "opencode")).toBe("Agents");
    expect(sourceText({ state: "live" }, "claude plugin list --json --available")).toBe(
      "From claude plugin list --json --available",
    );
    expect(sourceText({ state: "failed", reason: "It failed." }, "codex mcp list --json")).toBe(
      "It failed. Showing the last available entries.",
    );
    expect(sourceText({ state: "files", reason: "From the folder." }, null)).toBe(
      "From the folder.",
    );
  });

  it("says how long ago a listing was read", () => {
    const now = Date.UTC(2026, 9, 28, 12);
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 60_000, now)).toBe("1 minute ago");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 hours ago");
  });
});

describe("adding marketplaces and plugins", () => {
  it("asks each agent for what its own command accepts", () => {
    expect(vendorTargetCopy("claude", "marketplace", "install")).toEqual({
      label: "Marketplace source",
      placeholder: "owner/repository, an https Git address or a local folder",
    });
    expect(vendorTargetCopy("grok", "marketplace", "remove").label).toBe("Marketplace name");
    expect(vendorTargetCopy("hermes", "marketplace", "install")).toEqual({
      label: "Skill source (GitHub repository)",
      placeholder: "owner/repository",
    });
    expect(vendorTargetCopy("grok", "plugin", "install").label).toBe("Plugin source");
    expect(vendorTargetCopy("grok", "plugin", "remove").label).toBe("Plugin name");
    expect(vendorTargetCopy("hermes", "plugin", "install").placeholder).toBe(
      "catalog name or owner/repository",
    );
    expect(vendorTargetCopy("claude", "plugin", "install").placeholder).toBe("plugin@marketplace");
    expect(vendorTargetCopy("pi", "package", "install").label).toBe("Package source");
  });

  it("names Hermes taps skill sources and offers adding only where reviewed", () => {
    expect(featureLabel("marketplaces", "hermes")).toBe("Skill sources");
    expect(featureLabel("marketplaces", "grok")).toBe("Marketplaces");
    expect(addsMarketplaces(null)).toBe(false);
    expect(
      addsMarketplaces({ actions: [{ kind: "marketplace", actions: ["update", "remove"] }] }),
    ).toBe(false);
    expect(addsMarketplaces({ actions: [{ kind: "marketplace", actions: ["install"] }] })).toBe(
      true,
    );
  });
});
