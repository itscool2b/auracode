/** Focus and delayed project-source selection in real NewChat components with synthetic services. */
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

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
      for (const choice of ["automatic", "dropdown", "clear", "picked"]) {
        await page.evaluate(async () => {
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
          window.newChatSelectionFixture = await mountNewChatSelectionFixture(host);
        });
        const form = page.locator("#new-chat-selection-test");
        const folder = form.getByLabel("Project folder", { exact: true });
        await page.waitForFunction(
          () =>
            document.querySelector("#new-chat-selection-test select")?.value === "folder-managed",
        );
        if (choice === "dropdown") await folder.selectOption("folder-alternate");
        else if (choice === "clear") await folder.selectOption("");
        else if (choice === "picked") await form.getByTestId("new-chat-pick-folder").click();
        if (choice === "picked")
          await page.waitForFunction(
            () =>
              document.querySelector("#new-chat-selection-test select")?.value ===
              "folder-alternate",
          );
        await page.evaluate(async () => {
          window.newChatSelectionFixture.releaseRetained();
          await window.newChatSelectionFixture.refresh();
        });
        await page.waitForFunction(
          () => !document.querySelector('#new-chat-selection-test option[value="folder-managed"]'),
        );
        const expected =
          choice === "automatic" ? "folder-auracode" : choice === "clear" ? "" : "folder-alternate";
        assert.equal(
          await folder.inputValue(),
          expected,
          `${engine}/${theme}: retained loading must resolve automatic context and preserve ${choice} selection`,
        );
        assert.equal(await form.getByTestId("new-chat-create").isEnabled(), choice !== "clear");
        await page.evaluate(async () => {
          await window.newChatSelectionFixture.refresh();
        });
        assert.equal(
          await folder.inputValue(),
          expected,
          "Workspace refresh must preserve the resolved selection",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${engine}: NewChat keyboard and delayed retained-source selection pass in both appearances`,
    );
  } finally {
    await browser.close();
  }
}
