import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TerminalSheet } from "./TerminalSheet";

it("offers an explicit sign-in action and labels the ephemeral dark terminal", () => {
  const transport = {
    reserve: vi.fn(async () => "terminal"),
    start: vi.fn(async () => "terminal"),
    read: vi.fn(async () => ({ bytes: [], done: true, exit_code: 0, truncated: false })),
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const html = renderToStaticMarkup(
    <TerminalSheet
      agentId="claude"
      agentName="Claude Code"
      onClose={() => {}}
      transport={transport}
    />,
  );
  expect(html).toContain("Sign in to Claude Code");
  expect(html).toContain("Start sign-in");
  expect(html).toContain("Terminal output is not saved.");
  expect(html).toContain("Close sign-in terminal");
  expect(html).not.toContain("Appearance");
  expect(transport.reserve).not.toHaveBeenCalled();
  expect(transport.start).not.toHaveBeenCalled();
});
