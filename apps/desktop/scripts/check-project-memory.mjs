/** Browser fixture evidence only, separate from native lifecycle/encryption verification. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { choose, labels } from "./choose.mjs";

/**
 * Project memory is the notes and one switch (owner, 10 November 2026): type and Save, with no
 * history, proposals or reasons. An agent's edit shows a notice with Undo; a version saved
 * elsewhere while a draft is open is offered in its place and never laid over it.
 */
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
    const editor = page.getByRole("textbox", { name: "Markdown", exact: true });
    const save = page.getByRole("button", { name: "Save", exact: true });
    const discard = page.getByRole("button", { name: "Discard", exact: true });
    const toggle = page.getByRole("switch", { name: "Let agents edit memory" });
    const toast = page.getByTestId("memory-edit-banner");
    const saves = () => page.evaluate(() => window.projectMemoryFixture.saves());
    const agentWrite = (markdown, options) =>
      page.evaluate(
        ([text, input]) => window.projectMemoryFixture.agentWrite(text, input),
        [markdown, options],
      );

    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${url}/?preview=project-memory`);
      await editor.waitFor();
      assert.match(await editor.inputValue(), /^# Project notes\n\nUse pnpm/);
      // The page is the notes: nothing of the old review surface is left.
      for (const gone of ["Proposals", "Revision history", "Reason for this edit", "Refresh"])
        assert.equal(await page.getByText(gone, { exact: false }).count(), 0, gone);
      for (const gone of ["Export", "Import", "Restore", "View revision", "Review"])
        assert.equal(await page.getByRole("button", { name: gone }).count(), 0, gone);
      // One project: nothing to choose.
      assert.equal(await page.getByRole("combobox", { name: "Project" }).count(), 0);
      assert.equal(await toggle.isChecked(), true);
      await page.getByText("A notice with Undo follows each edit.", { exact: false }).waitFor();
      assert.equal(await save.isDisabled(), true);
      assert.equal(await discard.isDisabled(), true);
      await page.getByText("50 of 16,384 bytes").waitFor();
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-memory-${theme}.png`) });
    }

    // Typing makes a draft; Discard returns to what was saved; Save keeps it, with no questions.
    await editor.fill("# Project notes\n\nUse pnpm. Ünïcode counts as bytes.\n");
    await page.getByText("54 of 16,384 bytes").waitFor();
    assert.equal(await save.isDisabled(), false);
    await discard.click();
    assert.match(await editor.inputValue(), /Use pnpm for workspace commands\.\n$/);
    assert.equal(await save.isDisabled(), true);
    await editor.fill("# Project notes\n\nUse pnpm. Run the Rust tests before a commit.\n");
    await save.click();
    await page.getByText("Saved. Agents get it with their next message.").waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.deepEqual((await saves())[0], {
      markdown: "# Project notes\n\nUse pnpm. Run the Rust tests before a commit.\n",
      reason: "Edited in Settings",
      source: "user",
    });

    // More than memory holds cannot be saved, and the page says by how much.
    const before = await editor.inputValue();
    await editor.fill("x".repeat(16_400));
    await page.getByText("16 bytes over the 16 KB limit").waitFor();
    assert.equal(await save.isDisabled(), true);
    await discard.click();
    assert.equal(await editor.inputValue(), before);

    // An agent's edit, with no draft open: the notes follow at once, and a notice offers Undo.
    assert.equal(
      await agentWrite("# Project notes\n\nThe agent learned the deploy command.\n"),
      true,
    );
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="Markdown"]')?.value.includes("deploy command"),
    );
    await toast.getByText("Project memory updated").waitFor();
    await toast.getByText("Claude Code · Fix the login flow · auracode fixture").waitFor();
    assert.equal(await toast.getByRole("button", { name: "Review" }).count(), 0);
    await toast.getByRole("button", { name: "Open", exact: true }).waitFor();
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-memory-agent-edit.png`) });
    await toast.getByRole("button", { name: "Undo", exact: true }).click();
    await toast.getByText("Edit undone").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('textarea[aria-label="Markdown"]')
        ?.value.includes("Run the Rust tests before a commit."),
    );
    assert.match((await saves())[0].reason, /^Undid an edit by Claude Code in Fix the login flow$/);

    // An agent's edit while a draft is open: the draft stays, and the newer version is offered.
    await editor.fill("My half-written note.");
    await agentWrite("# Project notes\n\nSaved by the agent meanwhile.\n", {
      chat: "chat-untitled",
    });
    const newer = page.locator(".project-memory-newer");
    await newer.getByText("Memory changed while you were editing.").waitFor();
    assert.equal(await editor.inputValue(), "My half-written note.");
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-memory-newer.png`) });
    await newer.getByRole("button", { name: "Use the newer version" }).click();
    assert.match(await editor.inputValue(), /Saved by the agent meanwhile\./);
    assert.equal(await newer.count(), 0);
    assert.equal(await save.isDisabled(), true);
    // Or the draft is saved in its place, as the notice said it would be.
    await editor.fill("Mine again.");
    await agentWrite("# Project notes\n\nAnother agent edit.\n");
    await newer.waitFor();
    await save.click();
    await page.getByText("Saved. Agents get it with their next message.").waitFor();
    assert.equal((await saves())[0].markdown, "Mine again.");
    assert.equal(await newer.count(), 0);
    // An event that never arrived is caught up when the window is looked at again.
    await agentWrite("# Project notes\n\nWritten while nobody looked.\n", { silent: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() =>
      document.querySelector('textarea[aria-label="Markdown"]')?.value.includes("nobody looked"),
    );

    // Off: agents read memory and cannot change it. Nothing queues anywhere.
    await toggle.uncheck();
    await page.getByText("Agents read it and cannot change it.").waitFor();
    const kept = await editor.inputValue();
    const count = (await saves()).length;
    assert.equal(await agentWrite("An edit that must not land."), false);
    await page.waitForTimeout(150);
    assert.equal(await editor.inputValue(), kept);
    assert.equal((await saves()).length, count);
    await toggle.check();
    await page.getByText("A notice with Undo follows each edit.", { exact: false }).waitFor();

    // A save that meets a version saved a moment earlier fails in words and offers that version.
    await page.goto(`${url}/?preview=project-memory&case=stale`);
    await editor.waitFor();
    await editor.fill("My edit.");
    await save.click();
    await page
      .getByRole("alert")
      .getByText("Project memory changed while you were editing.")
      .waitFor();
    await newer.waitFor();
    assert.equal(await editor.inputValue(), "My edit.", "the draft was lost");
    await save.click();
    await page.getByText("Saved. Agents get it with their next message.").waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);

    // Several projects: each has its own memory, chosen in one place.
    await page.goto(`${url}/?preview=project-memory&projects=2`);
    const project = page.getByRole("combobox", { name: "Project" });
    await project.waitFor();
    assert.deepEqual(await labels(project), ["auracode fixture", "website fixture"]);
    await editor.waitFor();
    await choose(project, { label: "website fixture" });
    await page.waitForFunction(
      () => document.querySelector('textarea[aria-label="Markdown"]')?.value === "",
    );
    assert.equal(
      await editor.getAttribute("placeholder"),
      "What should every chat in this project know?",
    );
    // A draft belongs to its project: the choice waits until it is saved or discarded.
    await editor.fill("Website notes.");
    assert.equal(await project.isDisabled(), true);
    await page.getByText("Save or discard your edit to switch.").waitFor();
    await save.click();
    await page.getByText("Saved. Agents get it with their next message.").waitFor();
    assert.equal(await project.isDisabled(), false);
    await choose(project, { label: "auracode fixture" });
    await page.waitForFunction(() =>
      document
        .querySelector('textarea[aria-label="Markdown"]')
        ?.value.startsWith("# Project notes"),
    );
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);

    // No project yet: the page says what to do, and there is nothing to type into.
    await page.goto(`${url}/?preview=project-memory&projects=0`);
    await page.getByText("Create a project to keep shared project memory.").waitFor();
    assert.equal(await editor.count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
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
