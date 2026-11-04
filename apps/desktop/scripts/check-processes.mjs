/** Scripted Processes page checks (`?preview=processes`). Reads no process table, stops nothing. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkProcesses(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const audit = async (name) => {
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        assert.equal(overflow, false, "no horizontal overflow");
        await page.screenshot({
          path: resolve(out, `${engine}-${theme}-${name}.png`),
          fullPage: true,
        });
      };

      await page.goto(`${url}/?preview=processes&theme=${theme}`);
      const chats = page.getByTestId("process-chat");
      await chats.first().waitFor();
      assert.equal(await chats.count(), 2);
      await page.getByRole("heading", { name: "Fix dictation on Windows", level: 2 }).waitFor();
      await page.getByText("Claude Code · Working").waitFor();

      // Subagents run inside the agent's process, so they show as tasks, running first.
      const tasks = page.getByTestId("process-task");
      assert.equal(await tasks.count(), 3);
      assert.match(await tasks.first().textContent(), /Explore dictation feature end to end/);
      assert.match(await tasks.first().textContent(), /Reading audio\.rs/);

      // The tree: the agent, then what it started, indented; an orphan under the agent.
      const rows = page.getByTestId("process-row");
      const first = chats.first().getByTestId("process-row");
      assert.equal(await first.count(), 4);
      assert.deepEqual(
        await first.evaluateAll((items) => items.map((item) => item.dataset.depth)),
        ["0", "1", "2", "1"],
      );
      assert.match(await first.nth(0).textContent(), /claude\.exe.*Agent · PID 4120/);
      assert.match(await first.nth(3).textContent(), /auracode\.exe/);
      // The agent stops from its chat; every program under it has its own Stop.
      assert.equal(await first.nth(0).getByRole("button").count(), 0);
      assert.equal(await rows.getByRole("button", { name: /^Stop / }).count(), 4);

      // Processor use appears from the second reading.
      await page.waitForFunction(() => document.body.textContent.includes("% CPU"), null, {
        timeout: 6000,
      });
      await audit("processes");

      await page.getByRole("button", { name: "Stop bash.exe, process 4388" }).click();
      await page.getByRole("status").filter({ hasText: "Stopped bash.exe" }).waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelectorAll('[data-testid="process-chat"]')[0]
            ?.querySelectorAll('[data-testid="process-row"]').length === 2,
      );
      assert.equal(await page.getByText("cargo.exe").count(), 0, "what it started stopped too");

      await page.goto(`${url}/?preview=processes&theme=${theme}&case=empty`);
      await page.getByText("No agent is running right now.").waitFor();
      await audit("processes-empty");
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/processes-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkProcesses(browser, process.env.CHECK_URL ?? "http://localhost:1448", out, engine);
      console.log(
        `${engine}: processes tree, tasks, stop and empty state passed in both appearances`,
      );
    } finally {
      await browser.close();
    }
  }
}
