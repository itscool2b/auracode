/** A terminal chat over a scripted terminal (`?preview=terminal-chat`). Runs no agent. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

/**
 * Keys in a running terminal are its program's: what it sends never also acts in the app or the
 * browser. Ctrl+Tab and Ctrl+Shift+Tab leave it. Expects focus in the terminal.
 */
async function checkKeys(page, label) {
  const inTerminal = () =>
    page.evaluate(() => document.activeElement?.closest(".terminal-chat-host") != null);
  const sent = async (bytes, what) => {
    try {
      await page.waitForFunction(
        (wanted) => window.terminalKeys.written.join(",").includes(wanted.join(",")),
        bytes,
        { timeout: 3000 },
      );
    } catch {
      assert.fail(`${label}: ${what} reaches the agent as ${bytes}`);
    }
  };
  /** Whether the browser's own action for the last such keydown was cancelled. */
  const cancelled = (key) =>
    page.evaluate(
      (name) => window.terminalKeys.all.findLast((event) => event.key === name)?.defaultPrevented,
      key,
    );
  // A modifier pressed alone is no shortcut.
  const reachedApp = () =>
    page.evaluate(() =>
      window.terminalKeys.app.filter((key) => !["Shift", "Control", "Alt", "Meta"].includes(key)),
    );
  await page.evaluate(() => {
    window.terminalKeys.app.length = 0;
    window.stillHere = true;
  });

  // Claude Code's mode switch: its code goes to the agent and focus stays in the terminal.
  await page.keyboard.press("Shift+Tab");
  await sent([27, 91, 90], "Shift+Tab");
  assert.equal(await inTerminal(), true, `${label}: Shift+Tab keeps focus in the terminal`);
  assert.equal(await cancelled("Tab"), true, `${label}: Shift+Tab moves no focus`);
  // F5 is the program's too, and never reloads the window.
  await page.keyboard.press("F5");
  await sent([27, 91, 49, 53, 126], "F5");
  assert.equal(await cancelled("F5"), true, `${label}: F5 does not reload`);
  // PageUp goes to the program without scrolling the pane.
  await page.keyboard.press("PageUp");
  await sent([27, 91, 53, 126], "PageUp");
  assert.equal(await cancelled("PageUp"), true, `${label}: PageUp scrolls nothing else`);
  // The line editor's Ctrl+K (the app's search), Escape (the app's interrupt) and typed capitals
  // (sent on keypress) reach the agent and no app shortcut.
  await page.keyboard.press("Control+k");
  await sent([11], "Ctrl+K");
  await page.keyboard.press("Escape");
  await page.keyboard.type("Hi");
  await sent([72, 105], "typed text");
  assert.deepEqual(await reachedApp(), [], `${label}: no app shortcut saw the terminal's keys`);
  assert.equal(await page.evaluate(() => window.stillHere), true, `${label}: no reload`);
  // A key no terminal can send keeps its meaning in the app (Ctrl+1 opens the first chat).
  await page.keyboard.press("Control+1");
  assert.deepEqual(await reachedApp(), ["1"], `${label}: Ctrl+1 is still the app's`);
  assert.equal(await inTerminal(), true);

  // The way out by keyboard, both directions.
  await page.keyboard.press("Control+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "preview-after",
    `${label}: Ctrl+Tab leaves forward`,
  );
  await page.locator(".terminal-chat-host textarea").focus();
  await page.keyboard.press("Control+Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "preview-before",
    `${label}: Ctrl+Shift+Tab leaves back`,
  );
  await page.locator(".terminal-chat-host textarea").focus();
}

export async function checkTerminalChat(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 720 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const view = page.getByTestId("terminal-chat");
      const open = async (kind = "") => {
        await page.goto(
          `${url}/?preview=terminal-chat&theme=${theme}${kind ? `&case=${kind}` : ""}`,
        );
        await view.waitFor();
      };
      const screen = () =>
        page.locator(".terminal-chat-host .xterm-accessibility-tree").innerText();

      await open();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="terminal-chat"]')?.dataset.state === "running",
      );
      await page.waitForFunction(() =>
        document
          .querySelector(".terminal-chat-host .xterm-accessibility-tree")
          ?.textContent?.includes("Claude Code"),
      );
      // What the person types reaches the agent (the script echoes it back).
      await page.locator(".terminal-chat-host textarea").focus();
      await page.keyboard.type("hello there");
      await page.waitForFunction(() =>
        document
          .querySelector(".terminal-chat-host .xterm-accessibility-tree")
          ?.textContent?.includes("hello there"),
      );
      assert.match(await screen(), /hello there/);
      await checkKeys(page, `${engine}/${theme}`);
      // The frame fills the pane without a page scrollbar or another surface showing through.
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${engine}/${theme}: no horizontal overflow`,
      );
      const viewport = await page
        .locator(".terminal-chat-host .xterm-viewport")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      assert.notEqual(
        viewport,
        "rgb(0, 0, 0)",
        `${engine}/${theme}: the viewport is the terminal's surface`,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).include("[data-testid=terminal-chat]").analyze())
          .violations,
        [],
        `${engine}/${theme}: terminal accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-running.png`) });

      // Once the agent exits: its output stays, with Start again and Back to Chat.
      await open("exited");
      const ended = page.getByTestId("terminal-chat-ended");
      await ended.waitFor();
      await ended.getByText("Claude Code exited.", { exact: true }).waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector(".terminal-chat-host .xterm-accessibility-tree")
          ?.textContent?.includes("Goodbye"),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).include("[data-testid=terminal-chat]").analyze())
          .violations,
        [],
        `${engine}/${theme}: exited accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-${theme}-exited.png`) });
      // With nothing running, the terminal takes no keys: Tab reaches Start again.
      await page.locator(".terminal-chat-host textarea").focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        "Start again",
        `${engine}/${theme}: Tab leaves an exited terminal`,
      );
      await ended.getByRole("button", { name: "Back to Chat" }).click();
      assert.equal(await page.evaluate(() => "backToChat" in document.body.dataset), true);
      // The exit handed the chat's session back.
      assert.equal(await page.evaluate(() => "terminalEnded" in document.body.dataset), true);

      // Shared servers the agent's terminal left out are named, and still load in Chat.
      await open("omitted");
      await page.getByText(/Left out of this terminal: legacy-docs/).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/terminal-chat-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkTerminalChat(
        browser,
        process.env.CHECK_URL ?? "http://localhost:1448",
        out,
        engine,
      );
      console.log(
        `${engine}: terminal chat input, exit, Back to Chat and left-out servers passed in both appearances`,
      );
    } finally {
      await browser.close();
    }
  }
}
