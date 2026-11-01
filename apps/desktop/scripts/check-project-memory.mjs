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
