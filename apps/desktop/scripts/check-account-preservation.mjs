import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkAccountPreservation(page, url, out, engine) {
  await page.goto(`${url}/?preview=keep-local`);
  const review = page.getByRole("button", { name: "Review Keep as Local", exact: true });
  await review.waitFor();
  assert.deepEqual(await page.evaluate(() => window.preservationFixture.calls()), []);
  await review.click();
  const apply = page.getByRole("button", { name: "Create Local copy", exact: true });
  await apply.waitFor();
  assert.equal(await apply.isDisabled(), true);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.screenshot({ path: resolve(out, `${engine}-keep-local-review.png`) });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.preservationFixture.calls()), ["preview"]);
  await review.click();
  await page.getByRole("checkbox", { name: /unencrypted/ }).check();
  await apply.click();
  await page.getByRole("status").filter({ hasText: "Saved 2 project(s)" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.preservationFixture.calls()), [
    "preview",
    "preview",
    "apply:review-2",
  ]);
  await page.getByRole("button", { name: "Open Local copy", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.preservationFixture.calls())).at(-1),
    "open:kept-local",
  );
  for (const scenario of ["stale", "partial"]) {
    await page.goto(`${url}/?preview=keep-local&${scenario}`);
    await review.click();
    await page.getByRole("checkbox", { name: /unencrypted/ }).check();
    await apply.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await apply.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.preservationFixture.calls()), [
      "preview",
      "apply:review-1",
    ]);
    await page.getByRole("button", { name: "Review again", exact: true }).click();
    assert.equal(await page.getByRole("checkbox", { name: /unencrypted/ }).isChecked(), false);
  }
  await page.goto(`${url}/?preview=keep-local&open-fails`);
  await review.click();
  await page.getByRole("checkbox", { name: /unencrypted/ }).check();
  await apply.click();
  await page.getByRole("button", { name: "Open Local copy", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "The Local copy is saved" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.preservationFixture.calls()), [
    "preview",
    "apply:review-1",
    "open:kept-local",
  ]);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${url}/?preview=keep-local`);
  await review.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
  await page.getByRole("checkbox", { name: /unencrypted/ }).check();
  await apply.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, `${engine}-keep-local-mobile.png`) });
  await apply.click();
  await page.getByRole("status").filter({ hasText: "Saved 2 project(s)" }).waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/settings-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      const url = process.env.ORBIT_URL ?? "http://127.0.0.1:1438";
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === new URL(url).origin
          ? route.continue()
          : route.abort(),
      );
      await checkAccountPreservation(await context.newPage(), url, out, engine);
      console.log(`${engine}: reviewed Keep as Local passed`);
    } finally {
      await browser.close();
    }
  }
}
