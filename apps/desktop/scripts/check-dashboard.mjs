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
        // The page fills the app's inset pane, its lanes side by side (it once shrank to a
        // 70px column there, every word on its own line).
        const frame = await page.evaluate(() => {
          const screen = document.querySelector('[data-testid="dashboard-screen"]');
          const boxes = [...document.querySelectorAll('[data-testid="dashboard-lane"]')].map(
            (lane) => lane.getBoundingClientRect(),
          );
          return {
            screen: screen.getBoundingClientRect().width,
            window: innerWidth,
            tops: boxes.map((box) => Math.round(box.top)),
            widths: boxes.map((box) => Math.round(box.width)),
          };
        });
        assert.ok(frame.screen >= frame.window - 32, `the page fills the pane: ${frame.screen}`);
        assert.equal(new Set(frame.tops).size, 1, `lanes side by side: ${frame.tops}`);
        assert.ok(Math.min(...frame.widths) >= 220, `lanes have room: ${frame.widths}`);
        assert.deepEqual(await page.getByRole("heading", { level: 2 }).allTextContents(), [
          "Needs you 2",
          "Working 3",
          "Finished 2",
        ]);
        assert.equal(
          await page.getByTestId("dashboard-summary").textContent(),
          "2 need you, 3 working, 2 finished in the last day.",
        );
        // A worktree chat names its project, not its app-owned folder; archived chats are off.
        assert.match(
          await page.locator('[data-test-chat-id="chat-worktree"]').textContent(),
          /Codex · auracode/,
        );
        assert.equal(await laneOf("chat-archived"), null);

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
        const open = page.getByRole("button", { name: "Tidy the changelog check", exact: true });
        await open.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.body.dataset.openedChat), "chat-pi");

        // A card whose agent works or waits for an answer offers Stop; every other card Clear.
        assert.equal(await claude.getByTestId("dashboard-card-stop").count(), 1);
        assert.equal(await review.getByTestId("dashboard-card-stop").count(), 1);
        assert.equal(await pi.getByTestId("dashboard-card-clear").count(), 1);
        assert.equal(await pi.getByTestId("dashboard-card-stop").count(), 0);
        await claude.getByTestId("dashboard-card-stop").click();
        assert.equal(await page.evaluate(() => document.body.dataset.stoppedChat), "chat-claude");
        assert.equal(
          await page.evaluate(() => document.body.dataset.openedChat),
          "chat-pi",
          "Stop does not open the chat",
        );
        // Clear takes a card off the board without opening it; Clear finished takes the rest.
        await pi.getByTestId("dashboard-card-clear").click();
        await page.getByRole("heading", { name: "Finished 1", level: 2 }).waitFor();
        assert.equal(await laneOf("chat-pi"), null);
        await page.getByTestId("dashboard-clear-finished").click();
        await page.getByRole("heading", { name: "Finished 0", level: 2 }).waitFor();
        assert.equal(await page.getByTestId("dashboard-clear-finished").count(), 0);

        await page.goto(`${url}/?preview=dashboard&theme=${theme}&case=empty`);
        await page.getByText("Nothing is running.", { exact: false }).waitFor();
        assert.equal(await page.getByText("Nothing needs you.").count(), 1);
        await audit("empty");

        // A busy day: Finished shows its newest eight, and the rest on request.
        await page.goto(`${url}/?preview=dashboard&theme=${theme}&case=busy`);
        const finished = page.locator('[data-lane="finished"] [data-testid="dashboard-card"]');
        await page.getByRole("heading", { name: "Finished 13", level: 2 }).waitFor();
        assert.equal(await finished.count(), 8);
        assert.equal(
          await finished.first().getAttribute("data-test-chat-id"),
          "chat-pi",
          "newest first",
        );
        await page.getByRole("button", { name: "Show 5 more" }).click();
        assert.equal(await finished.count(), 13);
        await audit("busy");
        await page.getByRole("button", { name: "Show fewer" }).click();
        // The cards that go leave on the next frame.
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[data-lane="finished"] [data-testid="dashboard-card"]')
              .length === 8,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  }
  await checkMoves(browser, url, engine);
}

/**
 * Cards that change lane, with motion on: a card leaves one lane and arrives in the other, and is
 * never seen outside its own lane's column (cards used to fly across the board over the others,
 * their two copies cross-fading).
 */
async function checkMoves(browser, url, engine) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?preview=dashboard&case=live`);
    await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
    const samples = () =>
      page.evaluate(() => {
        const columns = Object.fromEntries(
          [...document.querySelectorAll('[data-testid="dashboard-lane"]')].map((lane) => {
            const box = lane.getBoundingClientRect();
            return [lane.dataset.lane, [box.left, box.right]];
          }),
        );
        return [...document.querySelectorAll('[data-testid="dashboard-card"]')].map((card) => {
          const box = card.getBoundingClientRect();
          const [left, right] = columns[card.dataset.lane];
          return {
            id: card.dataset.testChatId,
            lane: card.dataset.lane,
            inside: box.left >= left - 1 && box.right <= right + 1,
          };
        });
      });
    const lanesSeen = new Set();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      for (const card of await samples()) {
        assert.ok(card.inside, `${engine}: ${card.id} stays in its ${card.lane} column`);
        if (card.id === "chat-codex") lanesSeen.add(card.lane);
      }
      await page.waitForTimeout(40);
    }
    assert.deepEqual([...lanesSeen].sort(), ["attention", "working"], "the chat changed lane");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
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
