/** Scripted Dashboard checks (`?preview=dashboard`). Reads no process table, stops nothing. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkDashboard(browser, url, out, engine) {
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 860],
      [960, 640],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
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
            path: resolve(out, `${engine}-${theme}-${width}-${name}.png`),
            fullPage: true,
          });
        };
        const laneOf = (chatId) =>
          page.evaluate(
            (id) =>
              document.querySelector(`[data-test-chat-id="${id}"]`)?.closest("section")?.dataset
                .lane ?? null,
            chatId,
          );

        await page.goto(`${url}/?preview=dashboard&theme=${theme}`);
        await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
        const lanes = page.getByTestId("dashboard-lane");
        assert.equal(await lanes.count(), 3);
        assert.deepEqual(await page.getByRole("heading", { level: 2 }).allTextContents(), [
          "Needs you 2",
          "Working 2",
          "Finished 2",
        ]);
        assert.equal(
          await page.getByTestId("dashboard-summary").textContent(),
          "2 need you, 2 working, 2 finished in the last day.",
        );

        // A chat that waits on you sits under Needs you even though its agent still runs.
        assert.equal(await laneOf("chat-review"), "attention");
        assert.equal(await laneOf("chat-grok"), "attention");
        assert.equal(await laneOf("chat-claude"), "working");
        assert.equal(await laneOf("chat-pi"), "finished");
        // Quiet for two days: in the sidebar only.
        assert.equal(await laneOf("chat-old"), null);
        const review = page.locator('[data-test-chat-id="chat-review"]');
        assert.match(await review.textContent(), /Waiting for your answer · 2 minutes ago/);

        // A working card says what its tasks do now, and folds its programs.
        const claude = page.locator('[data-test-chat-id="chat-claude"]');
        const tasks = claude.getByTestId("dashboard-task");
        // Tasks and programs arrive with the first reading of the process table.
        await tasks.nth(1).waitFor();
        assert.equal(await tasks.count(), 2, "running tasks only");
        assert.match(await tasks.nth(1).textContent(), /Explore dictation feature end to end/);
        assert.match(await tasks.nth(1).textContent(), /Reading audio\.rs/);
        const programs = claude.getByTestId("dashboard-programs");
        assert.equal(await programs.evaluate((node) => node.open), false);
        await programs.locator("summary").click();
        const rows = claude.getByTestId("process-row");
        assert.equal(await rows.count(), 4);
        assert.deepEqual(
          await rows.evaluateAll((items) => items.map((item) => item.dataset.depth)),
          ["0", "1", "2", "1"],
        );
        assert.match(await rows.nth(0).textContent(), /claude\.exe.*Agent · PID 4120/);
        // The agent stops from its chat; every program under it has its own Stop.
        assert.equal(await rows.nth(0).getByRole("button").count(), 0);
        assert.equal(await rows.getByRole("button", { name: /^Stop / }).count(), 3);

        // Processor use appears from the second reading.
        await page.waitForFunction(() => document.body.textContent.includes("% CPU"), null, {
          timeout: 6000,
        });
        await audit("board");

        await page.getByRole("button", { name: "Stop bash.exe, process 4388" }).click();
        await page.getByRole("status").filter({ hasText: "Stopped bash.exe" }).waitFor();
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-test-chat-id="chat-claude"]')
              ?.querySelectorAll('[data-testid="process-row"]').length === 2,
        );
        assert.equal(await page.getByText("cargo.exe").count(), 0, "what it started stopped too");

        // The whole card opens its chat, not only its title; its button takes the focus.
        const pi = page.locator('[data-test-chat-id="chat-pi"]');
        const box = await pi.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
        assert.equal(await page.evaluate(() => document.body.dataset.openedChat), "chat-pi");
        const open = page.getByRole("button", { name: "Tidy the changelog check" });
        await open.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.body.dataset.openedChat), "chat-pi");

        await page.goto(`${url}/?preview=dashboard&theme=${theme}&case=empty`);
        await page.getByText("Nothing is running.", { exact: false }).waitFor();
        assert.equal(await page.getByText("Nothing needs you.").count(), 1);
        await audit("empty");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/dashboard-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkDashboard(browser, process.env.CHECK_URL ?? "http://localhost:1448", out, engine);
      console.log(
        `${engine}: dashboard lanes, cards, tasks, programs, stop and empty board passed in both appearances and sizes`,
      );
    } finally {
      await browser.close();
    }
  }
}
