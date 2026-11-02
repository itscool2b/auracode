import assert from "node:assert/strict";

/** Repeated website navigation must not unmount an inline code/key setup. */
export async function checkSettingsNavigation(page, url) {
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${url}/?preview=settings&theme=system`);
    const navigation = page.getByRole("complementary", { name: "Settings navigation" });
    for (const [label, section] of [
      ["Plugins & MCP", "plugins"],
      ["Instructions", "instructions"],
      ["Project memory", "memory"],
    ]) {
      await navigation.getByRole("button", { name: label, exact: true }).focus();
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
    window.settingsFixture.calls().includes("customize:instructions"),
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
