import assert from "node:assert/strict";

/** Repeated website navigation must not unmount an inline code/key setup. */
export async function checkSettingsNavigation(page, url) {
  await checkCustomizeTransitions(page, url);
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${url}/?preview=settings&theme=system`);
    const navigation = page.getByRole("complementary", { name: "Settings navigation" });
    for (const [label, section] of [
      ["Plugins & MCP", "plugins"],
      ["Instructions", "instructions"],
      ["Project memory", "memory"],
    ]) {
      const link = navigation.getByRole("button", { name: label, exact: true });
      await link.focus();
      // Mount effects and StrictMode cleanup must not take focus back after interaction.
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      assert.equal(await link.evaluate((element) => element === document.activeElement), true);
      await page.keyboard.press("Enter");
      assert.equal(
        (await page.evaluate(() => window.settingsFixture.calls())).at(-1),
        `customize:${section}`,
      );
      assert.equal(await page.getByRole("heading", { name: "General", exact: true }).count(), 1);
    }
  }
  await page.goto(`${url}/?preview=settings&legacy-instructions`);
  await page.waitForFunction(() =>
    window.settingsFixture?.calls().includes("customize:instructions"),
  );
  assert.equal(
    await page.locator(".instructions-panel").count(),
    0,
    "legacy route opened an obsolete settings editor",
  );
  await page.goto(`${url}/?preview=settings&signin=1&signed-out=1`);
  const email = page.getByRole("textbox", { name: "Email address", exact: true });
  await email.waitFor();
  assert.equal(await email.inputValue(), "first@example.com");
  await email.fill("my-unsent-edit@example.com");
  const before = await page.evaluate(() => window.settingsFixture.calls());
  await page.evaluate(() => window.settingsNavigationFixture.open("second@example.com"));
  assert.equal(await email.inputValue(), "my-unsent-edit@example.com");
  assert.deepEqual(await page.evaluate(() => window.settingsFixture.calls()), before);

  await page.goto(`${url}/?preview=settings&signin=1`);
  await page.getByRole("button", { name: "Create recovery key", exact: true }).click();
  const key = page.getByRole("textbox", { name: "Recovery key", exact: true });
  await key.waitFor();
  const calls = await page.evaluate(() => window.settingsFixture.calls());
  await page.evaluate(() => window.settingsNavigationFixture.open("second@example.com"));
  assert.equal(await key.inputValue(), "SYNTHETIC-KEY-RETAINED-ACROSS-LINKS");
  assert.deepEqual(await page.evaluate(() => window.settingsFixture.calls()), calls);
  await page.getByRole("checkbox", { name: "I saved my recovery key somewhere safe" }).check();
}

/** Unmount the origin and mount the real destination, including its asynchronous data panels. */
async function checkCustomizeTransitions(page, url) {
  const nextFrames = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const destination = page.getByRole("heading", { name: "Customize", exact: true });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${url}/?preview=settings&customize-navigation&theme=system`);
    const draft = page.getByRole("textbox", { name: "Chat draft" });
    await draft.fill(`Keep my ${theme} draft`);
    await draft.evaluate((element) => {
      element.dataset.retained = "true";
    });
    for (const label of ["Plugins & MCP", "Instructions", "Project memory"]) {
      await page.getByRole("button", { name: "Open Settings", exact: true }).click();
      const origin = page.getByRole("complementary", { name: "Settings navigation" });
      await origin.getByRole("button", { name: label, exact: true }).focus();
      await page.keyboard.press("Enter");
      await destination.waitFor();
      await nextFrames();
      assert.equal(await origin.count(), 0, "Settings must unmount when Customize opens");
      assert.equal(
        await destination.evaluate((element) => element === document.activeElement),
        true,
      );
      const selected = page
        .getByRole("navigation", { name: "Customize sections" })
        .getByRole("button", { name: label, exact: true });
      assert.equal(await selected.getAttribute("aria-current"), "page");
      await selected.focus();
      await nextFrames();
      assert.equal(
        await selected.evaluate((element) => element === document.activeElement),
        true,
        "destination mount effects must not reclaim focus after keyboard interaction",
      );
      if (label === "Instructions") {
        assert.equal(
          await page.getByRole("combobox", { name: "Applies to" }).inputValue(),
          "global",
        );
      }
      await page.getByRole("button", { name: "Back to chats", exact: true }).click();
      await draft.waitFor();
      assert.equal(await draft.inputValue(), `Keep my ${theme} draft`);
      assert.equal(await draft.getAttribute("data-retained"), "true", "chat view remounted");
    }
    for (const scope of ["folder", "chat"]) {
      await page.goto(
        `${url}/?preview=settings&customize-navigation&legacy-instructions&scope=${scope}&theme=system`,
      );
      await destination.waitFor();
      await nextFrames();
      assert.equal(
        await destination.evaluate((element) => element === document.activeElement),
        true,
      );
      assert.equal(
        await page.getByRole("combobox", { name: "Applies to" }).inputValue(),
        `${scope}:fixture-${scope}`,
      );
      assert.equal(await page.locator(".settings-shell").count(), 0);
    }
  }
}
