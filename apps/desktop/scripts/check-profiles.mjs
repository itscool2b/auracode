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

export async function checkProfiles(browser, url, out, engine) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?preview=profiles&case=unsaved`);
    assert.equal(await page.getByRole("button", { name: "Current Local" }).isDisabled(), true);
    await page.getByRole("button", { name: "Open Kept workspace", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "draft has not been saved" }).waitFor();
    assert.equal(await page.getByLabel("Activation count").textContent(), "0");
    await page.goto(`${url}/?preview=profiles&case=busy`);
    await page.getByRole("button", { name: "Open Kept workspace", exact: true }).click();
    await page.getByText("Finish your active chat before switching profiles.").waitFor();
    assert.equal(await page.getByRole("status").first().textContent(), "Current profile preserved");
    // Every profile is on this computer: the list names no account and offers no sign-in.
    await page.goto(`${url}/?preview=profiles`);
    await page.getByRole("heading", { name: "Profiles", exact: true }).waitFor();
    assert.equal(await page.getByText("On this computer", { exact: false }).count(), 2);
    assert.equal(await page.getByText(/account|sign in/iu).count(), 0);
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-profiles.png`) });
    await page.getByRole("button", { name: "Open Kept workspace", exact: true }).click();
    await page.getByText("Opened kept; old page discarded", { exact: true }).waitFor();
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
      await checkProfiles(browser, process.env.CHECK_URL ?? "http://localhost:1426", out, engine);
      console.log(`${engine}: guarded profile switching passed`);
    } finally {
      await browser.close();
    }
  }
}
