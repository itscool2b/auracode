import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { seedOf, workingVerb } from "../../lib/chat/working";
import { LiveTailLine, WorkingLine } from "./WorkingLine";

const line = (props: Partial<Parameters<typeof WorkingLine>[0]> = {}) =>
  renderToStaticMarkup(
    <WorkingLine
      seed="turn:t1"
      context={null}
      visible
      since={Date.now() - 12_400}
      agentId="claude"
      agentName="Claude Code"
      {...props}
    />,
  );

describe("the working line", () => {
  it("waits for a whole second before showing elapsed time", () => {
    expect(line({ since: Date.now() })).not.toContain("chat-working-time");
    expect(line({ since: Date.now() - 500 })).not.toContain("chat-working-time");
    expect(line({ since: Date.now() - 1500 })).toMatch(/class="chat-working-time"[^>]*>1 s</);
  });

  it("opens on the turn's first verb, with the elapsed time and the agent's glow", () => {
    const html = line();
    const verb = workingVerb(seedOf("turn:t1"), 0, null);
    expect(html).toContain(`data-test-verb="${verb}"`);
    expect(html).toContain(`${verb}…`);
    expect(html).toMatch(/class="chat-working-time"[^>]*>12 s</);
    expect(html).toContain("--agent-glow:#f08c64");
    // The same turn always opens on the same verb; its context leans the first pick too.
    expect(line()).toContain(`data-test-verb="${verb}"`);
    expect(line({ context: "run" })).toContain(
      `data-test-verb="${workingVerb(seedOf("turn:t1"), 0, "run")}"`,
    );
  });

  it("tells screen readers once that the agent works, never the verbs or the time", () => {
    const html = line();
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<span class="sr-only" role="status">Claude Code is working</span>');
    expect(html).toMatch(/class="chat-working-words" aria-hidden="true"/);
    expect(html).toMatch(/class="chat-working-time" aria-hidden="true"/);
    expect(html).not.toMatch(/Thought|Thinking/);
  });

  it("stands still under reduced motion: one verb, no sheen", () => {
    const moving = line({ reduced: false });
    expect(moving).toContain("chat-working-sheen");
    const still = line({ reduced: true });
    expect(still).not.toContain("chat-working-sheen");
    expect(still).toContain("data-still");
    expect(still.match(/class="chat-working-verb"/g)).toHaveLength(1);
  });

  it("steps aside while text streams, keeping its place", () => {
    const hidden = line({ visible: false });
    expect(hidden).toContain('data-testid="working-line"');
    expect(hidden).toContain("data-hidden");
    expect(line()).not.toContain("data-hidden");
  });

  it("says what the agent waits on when it is not working", () => {
    const waiting = renderToStaticMarkup(
      <LiveTailLine tail={{ kind: "waiting" }} agentId="claude" agentName="Claude Code" />,
    );
    expect(waiting).toContain("Waiting on you");
    expect(waiting).not.toContain("working-line");
    const stopping = renderToStaticMarkup(
      <LiveTailLine tail={{ kind: "stopping" }} agentId="claude" agentName="Claude Code" />,
    );
    expect(stopping).toContain("Stopping");
  });
});
