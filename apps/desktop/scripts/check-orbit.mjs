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

const { values } = parseArgs({
  options: { server: { type: "string" }, engines: { type: "string", default: "chromium,webkit" } },
});
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/orbit-browser");
const url = values.server ?? "http://127.0.0.1:1457";
const require = createRequire(import.meta.url);
let server;
let serverOutput = "";
await mkdir(out, { recursive: true });

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

async function inspect(engine, launcher) {
  const browser = await launcher.launch({ headless: true });
  const errors = [];
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      window.__orbitFrames = 0;
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
          window.__orbitFrames++;
          callback(time);
        });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const mode of [
        "new",
        "settled",
        "thinking",
        "permission",
        "error",
        "diff",
        "recorded-thinking",
        "recorded-tools",
      ]) {
        await page.goto(`${url}/?preview=${mode}`);
        await page
          .locator(mode === "new" ? '[data-testid="new-chat"]' : '[data-test-phase="live"]')
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (mode === "diff") await page.locator('[data-test-kind="tool"] summary').click();
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
          await page.locator(".chat-app").getAttribute("data-theme"),
          "dark",
          "the product must stay dark regardless of system appearance",
        );
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
          await page.locator(".chat-thought summary").click();
          assert.match(
            (await page.locator(".chat-thought").textContent()) ?? "",
            /did not share its reasoning/,
          );
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
            [["thought", "tool:read:completed", "tool:execute:completed", "message"], ["message"]],
            "native smoke reader lost virtual transcript pieces",
          );
          assert.equal(rendered[1].prompt, "A browser-only verification message");
        }
        // Reduced motion and settled views must consume no continuous animation frames.
        await page.waitForTimeout(100);
        await page.evaluate(() => {
          window.__orbitFrames = 0;
        });
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(() => window.__orbitFrames),
          0,
          `${mode}: frames under reduced motion`,
        );
      }
    }

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
      .filter({ hasText: "Read file 999" })
      .locator("details");
    await lastTool.locator("summary").click();
    await page.getByTestId("composer-input").focus();
    await page.getByTestId("transcript").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    assert.equal(await lastTool.count(), 0, "old tool remained mounted");
    const thought = page.locator(".chat-thought");
    await thought.locator("summary").click();
    await page.getByTestId("jump-latest").click();
    await lastTool.waitFor();
    assert.notEqual(
      await lastTool.getAttribute("open"),
      null,
      "tool disclosure choice was forgotten",
    );
    await page.getByTestId("transcript").evaluate((node) => {
      node.scrollTop = 0;
    });
    await thought.waitFor();
    assert.notEqual(
      await thought.getAttribute("open"),
      null,
      "thought disclosure choice was forgotten",
    );
    await page.getByTestId("transcript").evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    const stickyPrompt = page.getByTestId("sticky-prompt");
    await stickyPrompt.waitFor();
    await stickyPrompt.focus();
    await page.keyboard.press("Enter");
    await stickyPrompt.waitFor({ state: "detached" });
    const promptBounds = await page.locator('[data-test-kind="user"]').boundingBox();
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

    await page.goto(`${url}/?preview=settled`);
    await page.getByRole("button", { name: "Attach a file", exact: true }).click();
    await page.getByText("interface-notes.md", { exact: true }).waitFor();
    await page.getByTestId("composer-input").fill("Review @Sidebar");
    await page.getByRole("button", { name: "src/components/Sidebar.tsx", exact: true }).click();
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await page.getByRole("table", { name: "File line changes" }).waitFor();
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
    const paletteScan = await new AxeBuilder({ page })
      .include(".command-palette")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(paletteScan.violations, [], "Command palette accessibility");
    await page.keyboard.press("Escape");

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.goto(`${url}/?preview=thinking`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => window.__orbitFrames > 0), "active marks never animate");
    await page.locator('.o-mark[data-state="thinking"]').evaluateAll((nodes) => {
      for (const node of nodes) node.style.display = "none";
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__orbitFrames),
      0,
      "offscreen marks still animate",
    );
    await page.locator('.o-mark[data-state="thinking"]').evaluateAll((nodes) => {
      for (const node of nodes) node.style.removeProperty("display");
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__orbitFrames),
      0,
      "hidden document still animates",
    );

    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`${url}/?preview=permission`);
    await page.locator('[data-test-phase="live"]').waitFor();
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
      `${engine}: 16 accessibility scans, recorded transcripts, bounded 500-turn history and 1,000-tool turn, prepend/append anchors, draft/disclosure/focus retention, clipboard/folding/diff controls, motion and minimum window passed`,
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
} finally {
  server?.kill();
}
