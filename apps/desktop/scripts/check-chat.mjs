/** Real browser checks against development-only protocol fixtures. No agent processes or prompts. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

/**
 * Finished turns fold their work under "Worked for" (owner, 4 November 2026). Checks that reach
 * into a finished turn's tool calls open every fold in view first; none folded is a no-op.
 */
const openWork = async (page) => {
  const closed = page.locator('[data-testid="worked-for"][aria-expanded="false"]');
  for (let left = await closed.count(); left > 0; left -= 1) await closed.first().click();
};

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

const { values } = parseArgs({
  options: { server: { type: "string" }, engines: { type: "string", default: "chromium,webkit" } },
});
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/chat-browser");
const url = values.server ?? "http://127.0.0.1:1457";
const require = createRequire(import.meta.url);
let server;
let serverOutput = "";
await mkdir(out, { recursive: true });

/** The queue's waits (`?preview=queue-*`): the words its head says and the actions it offers. */
const QUEUE_CASES = [
  { mode: "queue-starting", reason: "starting", text: "Starting Claude Code", action: null },
  {
    mode: "queue-working",
    reason: "working",
    text: "Claude Code is still working",
    action: "Send now",
  },
  {
    // The quiet turn's own line offers Send now, so the head does not repeat it.
    mode: "queue-stalled",
    reason: "working",
    text: "Claude Code is still working",
    action: null,
  },
  {
    mode: "queue-finishing",
    reason: "finishing_turn",
    text: "Waiting for Claude Code to finish its turn",
    action: "Send now",
  },
  {
    mode: "queue-answer",
    reason: "needs_answer",
    text: "Answer the permission request first",
    action: null,
  },
  {
    mode: "queue-held",
    reason: "held",
    text: "Held after a restart",
    action: ["Send it now", "Discard", "Send all"],
  },
  {
    mode: "queue-failed",
    reason: "start_failed",
    text: "Claude Code could not start",
    action: "Retry",
  },
  {
    mode: "queue-missing",
    reason: "folder_missing",
    text: "This worktree's folder is missing",
    action: "Recreate folder",
  },
];

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverOutput);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Startup has not bound its port yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview did not start: ${serverOutput}`);
}

async function workingLifecycle(page, engine, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" });
  await page.goto(`${url}/?preview=thinking&strict`);
  const line = page.getByTestId("working-line");
  await line.waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await line.count(), 1, `${engine}/${theme}: duplicate working lines`);
  assert.equal(await line.locator('[role="status"]').textContent(), "Claude Code is working");
  const initial = await line.getAttribute("data-test-verb");
  await page.waitForFunction(
    (before) => document.querySelector('[data-testid="working-line"]')?.dataset.testVerb !== before,
    initial,
    { timeout: 4500 },
  );
  assert.match((await line.locator(".chat-working-time").textContent()) ?? "", /^[1-9]\d* s$/);
  assert.equal(await line.locator(".chat-working-words").getAttribute("aria-hidden"), "true");

  // A hidden document stops choosing new words. Bringing it back starts one fresh interval.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const paused = await line.getAttribute("data-test-verb");
  await page.waitForTimeout(3600);
  assert.equal(await line.getAttribute("data-test-verb"), paused, "hidden working words rotate");
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const step = (name) =>
    page.evaluate(
      (detail) =>
        window.dispatchEvent(new CustomEvent("auracode-preview-working-step", { detail })),
      name,
    );
  await step("tools");
  const group = page.getByTestId("tool-group").last();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="tool-group"]')]
      .at(-1)
      ?.textContent.includes("searching for 1 pattern"),
  );
  assert.match((await group.textContent()) ?? "", /Reading 1 file and searching for 1 pattern/);
  assert.equal(await group.getAttribute("data-test-count"), "2", "thought split a tool stretch");
  assert.equal(await line.count(), 1, "tools duplicated the working line");
  assert.doesNotMatch(
    (await page.getByTestId("transcript").textContent()) ?? "",
    /Thought for|private fixture reasoning|Checking the narrow layout/,
  );
  await group.focus();
  await page.evaluate(() => {
    window.__disclosureOverlaps = [];
    const start = performance.now();
    const sample = () => {
      const rows = [...document.querySelectorAll("[data-row-key]")]
        .map((node) => ({ key: node.dataset.rowKey, box: node.getBoundingClientRect() }))
        .sort((a, b) => a.box.top - b.box.top);
      for (let index = 1; index < rows.length; index++) {
        const previous = rows[index - 1];
        const next = rows[index];
        if (previous.box.bottom > next.box.top + 1)
          window.__disclosureOverlaps.push([previous.key, next.key]);
      }
      // rAF precedes ResizeObserver. Inspect after the frame's observer corrections, as painted.
      if (performance.now() - start < 400) requestAnimationFrame(() => setTimeout(sample, 0));
    };
    requestAnimationFrame(() => setTimeout(sample, 0));
  });
  await page.keyboard.press("Enter");
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  await settled(page);
  await page.waitForTimeout(180);
  assert.deepEqual(
    await page.evaluate(() => window.__disclosureOverlaps),
    [],
    "disclosure height changes overlapped neighboring virtual rows in Strict Mode",
  );
  assert.equal(await page.locator('[data-test-turn-id="next"] [data-test-kind="tool"]').count(), 2);
  await page.keyboard.press("Space");
  await settled(page);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-test-turn-id="next"] [data-test-kind="tool"]').length === 0,
  );
  assert.equal(await group.getAttribute("aria-expanded"), "false");

  // OS preference and application overrides both stop all working-line motion immediately.
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="working-line"]')?.hasAttribute("data-still"),
  );
  const still = await line.getAttribute("data-test-verb");
  await page.waitForTimeout(3600);
  assert.equal(await line.getAttribute("data-test-verb"), still, "reduced-motion words rotate");
  assert.equal(await line.locator(".chat-working-sheen").count(), 0);
  assert.equal(
    await line.evaluate(
      (node) =>
        node.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    ),
    0,
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" });
  const motionModule = `/@fs/${resolve(app, "../../packages/ui/src/motion.ts").replaceAll("\\", "/")}`;
  for (const preference of ["reduced", "off"]) {
    await page.evaluate(
      async ({ path, preference }) => {
        const { setMotionPreference } = await import(path);
        setMotionPreference(preference);
      },
      { path: motionModule, preference },
    );
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="working-line"]')?.hasAttribute("data-still"),
    );
    assert.equal(await line.locator(".chat-working-sheen").count(), 0);
    assert.equal(
      await line.evaluate(
        (node) =>
          node.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      ),
      0,
    );
  }
  await page.evaluate(
    async (path) => (await import(path)).setMotionPreference("full"),
    motionModule,
  );

  await line.evaluate((node) => {
    window.__workingFooterRow = node.closest("[data-row-key]");
  });
  await step("text");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="working-line"]')?.hasAttribute("data-hidden"),
  );
  await step("rest");
  await page.waitForTimeout(100);
  assert.equal(
    await line.getAttribute("data-hidden"),
    "",
    "working line returned before text rested",
  );
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="working-line"]')?.hasAttribute("data-hidden"),
  );
  await step("finish");
  await line.waitFor({ state: "detached" });
  const footer = page.locator('[data-test-turn-id="next"] [data-testid="turn-footer"]');
  await footer.waitFor();
  assert.equal(
    await footer.evaluate((node) => node.closest("[data-row-key]") === window.__workingFooterRow),
    true,
    "footer remounted the working row",
  );
  assert.equal(await page.locator('[data-test-kind="thought"]').count(), 0);
  await settled(page);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  assert.deepEqual(scan.violations, [], `${engine}/${theme}: live-turn accessibility`);
}

/**
 * What a call shows besides its output (missing features A): Claude's to-do list as the turn's
 * plan, a web search's links in place of their JSON, an MCP call's input and JSON reply set out
 * over lines, an edit's line counts, a long command on its own lines, a compacted conversation
 * as a notice, and Compact conversation where the agent lists /compact.
 */
async function toolDetails(page, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(`${url}/?preview=tool-details`);
  await page
    .getByText("Claude Code compacted the conversation from 153k tokens", { exact: false })
    .waitFor();
  for (const entry of [
    "Search for open sidebar bugs",
    "Fix the scroll position bug",
    "Run the sidebar tests",
  ])
    await page.getByText(entry, { exact: true }).first().waitFor();
  await page.getByText("Read 2 files, browsed 1 page", { exact: false }).click();
  const call = (name) =>
    page.locator(".chat-tool").filter({ has: page.locator(".chat-tool-head", { hasText: name }) });
  await page.evaluate(() => {
    for (const summary of document.querySelectorAll(".chat-tool-head")) {
      const details = summary.parentElement;
      if (details && !details.open) summary.click();
    }
  });
  const search = call("Searched the web");
  const links = search.getByTestId("tool-links").getByRole("link");
  assert.deepEqual(
    await links.evaluateAll((nodes) =>
      nodes.map((node) => [node.textContent, node.getAttribute("href")]),
    ),
    [
      [
        "Element: scrollIntoView() method",
        "https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView",
      ],
      [
        "Keeping the selected item visible [React]",
        "https://react.dev/learn/manipulating-the-dom-with-refs",
      ],
    ],
  );
  assert.doesNotMatch(await search.getByTestId("tool-text").textContent(), /Links:/);
  const mcp = call("search_issues");
  const input = mcp.getByTestId("tool-input");
  assert.match(await input.textContent(), /queryis:open label:sidebar/);
  assert.match(await input.textContent(), /limit5/);
  assert.match(await mcp.getByTestId("tool-text").textContent(), /\{\n {2}"total_count": 2,/);
  assert.equal((await call("Edited").locator(".chat-tool-delta").textContent()).trim(), "+2 −1");
  assert.match(await call("Ran").getByTestId("tool-input").textContent(), /vitest run \\\n/);
  await page.locator('summary[aria-label="Chat details and controls"]').click();
  await page.getByTestId("chat-compact").waitFor();
  await page.keyboard.press("Escape");
  await settled(page);
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations.map((violation) => violation.id),
    [],
    `tool details, ${theme}`,
  );
}
/**
 * Code colours, math and a diagram in one answer (missing features A): highlight.js's colours as
 * elements, KaTeX's inline and display math, and a Mermaid drawing with its code a click away.
 */
async function richAnswer(page, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(`${url}/?preview=rich-answer`);
  const ts = page.locator("code.hljs").filter({ hasText: "export function reveal" });
  await ts.waitFor();
  assert.ok((await ts.locator(".hljs-keyword").count()) >= 3, "TypeScript keywords are coloured");
  assert.equal(await ts.locator(".hljs-string").first().textContent(), '"row is not in the list"');
  await page.locator(".math-block .katex-display").waitFor();
  assert.ok((await page.locator(".math-inline .katex").count()) >= 3, "inline math is set");
  const diagram = page.locator(".mermaid-block");
  await diagram.locator(".mermaid-diagram svg").waitFor();
  assert.match(await diagram.locator(".mermaid-diagram svg").textContent(), /Reveal row/);
  assert.equal(await diagram.locator("script, foreignObject").count(), 0);
  await diagram.getByRole("button", { name: "Code", exact: true }).click();
  assert.match(await diagram.locator("pre code").textContent(), /flowchart LR/);
  await diagram.getByRole("button", { name: "Diagram", exact: true }).click();
  await diagram.locator(".mermaid-diagram svg").waitFor();
  await settled(page);
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations.map((violation) => violation.id),
    [],
    `rich answer, ${theme}`,
  );
}
async function inspect(engine, launcher) {
  const browser = await launcher.launch({ headless: true });
  const errors = [];
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      window.__chatFrames = 0;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            if (window.__clipboardFail) throw new Error("Synthetic clipboard denial");
            window.__copiedText = text;
          },
        },
      });
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        request((time) => {
          window.__chatFrames++;
          callback(time);
        });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) await workingLifecycle(page, engine, theme);
    for (const theme of ["light", "dark"]) await toolDetails(page, theme);
    for (const theme of ["light", "dark"]) await richAnswer(page, theme);
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const mode of [
        "new",
        "settled",
        "thinking",
        "permission",
        "plan",
        "error",
        "diff",
        "recorded-thinking",
        "recorded-tools",
        // Background tasks: the strip's pills, then (below) the task panel; and the overflow.
        "tasks",
        "tasks-many",
        ...QUEUE_CASES.map((queue) => queue.mode),
      ]) {
        await page.goto(`${url}/?preview=${mode}`);
        await page
          .locator(mode === "new" ? '[data-testid="new-chat"]' : '[data-test-phase="live"]')
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (mode === "diff") {
          await openWork(page);
          await page.getByTestId("tool-group").click();
        }
        // Finish finite control transitions before testing text contrast or taking screenshots.
        await page.waitForTimeout(300);
        assert.equal(
          await page.locator("canvas").count(),
          0,
          `${engine}/${theme}/${mode}: GPU canvas`,
        );
        assert.equal(
          await page.evaluate(() => document.body.scrollWidth > innerWidth),
          false,
          `${mode}: horizontal page overflow`,
        );
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
          "system appearance must reach the chat and its portals",
        );
        await settled(page);
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const violations = scan.violations.map((violation) => ({
          rule: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            reason: node.failureSummary,
          })),
        }));
        results.push({ theme, mode, violations });
        await page.screenshot({ path: resolve(out, `${engine}-${theme}-${mode}.png`) });
        if (mode === "recorded-thinking") {
          assert.equal(await page.locator('[data-test-kind="thought"]').count(), 0);
          assert.doesNotMatch(
            (await page.getByTestId("transcript").textContent()) ?? "",
            /Thought for|did not share its reasoning/,
          );
        }
        if (mode === "tasks") {
          // Three pills; the first opens its panel, which takes the focus and passes axe.
          assert.equal(await page.getByTestId("task-pill").count(), 3, "tasks: pills");
          const pill = page.getByTestId("task-pill").nth(1);
          await pill.click();
          const panel = page.getByTestId("task-panel");
          await panel.waitFor();
          assert.equal(
            await panel.getAttribute("data-test-task-id"),
            await pill.getAttribute("data-test-task-id"),
            "tasks: the pill opened another task",
          );
          assert.equal(await pill.getAttribute("aria-expanded"), "true");
          assert.ok((await panel.getByTestId("task-step").count()) > 0, "tasks: no steps");
          await panel.getByText("Prompt", { exact: true }).click();
          await page.waitForTimeout(200);
          const panelScan = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          results.push({
            theme,
            mode: "tasks#panel",
            violations: panelScan.violations.map((violation) => ({
              rule: violation.id,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                reason: node.failureSummary,
              })),
            })),
          });
          await page.screenshot({ path: resolve(out, `${engine}-${theme}-tasks-panel.png`) });
          // A child task opens in place; Back returns to its parent.
          await panel.getByRole("button", { name: /^Run the account tests/ }).click();
          await page.getByRole("button", { name: "Back to Map account switching code" }).click();
          await panel.getByRole("button", { name: "Close task" }).waitFor();
          await page.keyboard.press("Escape");
          assert.equal(await panel.count(), 0, "tasks: Escape did not close the panel");
          assert.equal(
            await pill.evaluate((node) => node === document.activeElement),
            true,
            "tasks: focus did not return to the pill",
          );
          // The call in the transcript that started a task opens it too.
          await openWork(page);
          await page.getByTestId("tool-group").last().click();
          await page.getByTestId("tool-open-task").first().click();
          await panel.waitFor();
          await page.keyboard.press("Escape");
        }
        if (mode === "tasks-many") {
          assert.equal(await page.getByTestId("task-pill").count(), 0);
          await page.locator('summary[aria-label="5 background tasks 2 running"]').click();
          await page.getByRole("button", { name: /^Map account switching code/ }).click();
          await page.getByTestId("task-panel").waitFor();
          await page.keyboard.press("Escape");
        }
        if (mode === "diff") {
          assert.equal(await page.locator(".chat-diff-table tbody tr").count(), 14);
          await page.getByRole("button", { name: "Show 26 more lines", exact: true }).click();
          assert.equal(await page.locator(".chat-diff-table tbody tr").count(), 40);
          await page.getByRole("button", { name: "Copy path", exact: true }).click();
          assert.equal(await page.evaluate(() => window.__copiedText), "src/settings.ts");
        }
        if (mode === "settled") {
          await page.getByRole("button", { name: "Copy code", exact: true }).click();
          assert.equal(
            await page.evaluate(() => window.__copiedText),
            await page.locator(".code-block code").textContent(),
            "copied code differs from its source",
          );
          await page.evaluate(() => {
            window.__clipboardFail = true;
          });
          await page.getByRole("button", { name: "Copy turn receipt", exact: true }).click();
          await page.getByRole("alert").filter({ hasText: "Could not copy." }).waitFor();
          await page.evaluate(() => {
            window.__clipboardFail = false;
          });
          await openWork(page);
          await page.getByTestId("tool-group").click();
          const tool = page.locator('[data-test-kind="tool"] details').first();
          assert.equal(await tool.getAttribute("open"), null);
          await tool.locator("summary").focus();
          await page.keyboard.press("Enter");
          assert.notEqual(
            await tool.getAttribute("open"),
            null,
            "keyboard disclosure did not open",
          );
          await page.getByTestId("composer-input").fill("A browser-only verification message");
          await page.getByTestId("composer-input").press("Enter");
          await page
            .getByText("This is a local UI preview. No prompt was sent to an agent.", {
              exact: true,
            })
            .waitFor();
          const rendered = await page.evaluate(async () => {
            const { readFullTranscript } = await import("/src/lib/smokePage.ts");
            return (await readFullTranscript()).map((turn) => ({
              prompt: turn.prompt,
              items: turn.items,
            }));
          });
          assert.deepEqual(
            rendered.map((turn) => turn.items),
            [["tool:read:completed", "tool:execute:completed", "message"], ["message"]],
            "native smoke reader lost virtual transcript pieces",
          );
          assert.equal(rendered[1].prompt, "A browser-only verification message");
        }
        // Reduced motion and settled views must consume no continuous animation frames.
        await page.waitForTimeout(100);
        await page.evaluate(() => {
          window.__chatFrames = 0;
        });
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(() => window.__chatFrames),
          0,
          `${mode}: frames under reduced motion`,
        );
      }
    }

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

    // A short native-smoke history can release the sticky prompt at the bottom. Observe idle
    // frames too: reaching the end once must not leave an alternating header/scroll correction.
    await page.goto(`${url}/?preview=smoke-scroll&os=macos`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const boundary = await page.getByTestId("transcript").evaluate(async (node) => {
      const paint = () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
      node.scrollTop = 0;
      await paint();
      // Finished turns' work is folded under "Worked for": open it, then the calls inside.
      for (const work of node.querySelectorAll('[data-testid="worked-for"][aria-expanded="false"]'))
        work.click();
      await paint();
      for (const group of node.querySelectorAll('[data-testid="tool-group"]')) group.click();
      await paint();
      for (let step = 0; step < 2; step++) {
        node.scrollTop += node.clientHeight * 0.7;
        await paint();
      }
      // Expanded tool content can exceed two viewport steps with either theme's font metrics.
      node.scrollTop = node.scrollHeight;
      await paint();
      const frames = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        frames.push({
          top: node.scrollTop,
          height: node.clientHeight,
          total: node.scrollHeight,
          virtual: node.querySelector('[data-testid="virtual-transcript"]').style.height,
          prompt: document.querySelector('[data-testid="sticky-prompt"]')?.textContent ?? null,
        });
      }
      return frames;
    });
    await writeFile(resolve(out, `${engine}-smoke-scroll.json`), JSON.stringify(boundary, null, 2));
    const spread = (field) =>
      Math.max(...boundary.map((frame) => frame[field])) -
      Math.min(...boundary.map((frame) => frame[field]));
    assert.ok(spread("top") < 2, `${engine}: idle prompt boundary moved the scroll position`);
    assert.equal(
      spread("height"),
      0,
      `${engine}: idle sticky prompt kept reserving/releasing space`,
    );
    assert.ok(
      boundary.every((frame) => Math.abs(frame.total - frame.height - frame.top) < 2),
      `${engine}: prompt boundary did not remain at the bottom`,
    );
    const scrollSurface = page.getByTestId("transcript");
    await scrollSurface.hover();
    await page.mouse.wheel(0, -250);
    await page.waitForFunction(
      (bottom) => document.querySelector('[data-testid="transcript"]').scrollTop < bottom - 100,
      boundary[0].top,
    );
    const boundaryPrompt = page.getByTestId("sticky-prompt");
    await boundaryPrompt.waitFor();
    assert.equal(
      await boundaryPrompt.getAttribute("title"),
      "Make the project list easier to scan, and keep the active chat visible.",
    );
    await boundaryPrompt.click();
    await boundaryPrompt.waitFor({ state: "detached" });
    await page.waitForFunction(() => {
      const prompt = document.querySelector('[data-test-turn-id="first"][data-part="0"]');
      const log = document.querySelector('[data-testid="transcript"]');
      return (
        prompt && Math.abs(prompt.getBoundingClientRect().top - log.getBoundingClientRect().top) < 3
      );
    });
    // The dismissed prompt's coordinates can become its header again during the scroll.
    // Keep this real wheel gesture over the stable middle of the transcript instead.
    await scrollSurface.hover();
    const returnPointer = await scrollSurface.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.mouse.wheel(0, 2000);
    try {
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-testid="transcript"]');
        return Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2;
      });
    } catch (cause) {
      const geometry = await page.evaluate((pointer) => {
        const node = document.querySelector('[data-testid="transcript"]');
        const hit = document.elementFromPoint(pointer.x, pointer.y);
        return {
          scrollTop: node.scrollTop,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          pointer,
          hit: hit && {
            tag: hit.tagName,
            class: hit.getAttribute("class"),
            testId: hit.getAttribute("data-testid"),
            inTranscript: node.contains(hit),
          },
        };
      }, returnPointer);
      await writeFile(
        resolve(out, `${engine}-smoke-return-scroll.json`),
        JSON.stringify(geometry, null, 2),
      );
      throw new Error(
        `${engine}: return wheel did not reach the transcript bottom: ${JSON.stringify(geometry)}`,
        { cause },
      );
    }
    const complete = await page.evaluate(async () => {
      const { readFullTranscript } = await import("/src/lib/smokePage.ts");
      return (await readFullTranscript()).map((turn) => ({
        prompt: turn.prompt,
        items: turn.items,
      }));
    });
    assert.deepEqual(
      complete,
      [
        { prompt: "/echo Hello from the smoke run", items: ["message"] },
        {
          prompt: "Make the project list easier to scan, and keep the active chat visible.",
          items: ["tool:read:completed", "tool:execute:completed", "message"],
        },
        {
          prompt: "/permission auto",
          items: ["tool:execute:completed", "permission:auto:allow", "message"],
        },
        {
          prompt: "/permission allow",
          items: ["tool:execute:completed", "permission:user:allow", "message"],
        },
      ],
      `${engine}: native smoke reader lost short-history rows`,
    );
    await page.getByTestId("composer-input").fill("Stay pinned after the prompt boundary");
    await page.getByTestId("composer-input").press("Enter");
    await page
      .getByText("This is a local UI preview. No prompt was sent to an agent.", { exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="transcript"]');
      return Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2;
    });

    // The queue says why the next message waits, with the one action that helps.
    for (const queue of QUEUE_CASES) {
      await page.goto(`${url}/?preview=${queue.mode}`);
      const reason = page.getByTestId("queue-reason");
      await reason.waitFor();
      await page.waitForFunction(
        (text) =>
          document.querySelector('[data-testid="queue-reason"]')?.textContent?.includes(text),
        queue.text,
      );
      assert.equal(
        await reason.getAttribute("data-test-reason"),
        queue.reason,
        `${engine}/${queue.mode}: the reason`,
      );
      assert.match(
        (await reason.textContent()) ?? "",
        / · 2 queued/,
        `${engine}/${queue.mode}: the count follows the reason`,
      );
      assert.deepEqual(
        await page.locator(".chat-queue-head-actions button").allTextContents(),
        Array.isArray(queue.action) ? queue.action : queue.action ? [queue.action] : [],
        `${engine}/${queue.mode}: the head's action`,
      );
      assert.equal(
        await page.getByTestId("queued-prompt").count(),
        2,
        `${engine}/${queue.mode}: both waiting messages listed`,
      );
    }
    const calls = () => page.evaluate(() => window.queuePreview.calls());
    // Send now moves the next message on; the one behind it now waits for that turn.
    await page.goto(`${url}/?preview=queue-working`);
    await page.getByTestId("queue-send-now").click();
    await page.getByTestId("queued-prompt").first().waitFor();
    assert.deepEqual(await calls(), ["sendNow:queued-1"]);
    assert.equal(await page.getByTestId("queued-prompt").count(), 1);
    assert.match((await page.getByTestId("queue-reason").textContent()) ?? "", /1 queued/);
    // A turn quiet for a minute: the calm line offers Send now beside Stop.
    await page.goto(`${url}/?preview=queue-stalled`);
    await page.getByTestId("still-working").waitFor();
    assert.deepEqual(await page.getByTestId("still-working").locator("button").allTextContents(), [
      "Send now",
      "Stop",
    ]);
    await page.getByTestId("still-working-send-now").click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("sendNow:queued-1"));
    // Held after a restart: a later held message goes on its own with its row's Send; the head's
    // Send it now sends the first; Discard drops it instead; Send all releases every held one.
    await page.goto(`${url}/?preview=queue-held`);
    await page.getByRole("button", { name: "Send this message now" }).first().click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("sendNow:queued-2"));
    assert.equal(await page.getByTestId("queued-prompt").count(), 1);
    assert.equal(
      await page.getByTestId("queued-prompt").first().getAttribute("data-test-held"),
      "true",
      "the other message stays held",
    );
    assert.deepEqual(
      await page.locator(".chat-queue-head-actions button").allTextContents(),
      ["Send it now", "Discard"],
      "one held message: its own actions, no Send all",
    );
    await page.getByTestId("queue-send-held").click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("sendNow:queued-1"));
    await page.goto(`${url}/?preview=queue-held`);
    await page.getByTestId("queue-discard-held").click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("discard:queued-1"));
    assert.equal(await page.getByTestId("queued-prompt").count(), 1);
    await page.goto(`${url}/?preview=queue-held`);
    await page.getByTestId("send-queued").click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("resumeQueue"));
    // A failed start retries from the queue; a missing worktree opens Recreate folder's review.
    await page.goto(`${url}/?preview=queue-failed`);
    await page.getByTestId("queue-start").click();
    await page.waitForFunction(() => window.queuePreview.calls().includes("start"));
    await page.goto(`${url}/?preview=queue-missing`);
    await page.getByTestId("queue-recreate").click();
    await page.waitForFunction(() =>
      window.missingWorktreeFixture.calls().includes("review-recreate"),
    );

    await page.goto(`${url}/?preview=long-prompt`);
    const fold = page.getByRole("button", { name: "Show all", exact: true });
    await fold.waitFor();
    assert.equal(await page.locator(".chat-user").getAttribute("data-folded"), "true");
    await fold.click();
    assert.equal(await page.locator(".chat-user").getAttribute("data-folded"), "false");
    await page.getByRole("button", { name: "Copy prompt", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.match(
      await page.evaluate(() => window.__copiedText),
      /Requirement 30:/,
      "copy omitted the folded prompt tail",
    );
    await page.getByRole("button", { name: "Show less", exact: true }).click();

    await page.goto(`${url}/?preview=long-output`);
    const output = page.getByTestId("terminal-output");
    await output.waitFor();
    await page.waitForTimeout(100);
    assert.ok(
      await output.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight < 2),
      "folded output did not show its end",
    );
    assert.ok((await output.boundingBox()).height <= 216, "folded output exceeded twelve lines");
    await page.getByRole("button", { name: "Show all 100 loaded lines", exact: true }).click();
    assert.equal(
      await output.evaluate((node) => node.scrollTop),
      0,
      "expanded output did not show its start",
    );
    await page.getByRole("button", { name: "Copy output", exact: true }).click();
    assert.match(
      await page.evaluate(() => window.__copiedText),
      /^Check 1: passed[\s\S]+Check 100: failed$/,
    );
    await page.getByRole("button", { name: "Show recent lines", exact: true }).click();
    assert.ok(
      await output.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight < 2),
      "refolded output lost its end",
    );

    await page.goto(`${url}/?preview=focus-group`);
    await openWork(page);
    await page.getByTestId("tool-group").click();
    const firstCopy = page.getByRole("button", { name: "Copy output", exact: true }).first();
    await firstCopy.focus();
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("auracode-preview-tool-step", { detail: "add" })),
    );
    await page.getByTestId("tool-group").waitFor();
    assert.ok(
      await firstCopy.evaluate((node) => document.activeElement === node),
      "forming a group removed the focused output",
    );
    assert.equal(await page.getByTestId("tool-group").getAttribute("aria-expanded"), "true");
    await page.getByTestId("tool-group").click();
    await page.getByTestId("tool-group").click();
    assert.equal(
      await firstCopy.isVisible(),
      true,
      "group remount forgot the opened single-call output",
    );
    await firstCopy.focus();
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("auracode-preview-tool-step", { detail: "finish" })),
    );
    await page.waitForTimeout(100);
    assert.ok(
      await firstCopy.evaluate((node) => document.activeElement === node),
      "finishing a group removed the focused output",
    );
    assert.equal(await firstCopy.isVisible(), true, "finishing a tool hid its focused button");
    await page.getByTestId("composer-input").focus();
    assert.equal(
      await page.getByTestId("tool-group").getAttribute("aria-expanded"),
      "true",
      "finishing erased the user's group disclosure choice",
    );

    await page.goto(`${url}/?preview=history`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.waitForTimeout(700);
    assert.ok(
      (await page.locator('[data-testid="segment"]').count()) < 30,
      "large history renders every turn",
    );
    await page.locator('[data-test-turn-id="history-499"]').first().waitFor();
    const transcript = page.getByTestId("transcript");
    await transcript.hover();
    await page.mouse.wheel(0, -1300);
    await page.waitForTimeout(400);
    const reading = await transcript.evaluate((node) => {
      const top = node.getBoundingClientRect().top;
      const segment = [...node.querySelectorAll("[data-row-key]")].find(
        (entry) => entry.getBoundingClientRect().top >= top,
      );
      return {
        id: segment?.getAttribute("data-row-key"),
        y: segment?.getBoundingClientRect().top,
      };
    });
    assert.ok(reading.id && reading.y !== undefined, "no reading anchor in large history");
    await page.getByTestId("composer-input").fill("Append while I read earlier messages");
    await page.getByTestId("composer-input").press("Enter");
    await page.waitForTimeout(400);
    const readingAfter = await page
      .locator("[data-row-key]")
      .evaluateAll(
        (nodes, key) =>
          nodes.find((node) => node.dataset.rowKey === key)?.getBoundingClientRect().y,
        reading.id,
      );
    assert.ok(
      readingAfter !== undefined && Math.abs(readingAfter - reading.y) < 3,
      "a new turn moved the text being read",
    );
    await page.getByTestId("jump-latest").click();
    await page
      .getByText("This is a local UI preview. No prompt was sent to an agent.", { exact: true })
      .waitFor();
    assert.ok(
      await transcript.evaluate((node) => document.activeElement === node),
      "jump to latest lost keyboard focus",
    );
    await transcript.evaluate((node) => {
      node.scrollTop = 0;
    });
    const firstLoaded = page.locator('[data-test-turn-id="history-250"][data-part="0"]');
    await firstLoaded.waitFor();
    await page.waitForTimeout(300);
    const beforePrepend = await firstLoaded.boundingBox();
    await page.getByTestId("load-earlier").click();
    await page.getByTestId("load-earlier").waitFor({ state: "detached" });
    await page.waitForTimeout(400);
    const afterPrepend = await firstLoaded.boundingBox();
    assert.ok(
      beforePrepend && afterPrepend && Math.abs(beforePrepend.y - afterPrepend.y) < 3,
      "loading earlier history moved the text being read",
    );
    await transcript.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.locator('[data-test-turn-id="history-0"]').first().waitFor();
    const revealed = await page.evaluate(async () => {
      const { revealTranscriptItem } = await import("/src/lib/smokePage.ts");
      const item = await revealTranscriptItem("Review file 21.", "message");
      return { connected: item.isConnected, text: item.textContent };
    });
    assert.equal(revealed.connected, true, "older-item reveal returned a detached snapshot");
    assert.match(revealed.text ?? "", /Review 21:/);
    await transcript.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.locator('[data-test-turn-id="history-0"]').first().waitFor();
    assert.ok(
      (await page.locator('[data-testid="segment"]').count()) < 30,
      "top of history lost its render bound",
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(out, `${engine}-large-history.png`) });
    const focusedLink = page.locator('[data-test-turn-id="history-0"] a');
    await focusedLink.focus();
    await transcript.hover();
    await page.mouse.wheel(0, 12000);
    await page.waitForTimeout(400);
    assert.ok(
      await focusedLink.evaluate((node) => node === document.activeElement),
      "virtual scrolling unmounted the keyboard focus",
    );
    await page.getByTestId("composer-input").focus();
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator('[data-test-turn-id="history-0"]').count(),
      0,
      "blurred overscan row remained mounted",
    );

    await page.goto(`${url}/?preview=history-question`);
    await page.getByTestId("question-input").fill("Keep this unsent answer");
    await page.getByTestId("composer-input").focus();
    await page.getByTestId("transcript").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    assert.equal(
      await page.getByTestId("question-input").inputValue(),
      "Keep this unsent answer",
      "offscreen question lost its draft",
    );

    await page.goto(`${url}/?preview=large-turn`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.waitForTimeout(400);
    await openWork(page);
    const group = page.getByTestId("tool-group");
    assert.equal(
      await group.getAttribute("aria-expanded"),
      "false",
      "completed tool group was not collapsed",
    );
    await group.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await group.getAttribute("aria-expanded"),
      "true",
      "tool group did not open with the keyboard",
    );
    await page.getByTestId("jump-latest").click();
    await page.waitForTimeout(300);
    assert.ok(
      (await page.locator('[data-test-kind="tool"]').count()) < 35,
      "one long turn mounted every tool",
    );
    const lastTool = page
      .locator('[data-test-kind="tool"]')
      .filter({ hasText: "file 999" })
      .locator("details");
    await lastTool.locator("summary").click();
    await page.getByTestId("composer-input").focus();
    await page.getByTestId("transcript").evaluate((node) => {
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
      node.scrollTop = 0;
    });
    // Unmounting follows the next layout pass; under load WebKit can take longer than a fixed sleep.
    await lastTool.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    assert.equal(await lastTool.count(), 0, "old tool remained mounted");
    assert.equal(await page.locator('[data-test-kind="thought"]').count(), 0);
    await page.getByTestId("jump-latest").click();
    await lastTool.waitFor();
    assert.notEqual(
      await lastTool.getAttribute("open"),
      null,
      "tool disclosure choice was forgotten",
    );
    await page.getByTestId("transcript").evaluate((node) => {
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
      node.scrollTop = 0;
    });
    await group.waitFor();
    assert.equal(await group.getAttribute("aria-expanded"), "true");
    await page.getByTestId("transcript").evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    const stickyPrompt = page.getByTestId("sticky-prompt");
    await stickyPrompt.waitFor();
    const stickyBounds = await stickyPrompt.boundingBox();
    const visibleTranscript = await page.getByTestId("transcript").boundingBox();
    assert.ok(
      stickyBounds &&
        visibleTranscript &&
        stickyBounds.y + stickyBounds.height <= visibleTranscript.y + 0.5,
      "the sticky prompt covers transcript text instead of reserving space",
    );
    await stickyPrompt.focus();
    await page.keyboard.press("Enter");
    await stickyPrompt.waitFor({ state: "detached" });
    // The prompt row owns its spacing; the message inside now has 8px of breathing room.
    const promptBounds = await page.locator('.chat-segment[data-item="user"]').boundingBox();
    const transcriptBounds = await page.getByTestId("transcript").boundingBox();
    assert.ok(
      promptBounds && transcriptBounds && Math.abs(promptBounds.y - transcriptBounds.y) < 3,
      "sticky prompt did not return to its original message",
    );
    assert.ok(
      await page.getByTestId("transcript").evaluate((node) => document.activeElement === node),
      "returning to prompt lost keyboard focus",
    );

    for (const mode of ["partial-history", "partial-message"]) {
      await page.goto(`${url}/?preview=${mode}`);
      await page.locator('[data-test-phase="live"]').waitFor();
      await page.getByTestId("transcript").evaluate((node) => {
        node.scrollTop = 0;
      });
      const partial = page.getByText(/^Paragraph 40:/).first();
      await partial.waitFor();
      await page.waitForTimeout(300);
      const partialBefore = await partial.boundingBox();
      await page.getByTestId("load-earlier").click();
      await page.waitForTimeout(400);
      const partialAfter = await page
        .getByText(/^Paragraph 40:/)
        .nth(mode === "partial-message" ? 1 : 0)
        .boundingBox();
      assert.ok(
        partialBefore && partialAfter && Math.abs(partialBefore.y - partialAfter.y) < 3,
        `${engine}/${mode}: partial history moved text from ${partialBefore?.y} to ${partialAfter?.y}`,
      );
    }

    // A finished turn's work folds under "Worked for" above its final answer (owner, 4 November
    // 2026, after Codex): the calls are out of view until it opens, by click or by keyboard.
    await page.goto(`${url}/?preview=settled`);
    await page.locator('[data-test-phase="live"]').waitFor();
    const work = page.getByTestId("worked-for");
    assert.equal(await work.count(), 1, `${engine}: the finished turn has no Worked for row`);
    assert.equal(await work.getAttribute("aria-expanded"), "false");
    assert.match((await work.textContent()) ?? "", /Worked for .+ · \d+ steps?$/);
    assert.equal(await page.getByTestId("tool-group").count(), 0, "folded work still shows calls");
    await page.getByText("Both sidebar tests pass.", { exact: true }).waitFor();
    await work.focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("tool-group").waitFor();
    assert.equal(await work.getAttribute("aria-expanded"), "true");
    assert.ok(
      await work.evaluate((node) => node === document.activeElement),
      `${engine}: opening the work moved focus`,
    );
    await page.keyboard.press("Enter");
    await page.getByTestId("tool-group").waitFor({ state: "detached" });
    assert.equal(await work.getAttribute("aria-expanded"), "false");
    // What the turn changed stays in view under the answer, with Review opening Changes.
    await page.goto(`${url}/?preview=recorded-tools`);
    await page.locator('[data-test-phase="live"]').waitFor();
    const changed = page.getByTestId("changed-files");
    await changed.waitFor();
    assert.match((await changed.textContent()) ?? "", /Changed 1 file/);
    assert.equal(await changed.getByRole("listitem").count(), 1);
    const review = changed.getByRole("button", { name: "Review", exact: true });
    if (await review.count()) {
      await review.click();
      await page.locator(".changes-panel").waitFor();
    }
    await settled(page);
    const foldScan = await new AxeBuilder({ page })
      .include('[data-testid="worked-for-row"]')
      .include('[data-testid="changed-files"]')
      .analyze();
    assert.deepEqual(foldScan.violations, [], "Worked for and changed files accessibility");

    // The agent, model and thinking menu, on Claude Code's dozen models in a 900px window. It
    // opens on the current model; the preview answers a change with the old lists and sends the
    // new ones after, as the real drivers do, and the choice must never snap back. It reads model,
    // thinking, then agents (owner, 4 November 2026), and none of them needs a scroll to reach.
    await page.goto(`${url}/?preview=settled`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.keyboard.press("Control+.");
    await page.locator(".chat-model-popover[open]").waitFor();
    assert.equal(
      await page
        .locator('[data-picker-value="sonnet"]')
        .evaluate((node) => node === document.activeElement),
      true,
      "the menu opens on the current model",
    );
    await page.keyboard.press("ArrowDown");
    // Every change of what the pill and the list show, in order, while the answer and the lists
    // after it arrive.
    const shown = page.evaluate(async () => {
      const seen = [];
      const started = performance.now();
      while (performance.now() - started < 900) {
        const state = `${document.querySelector(".chat-pill-model")?.textContent}|${document
          .querySelector('.chat-model-scroll [aria-pressed="true"]')
          ?.getAttribute("data-picker-value")}`;
        if (seen.at(-1) !== state) seen.push(state);
        await new Promise((done) => setTimeout(done, 10));
      }
      return seen;
    });
    await page.keyboard.press("Enter");
    const states = await shown;
    assert.deepEqual(
      states[0] === "Sonnet 5.5|sonnet" ? states.slice(1) : states,
      ["Haiku 5.5|haiku"],
      `${engine}: the model switch snapped back or flickered: ${states.join(" > ")}`,
    );
    // The thinking level and every agent are in view without scrolling: no part of the menu has
    // scrolled, and the folded model list (five, the chosen one and "More models") fits whole.
    const inView = () =>
      page.evaluate(() => {
        const panel = document.querySelector(".chat-model-popover > .chat-popover-panel");
        const frame = panel?.getBoundingClientRect();
        const inside = (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return (
            !!box && !!frame && box.top >= frame.top && box.bottom <= frame.bottom && box.top >= 0
          );
        };
        const list = document.querySelector(".chat-model-scroll");
        const order = [".chat-picker-models", ".chat-picker-thinking", ".chat-picker-agents"].map(
          (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1,
        );
        return {
          thinking: inside(".chat-picker-thinking"),
          agents: inside(".chat-picker-agents"),
          ordered: order.every((top, index) => top >= 0 && (index === 0 || top > order[index - 1])),
          panelScrolled: panel?.scrollTop ?? -1,
          listScrolls: !!list && list.scrollHeight > list.clientHeight + 1,
        };
      });
    assert.deepEqual(
      await inView(),
      { thinking: true, agents: true, ordered: true, panelScrolled: 0, listScrolls: false },
      `${engine}: the thinking level or the agents are not in view below a folded model list`,
    );
    // "More models" opens the rest in place: the list scrolls on its own, the rest stay put.
    await page.getByTestId("picker-more-models").click();
    await page.locator('[data-picker-value="claude-sonnet-4-6"]').waitFor();
    assert.deepEqual(
      await inView(),
      { thinking: true, agents: true, ordered: true, panelScrolled: 0, listScrolls: true },
      `${engine}: an opened model list pushed the thinking level or the agents out of view`,
    );
    await page.locator('[data-picker-value="haiku"]').focus();
    await page.keyboard.press("4");
    await page.waitForFunction(
      () =>
        document.querySelector('[data-picker-value="high"]')?.getAttribute("aria-pressed") ===
        "true",
    );
    await page.locator('[data-picker-value="xhigh"]').click();
    await page.waitForFunction(
      () => document.querySelector(".chat-pill-level")?.textContent === "Extra high",
    );
    assert.equal(
      await page
        .locator(".chat-model-popover > .chat-popover-panel")
        .evaluate((node) => node.scrollTop),
      0,
      "choosing a thinking level scrolled the menu",
    );
    await settled(page);
    const pickerScan = await new AxeBuilder({ page }).include(".chat-model-popover").analyze();
    assert.deepEqual(pickerScan.violations, [], "Picker accessibility");
    await page.screenshot({ path: resolve(out, `${engine}-picker-dark.png`) });
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator(".chat-model-popover > summary")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    // A stopped chat keeps its last models and levels choosable; the choice applies at its start.
    await page.goto(`${url}/?preview=settled&stopped`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.locator(".chat-model-popover > summary").click();
    await page
      .getByTestId("picker-note")
      .filter({ hasText: "Applies when the agent starts." })
      .waitFor();
    await page.locator('[data-picker-value="opus"]').click();
    await page.locator('[data-picker-value="low"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector(".chat-pill-model")?.textContent === "Opus 5.5" &&
        document.querySelector(".chat-pill-level")?.textContent === "Low",
    );
    await settled(page);
    const stoppedScan = await new AxeBuilder({ page }).include(".chat-model-popover").analyze();
    assert.deepEqual(stoppedScan.violations, [], "Stopped picker accessibility");
    await page.keyboard.press("Escape");
    await page.goto(`${url}/?preview=settled`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.getByRole("button", { name: "Attach a file", exact: true }).click();
    await page.getByText("interface-notes.md", { exact: true }).waitFor();
    await page.getByTestId("composer-input").fill("Review @Sidebar");
    await page.getByRole("button", { name: "src/components/Sidebar.tsx", exact: true }).click();
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page.getByRole("table", { name: "File line changes" }).waitFor();
    await settled(page);
    const changeScan = await new AxeBuilder({ page })
      .include(".changes-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(changeScan.violations, [], "Changes panel accessibility");
    await page.getByRole("button", { name: "Close Changes" }).press("Escape");
    assert.ok(
      await page
        .getByRole("button", { name: "Changes", exact: true })
        .evaluate((node) => node === document.activeElement),
      "Changes panel did not restore focus",
    );
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select src/styles.css for revert" }).check();
    await page.getByRole("button", { name: "Stop session to revert" }).click();
    await page.getByRole("button", { name: "Review revert" }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator(".changes-confirm-files li").count(), 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.locator(".changes-file-list > div").count(), 2);
    await page.getByRole("button", { name: "Review revert" }).click();
    await page.getByRole("button", { name: "Revert 1 file", exact: true }).click();
    await page.getByText("Reverted 1 file.", { exact: true }).waitFor();
    assert.equal(await page.locator(".changes-file-list > div").count(), 1);
    assert.equal(await page.getByTestId("composer-input").inputValue(), "Review ");
    for (const tab of ["Files", "Plan", "Session"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Files") {
        await page
          .getByRole("region", { name: "Project files", exact: true })
          .getByRole("button", { name: "src/components/Sidebar.tsx", exact: true })
          .click();
        await page.getByRole("region", { name: "Read-only file preview" }).waitFor();
        await page.getByRole("button", { name: "Mention in message", exact: true }).click();
        await page.getByText("Added to your draft.", { exact: true }).waitFor();
      }
      // The tabs change colour over 150ms; contrast is measured once they have settled.
      await page.waitForTimeout(200);
      await settled(page);
      const scan = await new AxeBuilder({ page }).include(".changes-panel").analyze();
      assert.deepEqual(scan.violations, [], `${tab} context accessibility`);
    }
    await page.getByRole("button", { name: "Close Changes" }).click();
    await page.getByRole("button", { name: "Fork", exact: true }).click();
    await page.getByRole("region", { name: "Exact continuation context" }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await page.locator(".chat-handoff").count(),
      0,
      "cancelled preview changed the chat",
    );
    await page.getByRole("button", { name: "Fork", exact: true }).click();
    await page.getByRole("button", { name: "Create fork", exact: true }).click();
    await page.locator(".chat-handoff").waitFor();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search and commands" }).fill("active");
    await page.getByRole("option").filter({ hasText: "Make the sidebar" }).waitFor();
    await settled(page);
    const paletteScan = await new AxeBuilder({ page })
      .include(".command-palette")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(paletteScan.violations, [], "Command palette accessibility");
    await page.keyboard.press("Escape");
    // Ctrl+N opens New chat and Ctrl+1 to Ctrl+9 open the sidebar's chats in their order.
    const current = page.locator('[data-testid="chat-row"][aria-current="true"]');
    await page.keyboard.press("Control+n");
    await current.waitFor({ state: "detached" });
    await page.keyboard.press("Control+9");
    assert.equal(await current.count(), 0, "Ctrl+9 opened a chat the sidebar does not show");
    await page.keyboard.press("Control+1");
    await current.waitFor();
    assert.equal(await current.getAttribute("aria-keyshortcuts"), "Control+1 Meta+1");

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.goto(`${url}/?preview=thinking`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__chatFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => window.__chatFrames > 0), "active marks never animate");
    // Every live indicator: the thinking marks, the sidebar's running loader and the dock's mark.
    const live =
      '.g-agent-mark:is([data-state="thinking"], [data-state="streaming"], [data-state="tool"]), .g-loader';
    assert.ok(
      (await page.locator('.g-agent-mark[data-state="thinking"]').count()) > 0,
      "the thinking preview shows no thinking mark",
    );
    await page.locator(live).evaluateAll((nodes) => {
      for (const node of nodes) node.style.display = "none";
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.__chatFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__chatFrames),
      0,
      "offscreen marks still animate",
    );
    await page.locator(live).evaluateAll((nodes) => {
      for (const node of nodes) node.style.removeProperty("display");
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.__chatFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__chatFrames),
      0,
      "hidden document still animates",
    );

    // A plan waiting for review: the plan as prose, Accept plan, and Add to the plan, which sends
    // the note and declines the plan so the agent keeps planning with it.
    await page.goto(`${url}/?preview=plan`);
    const plan = page.locator('[data-kind="plan-approval"]').first();
    await plan.waitFor();
    await plan.getByRole("heading", { name: "Keep the active chat visible" }).waitFor();
    assert.equal(await plan.getByRole("button", { name: "Allow once" }).count(), 0);
    await plan.getByRole("button", { name: "Add to the plan…" }).click();
    const note = plan.getByLabel("What should the plan add or change?");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "TEXTAREA");
    await note.fill("Also keep the scroll position when switching projects.");
    await plan.getByRole("button", { name: "Send to plan" }).click();
    await page
      .locator('[data-kind="plan-approval"][data-resolved="true"]')
      .first()
      .getByText("Sent back to keep planning.")
      .waitFor();
    await page
      .getByText("Also keep the scroll position when switching projects.")
      .first()
      .waitFor();
    await page.goto(`${url}/?preview=plan`);
    await page
      .locator('[data-kind="plan-approval"]')
      .first()
      .getByRole("button", { name: "Accept plan" })
      .click();
    await page.getByText("Plan accepted.").first().waitFor();

    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`${url}/?preview=permission`);
    await page.locator('[data-test-phase="live"]').waitFor();
    const permission = await page.evaluate(async () => {
      const { readTranscript } = await import("/src/lib/smokePage.ts");
      return readTranscript().map((segment) => ({
        prompt: segment.prompt,
        items: segment.items,
        actionable: segment.views
          .filter((item) => item.kind === "permission")
          .every((item) => item.element.isConnected),
      }));
    });
    assert.ok(
      permission.some(
        (segment) =>
          segment.prompt && segment.items.includes("permission:open") && segment.actionable,
      ),
      "native smoke reader must associate the docked permission with its turn and live controls",
    );
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth > innerWidth),
      false,
      "minimum window overflows",
    );
    await page.screenshot({ path: resolve(out, `${engine}-minimum-window.png`) });
    assert.deepEqual(errors, [], "browser errors");
    await writeFile(
      resolve(out, `${engine}-accessibility.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    const failures = results.filter((result) => result.violations.length > 0);
    assert.deepEqual(failures, [], `${engine} accessibility violations`);
    console.log(
      `${engine}: ${results.length} accessibility scans, ${QUEUE_CASES.length} queue waits with their actions, recorded transcripts, idle prompt boundary and native smoke traversal, bounded 500-turn history and 1,000-tool turn, prepend/append anchors, draft/disclosure/focus retention, clipboard/folding/diff controls, motion and minimum window passed`,
    );
  } finally {
    await browser.close();
  }
}

try {
  if (!values.server) {
    const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    server = spawn(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", "1457", "--strictPort"],
      { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        serverOutput = (serverOutput + data).slice(-8192);
      });
  }
  await ready();
  for (const engine of values.engines.split(",")) {
    const launcher = { chromium, webkit }[engine];
    assert.ok(launcher, `Unsupported engine: ${engine}`);
    await inspect(engine, launcher);
  }
  // Keep real workspace-to-header routing in the normal chat acceptance gate, on its owned server.
  await new Promise((complete, reject) => {
    const header = spawn(
      process.execPath,
      [
        resolve(app, "scripts/check-header-labels.mjs"),
        "--server",
        url,
        "--engines",
        values.engines,
      ],
      { cwd: app, windowsHide: true, stdio: "inherit" },
    );
    header.once("error", reject);
    header.once("exit", (code, signal) =>
      code === 0 ? complete() : reject(new Error(`Header acceptance failed (${code ?? signal})`)),
    );
  });
} finally {
  server?.kill();
}
