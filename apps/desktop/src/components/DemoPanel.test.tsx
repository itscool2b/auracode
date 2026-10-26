import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamStore } from "../lib/session";
import { DemoPanel } from "./DemoPanel";

/** A store that never streams: these tests only look at the idle panel's markup. */
function idleStore(): StreamStore {
  return new StreamStore({
    start: () => Promise.reject(new Error("not used")),
    cancel: () => Promise.resolve(),
  });
}

describe("DemoPanel", () => {
  it("opens the stress view from a button, not a checkbox that is always unchecked", () => {
    const html = renderToStaticMarkup(<DemoPanel store={idleStore()} onOpenStress={() => {}} />);
    // Assistive tech announces a control by its role and state: a checkbox that navigates away
    // reads as "Stress view, checkbox, not checked" and leaves the screen on Space.
    expect(html).not.toContain('type="checkbox"');
    expect(html).toMatch(/<button type="button"[^>]*>Stress view /);
  });
});
