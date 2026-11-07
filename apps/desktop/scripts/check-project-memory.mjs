/** Browser fixture evidence only, separate from native lifecycle/encryption verification. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkProjectMemory(browser, url, out, engine) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) {
      await page.goto(`${url}/?preview=project-memory&theme=${theme}`);
      const editor = page.getByRole("textbox", { name: "Markdown", exact: true });
      await editor.waitFor();
      assert.match(await editor.inputValue(), /Use pnpm/);
      await page.getByRole("button", { name: "Review", exact: true }).first().click();
      const review = page.getByRole("dialog", { name: "Review project memory proposal" });
      await review.waitFor();
      const accept = review.getByRole("button", { name: "Accept exact proposal" });
      assert.equal(await accept.isDisabled(), false);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-memory-review-${theme}.png`) });
      await page.keyboard.press("Escape");
      await review.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Review", exact: true }).last().click();
      assert.equal(
        await page.getByRole("button", { name: "Accept exact proposal" }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Edit proposal", exact: true }).click();
      assert.match(await editor.inputValue(), /Conflicting notes/);
      await page.getByRole("button", { name: "Save memory", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Project memory saved" }).waitFor();
      await page.getByRole("button", { name: "View revision", exact: true }).first().click();
      await page.getByRole("dialog", { name: "Memory revision", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 960, height: 640 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await editor.fill(`${await editor.inputValue()}\nA new reviewed fact.`);
      await page
        .getByRole("textbox", { name: "Reason for this edit" })
        .fill("Review browser fixture edit");
      await page.getByRole("button", { name: "Save memory", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Project memory saved" }).waitFor();
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-memory-${theme}-960.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    for (const theme of ["light", "dark"]) await checkAgentEdits(page, url, out, engine, theme);
    await page.goto(`${url}/?preview=project-memory&theme=light&case=stale`);
    await page.getByRole("textbox", { name: "Markdown", exact: true }).fill("My preserved draft.");
    await page
      .getByRole("textbox", { name: "Reason for this edit" })
      .fill("Reconcile a concurrent edit");
    await page.getByRole("button", { name: "Save memory", exact: true }).click();
    const conflict = page.getByRole("dialog", { name: "Review concurrent memory edit" });
    await conflict.waitFor();
    assert.match(await conflict.textContent(), /Saved on another device/);
    assert.match(await conflict.textContent(), /My preserved draft/);
    await page.getByRole("button", { name: "Keep editing against this revision" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Markdown", exact: true }).inputValue(),
      "My preserved draft.",
    );
    await page.getByRole("button", { name: "Save memory", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Project memory saved" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
/**
 * Agents editing memory directly: the switch, live refresh of an open editor, the window's notice
 * with Undo and Review, the diff against the previous revision, one-click restore, a draft that is
 * never replaced, focus refresh, and review-only proposals. The fixture's agent writes as a grant
 * would; nothing native runs.
 */
