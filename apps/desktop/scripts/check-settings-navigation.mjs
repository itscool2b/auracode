import assert from "node:assert/strict";

const PAGES = [
  "General",
  "Appearance",
  "Chats",
  "Voice",
  "Shortcuts",
  "Agents",
  "Plugins & MCP",
  "Browser",
  "Instructions",
  "Project memory",
  "Remote access",
  "Account & sync",
  "Data & privacy",
  "About",
];

/**
 * One Settings screen (owner's plan, 4 November 2026): every page opens from its section with the
 * heading focused, Customize's pages keep what was typed in them, the search finds every row on
 * every page and opens it, and repeated website links never unmount an account setup.
 */
export async function checkSettingsNavigation(page, url) {
  const nextFrames = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${url}/?preview=settings&theme=system`);
    for (const label of PAGES) {
      const link = sections.getByRole("button", { name: label, exact: true });
      await link.focus();
      await page.keyboard.press("Enter");
      const heading =
        label === "About"
          ? page.getByRole("heading", { name: "About auracode", exact: true })
          : page.getByRole("heading", { name: label, exact: true, level: 1 });
      await page.waitForFunction(
        (name) =>
          document.activeElement?.tagName === "H1" && document.activeElement.textContent === name,
        label === "About" ? "About auracode" : label,
      );
      assert.equal(await link.getAttribute("aria-current"), "page");
      // Mount effects must not take focus back once someone moves on.
      await link.focus();
      await nextFrames();
      assert.equal(await link.evaluate((node) => node === document.activeElement), true, label);
      await heading.waitFor();
    }
    // Instructions open on the scope Settings was opened for.
    await sections.getByRole("button", { name: "Instructions", exact: true }).click();
    assert.equal(await page.getByRole("combobox", { name: "Applies to" }).inputValue(), "global");
  }
  for (const scope of ["folder", "chat"]) {
    await page.goto(`${url}/?preview=settings&page=instructions&scope=${scope}`);
    await page.getByRole("combobox", { name: "Applies to" }).waitFor();
    await page.waitForFunction(
      (value) => document.querySelector('select[aria-label="Applies to"]')?.value === value,
      `${scope}:fixture-${scope}`,
    );
  }

  // A page keeps what was typed in it across visits, as Customize's tabs did.
  await page.goto(`${url}/?preview=settings&page=memory&scope=folder`);
  const memory = page.getByRole("textbox", { name: "Markdown", exact: true });
  await memory.fill("# Unsaved note\n\nKeep this while visiting other pages.");
  await sections.getByRole("button", { name: "Appearance", exact: true }).click();
  await sections.getByRole("button", { name: "Project memory", exact: true }).click();
  assert.match(await memory.inputValue(), /Keep this while visiting/);

  // The search finds every row on every page by its title, and opens it.
  await page.goto(`${url}/?preview=settings`);
  const search = page.getByRole("searchbox", { name: "Search settings" });
  const titles = [];
  for (const label of PAGES) {
    await sections.getByRole("button", { name: label, exact: true }).click();
    await nextFrames();
    for (const title of await page
      .locator(".settings-page:not([hidden]) [data-setting]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.setting))) {
      titles.push([label, title]);
    }
  }
  assert.ok(titles.length >= 25, `only ${titles.length} rows found`);
  const results = page.getByRole("navigation", { name: "Matching settings" });
  for (const [label, title] of titles) {
    await search.fill(title);
    await results
      .getByRole("button", { name: title, exact: false })
      .first()
      .waitFor({ timeout: 2000 })
      .catch(() => {
        throw new Error(`Search does not find "${title}" on ${label}`);
      });
  }
  await search.fill("menu bar");
  await results.getByRole("button").first().click();
  await page.locator('[data-setting="Keep running in the background"]').waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Keep running in the tray",
  );
  await search.fill("text size");
  await search.press("Enter");
  await page.waitForFunction(
    () => document.activeElement?.closest('[data-setting="Text size"]') != null,
  );
  assert.equal(await search.inputValue(), "");
  // Esc clears a search before it leaves Settings.
  await search.fill("nothing at all matches this");
  await page.getByRole("status").filter({ hasText: "No setting matches" }).waitFor();
  await search.press("Escape");
  assert.equal(await search.inputValue(), "");
  assert.equal(await sections.count(), 1);

  // Voice's microphone test: the bar, the words as they come, then what finishing heard. Esc
  // cancels the test rather than leaving Settings.
  await sections.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByText("Parakeet TDT-CTC 110M, built in and ready", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page.getByRole("meter", { name: "Microphone level" }).waitFor();
  await page.getByText("Testing one two", { exact: false }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Test", exact: true }).waitFor();
  assert.equal(await sections.count(), 1, "Esc left Settings during the test");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page.getByRole("button", { name: "Finish the test", exact: true }).click();
  await page.evaluate(() => window.dictationFixture.complete());
  await page.getByRole("status").filter({ hasText: "Heard: Testing one, two, three." }).waitFor();
  await page.getByRole("button", { name: "Test again", exact: true }).waitFor();

  // Repeated website links must not unmount an inline code or key setup.
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
