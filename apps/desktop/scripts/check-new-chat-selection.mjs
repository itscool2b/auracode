/**
 * Focus and project-source selection in real NewChat components with synthetic services: a recent
 * chat in a worktree prefills its source at once (the worktree is never offered, and nothing waits
 * for the retained list), a differently spelled pick finds its folder, and a pick from another
 * project names that project.
 */
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { choose, chosen } from "./choose.mjs";

const url = process.argv[2] ?? "http://127.0.0.1:1474";
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch({ headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ colorScheme: theme, reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?preview=new-worktree`);
      const trigger = page.locator(".new-chat-agent-picker > summary");
      await trigger.click();
      const radios = page.locator(".new-chat-choices input[type=radio]");
      await radios.first().focus();
      const next = await radios.nth(1).getAttribute("value");
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => !document.querySelector(".new-chat-agent-picker").open);
      assert.equal(
        await trigger.evaluate((node) => node === document.activeElement),
        true,
        `${engine}/${theme}: selecting an agent with arrows must return focus to the trigger`,
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator(".new-chat-choices input:checked").getAttribute("value"),
        next,
      );
      await page.keyboard.press("Escape");
      assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
      for (const choice of ["automatic", "dropdown", "clear", "picked", "elsewhere", "new"]) {
        await page.evaluate(async (choice) => {
          window.newChatSelectionFixture?.unmount();
          document.getElementById("root").hidden = true;
          document.getElementById("new-chat-selection-test")?.remove();
          const host = document.createElement("main");
          host.id = "new-chat-selection-test";
          host.className = "chat-main";
          document.body.append(host);
          const { mountNewChatSelectionFixture } = await import(
            "/src/dev/newChatSelectionFixture.tsx"
          );
          window.newChatSelectionFixture = await mountNewChatSelectionFixture(
            host,
            { elsewhere: "/workspace/site", new: "/workspace/fresh" }[choice],
          );
        }, choice);
        const form = page.locator("#new-chat-selection-test");
        const folder = form.getByLabel("Project folder", { exact: true });
        const selected = (value) =>
          page.waitForFunction(
            (value) =>
              document
                .querySelector('#new-chat-selection-test [aria-label="Project folder"]')
                ?.getAttribute("data-value") === value,
            value,
          );
        // The recent chat ran in a worktree: its source is prefilled at once, before the retained
        // list arrives, and the worktree itself is never offered.
        await selected("folder-auracode");
        assert.equal(
          await form.locator('.ui-select-sizer > span[data-value="folder-managed"]').count(),
          0,
        );
        if (choice === "automatic")
          assert.equal(
            await form.getByTestId("new-chat-create").isEnabled(),
            true,
            `${engine}/${theme}: Create must not wait for the retained list`,
          );
        // A folder in no project joins the workspace by itself: Create stays disabled from the
        // pick until it is there (a click before would add it again and open nothing).
        if (choice === "new")
          await page.evaluate(() => {
            const button = document.querySelector(
              '#new-chat-selection-test [data-testid="new-chat-create"]',
            );
            window.createWhileJoining = [];
            // A record whose old value is "" removed `disabled`: the button turned enabled, however
            // briefly (React may disable it again before this callback runs).
            new MutationObserver((records) => {
              const joined = document.querySelector(
                '#new-chat-selection-test .ui-select-sizer > span[data-value="folder-fresh"]',
              );
              if (!joined && records.some((record) => record.oldValue === ""))
                window.createWhileJoining.push(performance.now());
            }).observe(button, {
              attributes: true,
              attributeOldValue: true,
              attributeFilter: ["disabled"],
            });
          });
        if (choice === "dropdown") await choose(folder, "folder-alternate");
        else if (choice === "clear") await choose(folder, "");
        else if (choice === "picked" || choice === "elsewhere" || choice === "new")
          await form.getByTestId("new-chat-pick-folder").click();
        if (choice === "new") {
          await selected("folder-fresh");
          await form.locator('[data-testid="new-chat-create"]:not([disabled])').waitFor();
          assert.deepEqual(
            await page.evaluate(() => window.createWhileJoining),
            [],
            `${engine}/${theme}: Create must stay disabled until the picked folder joins`,
          );
        }
        // A pick spelled differently from the stored folder finds that folder.
        if (choice === "picked") await selected("folder-alternate");
        // A pick of another project's folder starts there, and says so.
        if (choice === "elsewhere") {
          await selected("folder-site");
          await form
            .getByTestId("new-chat-folder-project")
            .getByText("This folder is in Website, so the chat starts there.", { exact: true })
            .waitFor();
        }
        await page.evaluate(async () => {
          window.newChatSelectionFixture.releaseRetained();
          await window.newChatSelectionFixture.refresh();
        });
        assert.equal(
          await form.locator('.ui-select-sizer > span[data-value="folder-managed"]').count(),
          0,
        );
        const expected =
          {
            automatic: "folder-auracode",
            clear: "",
            elsewhere: "folder-site",
            new: "folder-fresh",
          }[choice] ?? "folder-alternate";
        assert.equal(
          await chosen(folder),
          expected,
          `${engine}/${theme}: the ${choice} selection must hold once the retained list arrives`,
        );
        assert.equal(await form.getByTestId("new-chat-create").isEnabled(), choice !== "clear");
        await page.evaluate(async () => {
          await window.newChatSelectionFixture.refresh();
        });
        assert.equal(
          await chosen(folder),
          expected,
          "Workspace refresh must preserve the resolved selection",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${engine}: NewChat keyboard, worktree-source prefill and folder picks pass in both appearances`,
    );
  } finally {
    await browser.close();
  }
}
