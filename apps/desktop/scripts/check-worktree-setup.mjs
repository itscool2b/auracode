import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

export async function checkWorktreeSetup(browser, url, out, engine) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const prepare = async (scenario = "") => {
      await page.goto(`${url}/?preview=worktree-setup&case=${scenario}`);
      await page
        .getByLabel("Files to copy, one relative path per line")
        .fill(".env.local\nconfig/development.json");
      await page.getByLabel("Setup program", { exact: true }).fill("node");
      await page
        .getByLabel("Arguments, one per line", { exact: true })
        .fill("scripts/setup.mjs\n--local");
      // Run: what the Run button starts in a worktree of this folder, saved with the rest.
      await page.getByLabel("Run program", { exact: true }).fill("pnpm");
      await page.getByLabel("Run arguments, one per line", { exact: true }).fill("dev");
      assert.equal(
        await page.getByRole("button", { name: "Review setup", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Save setup", exact: true }).click();
      await page.getByRole("button", { name: "Review setup", exact: true }).click();
      await page.getByRole("region", { name: "Review worktree setup" }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.setupCalls), ["save", "review"]);
      assert.deepEqual(await page.evaluate(() => window.setupSaved.run), {
        program: "pnpm",
        args: ["dev"],
      });
    };
    await prepare();
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-worktree-setup.png`) });
    await page.getByRole("button", { name: "Copy reviewed files" }).click();
    await page.getByRole("button", { name: "Open setup terminal" }).click();
    const start = page.getByRole("button", { name: "Start setup", exact: true });
    await start.waitFor();
    assert.equal((await page.evaluate(() => window.setupCalls)).includes("start"), false);
    await start.click();
    await page.waitForFunction(() => window.setupCalls.includes("start"));
    await page.getByRole("button", { name: "Close setup terminal" }).click();
    await page.waitForFunction(() => window.setupCalls.includes("close"));
    await prepare("stale");
    await page.getByRole("button", { name: "Copy reviewed files" }).click();
    await page.getByRole("alert").filter({ hasText: "A setup file changed" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open setup terminal" }).count(), 0);
    await prepare("partial");
    await page.getByRole("button", { name: "Copy reviewed files" }).click();
    await page.getByText("Copied 1 file.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open setup terminal" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/settings-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkWorktreeSetup(
        browser,
        process.env.CHECK_URL ?? "http://localhost:1426",
        out,
        engine,
      );
      console.log(`${engine}: explicit setup review, terminal and partial recovery passed`);
    } finally {
      await browser.close();
    }
  }
}