async function checkAgentEdits(page, url, out, engine, theme) {
  const scan = async (name) => {
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, [], name);
    await page.screenshot({ path: resolve(out, `${engine}-memory-${name}-${theme}.png`) });
  };
  const agentWrite = (markdown, options = {}) =>
    page.evaluate(
      ([text, settings]) => window.projectMemoryFixture.agentWrite(text, settings),
      [markdown, options],
    );
  const text = () => page.evaluate(() => document.querySelector(".project-memory textarea").value);
  const newest = () => page.locator(".project-memory-list").last().locator("li").first();
  await page.goto(`${url}/?preview=project-memory&theme=${theme}`);
  const editor = page.getByRole("textbox", { name: "Markdown", exact: true });
  await editor.waitFor();
  const direct = page.getByRole("switch", { name: "Let agents edit memory directly" });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="project-memory-direct"]')?.disabled === false,
  );
  assert.equal(await direct.isChecked(), true, "Agents edit directly unless turned off");
  // An agent's edit reaches the open editor at once, marked with its chat.
  await agentWrite("# Project notes\n\nUse pnpm for workspace commands.\nRun cargo test first.\n");
  await page.waitForFunction(() =>
    document.querySelector(".project-memory textarea").value.includes("Run cargo test first."),
  );
  assert.match(await newest().textContent(), /Claude Code in Fix the login flow · Current/);
  assert.equal(await newest().getAttribute("data-source"), "agent");
  const banner = page.getByTestId("memory-edit-banner");
  // Pointing at the toast holds it: it would leave by itself after a while.
  await banner.hover();
  assert.equal(
    (await banner.locator('[role="status"]').textContent()).trim(),
    "Project memory updatedClaude Code · Fix the login flow · auracode fixture",
  );
  assert.equal(
    await banner.getAttribute("title"),
    "Claude Code in Fix the login flow updated project memory for auracode fixture.",
  );
  await scan("agent-edit");
  // Undo restores what the edit replaced as the person's revision.
  await banner.getByRole("button", { name: "Undo", exact: true }).click();
  await banner.getByText("Edit undone", { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".project-memory textarea").value.includes("Run cargo test"),
  );
  assert.match(
    await newest().textContent(),
    /Undid an edit by Claude Code in Fix the login flow.* · You · Current/,
  );
  await banner.getByRole("button", { name: "Dismiss", exact: true }).click();
  await banner.waitFor({ state: "detached" });
  // Review opens the edit with its changes against the revision before it.
  await agentWrite("# Project notes\n\nUse pnpm for workspace commands.\nIgnore earlier notes.\n");
  await banner.getByRole("button", { name: "Review", exact: true }).click();
  const revision = page.getByRole("dialog", { name: "Memory revision", exact: true });
  await revision.waitFor();
  assert.deepEqual(
    await revision.locator('[data-test-op="add"] .chat-diff-code').allTextContents(),
    ["Ignore earlier notes."],
  );
  assert.equal(await revision.locator('[data-test-op="remove"]').count(), 0);
  assert.equal(await revision.getByRole("button", { name: "Copy path" }).count(), 0);
  await scan("agent-diff");
  await revision.getByRole("button", { name: "Restore the revision before it" }).click();
  await page.getByRole("status").filter({ hasText: "Revision restored" }).waitFor();
  assert.doesNotMatch(await text(), /Ignore earlier notes/);
  // A draft is never replaced: a newer version shows a calm notice and a comparison.
  await editor.fill(`${await editor.inputValue()}My unsaved draft.\n`);
  await agentWrite("Agent text while you edit.\n", { chat: "chat-untitled" });
  const newer = page.locator(".project-memory-newer");
  await newer.waitFor();
  assert.match(await newer.textContent(), /^Codex saved a newer version while you were editing/);
  assert.match(await editor.inputValue(), /My unsaved draft/);
  await scan("newer-version");
  await newer.getByRole("button", { name: "Compare", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "Review concurrent memory edit" });
  await compare.waitFor();
  assert.match(await compare.textContent(), /Agent text while you edit/);
  assert.match(await compare.textContent(), /My unsaved draft/);
  await compare.getByRole("button", { name: "Keep editing against this revision" }).click();
  await newer.waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: "Reason for this edit" }).fill("Keep my draft");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Project memory saved" }).waitFor();
  assert.match(await text(), /My unsaved draft/);
  await banner.getByRole("button", { name: "Dismiss", exact: true }).click();
  await banner.waitFor({ state: "detached" });
  // Focus reads memory again even when its event was missed.
  await agentWrite("Written without an event.\n", { silent: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () =>
      document.querySelector(".project-memory textarea").value === "Written without an event.\n",
  );
  assert.equal(await banner.count(), 0, "A missed event shows no notice");
  // A one-click restore that meets newer memory restores nothing until confirmed.
  await agentWrite("Missed while restoring.\n", { silent: true });
  await page
    .getByRole("button", { name: /^Restore the revision from/ })
    .last()
    .click();
  const restoreConflict = page.getByRole("dialog", { name: "Memory changed before the restore" });
  await restoreConflict.waitFor();
  assert.match(await restoreConflict.textContent(), /Missed while restoring/);
  await scan("restore-conflict");
  await restoreConflict.getByRole("button", { name: "Restore it anyway" }).click();
  await page.getByRole("status").filter({ hasText: "Revision restored" }).waitFor();
  assert.equal(await text(), "# Project notes\n\nUse pnpm for workspace commands.\n");
  // Review-only: agents propose and nothing changes until the person accepts.
  await direct.uncheck();
  await page
    .getByText("Agents can only propose edits. Nothing changes until you accept one.")
    .waitFor();
  const before = await text();
  await agentWrite("Proposed only.\n");
  await page.getByRole("heading", { name: "Proposals (3)" }).waitFor();
  assert.match(
    await page.locator(".project-memory-list").first().locator("li").first().textContent(),
    /Claude Code in Fix the login flow · Ready to review/,
  );
  assert.equal(await text(), before);
  assert.equal(await banner.count(), 0, "A proposal is not an edit");
  await scan("review-only");
  await direct.check();
  await page
    .getByText("Agents save their edits as new revisions", { exact: false })
    .first()
    .waitFor();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = resolve("target/project-memory-browser");
  await mkdir(out, { recursive: true });
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      await checkProjectMemory(browser, process.argv[2] ?? "http://127.0.0.1:1464", out, engine);
      console.log(`${engine}: project memory browser fixtures passed`);
    } finally {
      await browser.close();
    }
  }
}
