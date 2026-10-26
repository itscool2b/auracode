import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkConfigSync(browser, url, out, engine) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const review = async (scenario = "") => {
      await page.goto(`${url}/?preview=config-sync&case=${scenario}`);
      await page.getByRole("button", { name: "Review", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Review configuration" });
      await dialog.getByRole("heading", { name: "This device", exact: true }).waitFor();
      assert.equal(
        await dialog
          .getByRole("button", {
            name: scenario === "delete" ? "Apply reviewed removal" : "Apply reviewed change",
          })
          .isDisabled(),
        true,
      );
      await dialog.getByRole("button", { name: "Keep this device", exact: true }).click();
      await page.waitForFunction(() => window.configSyncCalls.includes("preview:keep_local"));
      return dialog;
    };
    await page.goto(`${url}/?preview=config-sync&case=local`);
    await page.getByRole("button", { name: "Open Account settings" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.configSyncCalls), []);
    await review();
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-config-sync-review.png`) });
    assert.equal(
      (await page.evaluate(() => window.configSyncCalls)).some((call) => call.startsWith("apply:")),
      false,
    );
    await page.getByRole("button", { name: "Apply reviewed change" }).click();
    await page.getByRole("status").filter({ hasText: "Configuration saved" }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.configSyncCalls)).filter((call) =>
        call.startsWith("apply:"),
      ).length,
      1,
    );
    await page.getByLabel("Keep on this device").check();
    await page.waitForFunction(() => window.configSyncCalls.includes("device:true"));
    await page.getByRole("button", { name: "Load more" }).click();
    await page.getByText("rules/review.md", { exact: true }).waitFor();
    await review("stale");
    await page.getByRole("button", { name: "Apply reviewed change" }).click();
    await page.getByRole("alert").filter({ hasText: "This item changed" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Apply reviewed change" }).count(), 0);
    await page.getByRole("button", { name: "Review again" }).click();
    await page.getByRole("button", { name: "Apply reviewed change" }).waitFor();
    await review("partial");
    await page.getByRole("button", { name: "Apply reviewed change" }).click();
    await page.getByRole("status").filter({ hasText: "needs recovery" }).waitFor();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "Review recovery", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.configSyncCalls)).some((call) =>
        call.startsWith("rollback:"),
      ),
      false,
    );
    await page.getByRole("button", { name: "Restore this item" }).click();
    await page.getByRole("status").filter({ hasText: "Local configuration restored" }).waitFor();
    await review("delete");
    assert.equal(
      await page.getByRole("button", { name: "Apply reviewed removal" }).isDisabled(),
      true,
    );
    await page.getByLabel("I reviewed the removal of this item.").check();
    await page.getByRole("button", { name: "Apply reviewed removal" }).click();
    await page.getByRole("status").filter({ hasText: "Configuration saved" }).waitFor();
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
      await checkConfigSync(browser, process.env.ORBIT_URL ?? "http://localhost:1426", out, engine);
      console.log(
        `${engine}: configuration decisions, stale reviews, recovery and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
}
