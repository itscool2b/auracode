import { describe, expect, it } from "vitest";
import { findSetupToken } from "./setupToken";

const TOKEN = `sk-ant-oat01-${"Ab3_dE-fG9".repeat(10)}AA`;

/** The token cut into lines of `width`, as a narrow terminal shows it. */
function wrapped(width: number, indent = ""): string[] {
  const lines: string[] = [];
  for (let at = 0; at < TOKEN.length; at += width) lines.push(indent + TOKEN.slice(at, at + width));
  return lines;
}

const head = [
  "✓ Long-lived authentication token created successfully!",
  "",
  "Your OAuth token (valid for 1 year):",
  "",
];
const tail = [
  "",
  "Store this token securely. You won't be able to see it again.",
  "Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>",
];

describe("the token claude setup-token prints", () => {
  it("is read whole from one line", () => {
    expect(findSetupToken([...head, TOKEN, ...tail])).toBe(TOKEN);
  });

  it("is joined back together when the terminal wrapped it, padding and all", () => {
    expect(findSetupToken([...head, ...wrapped(37), ...tail])).toBe(TOKEN);
    expect(findSetupToken([...head, ...wrapped(50, "  "), ...tail])).toBe(TOKEN);
  });

  it("waits while it may still be printing, unless the command finished", () => {
    const partial = [...head, ...wrapped(40)];
    expect(findSetupToken(partial)).toBeNull();
    expect(findSetupToken(partial, true)).toBe(TOKEN);
  });

  it("takes the last frame the terminal drew", () => {
    const older = `sk-ant-oat01-${"x".repeat(60)}`;
    expect(findSetupToken([older, "", ...head, TOKEN, ...tail])).toBe(TOKEN);
  });

  it("stops at text after the token on its own line", () => {
    expect(findSetupToken([`${TOKEN} copied`, "more"])).toBe(TOKEN);
  });

  it("ignores everything that is not a whole setup token", () => {
    expect(
      findSetupToken(["sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789abcdef", ""]),
    ).toBeNull();
    expect(findSetupToken(["sk-ant-oat01-short", ""])).toBeNull();
    expect(findSetupToken([...head, ...tail], true)).toBeNull();
    expect(findSetupToken([])).toBeNull();
  });
});
