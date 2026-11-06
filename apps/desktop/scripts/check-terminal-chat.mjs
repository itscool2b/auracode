/** A terminal chat over a scripted terminal (`?preview=terminal-chat`). Runs no agent. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

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
