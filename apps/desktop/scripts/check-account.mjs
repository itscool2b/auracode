import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

export async function checkAccount(browser, url, out, engine) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue()
      : route.abort(),
  );
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}/?preview=account`);
    await page.getByLabel("Email address").fill("fixture@example.invalid");
    const send = page.getByRole("button", { name: "Send sign-in code" });
    assert.equal(await send.isDisabled(), true);
    await page.getByRole("button", { name: "Complete synthetic verification" }).click();
    await send.click();
    await page.getByLabel("Code sent to fixture@example.invalid").fill("000000");
    await page.getByRole("button", { name: "Verify code", exact: true }).click();
    await page.getByText("That code is invalid.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Code sent to fixture@example.invalid").inputValue(), "");
    await page.getByLabel("Code sent to fixture@example.invalid").fill("123456");
    await page.getByRole("button", { name: "Verify code", exact: true }).click();
    await page.getByRole("button", { name: "Register this device" }).click();
    await page.getByRole("button", { name: "Create recovery key" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "Recovery key", exact: false }).inputValue(),
      "SYNTHETIC-RECOVERY-KEY-FOR-UI-TESTS",
    );
    const confirm = page.getByRole("button", { name: "Confirm saved key" });
    assert.equal(await confirm.isDisabled(), true);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-account-recovery.png`) });
    await page.getByLabel("I saved my recovery key somewhere safe").check();
    await confirm.click();
    await page.getByText("This device is approved", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "Recovery key", exact: false }).count(),
      0,
    );
    await page.getByRole("button", { name: "Review approval" }).click();
    await page.getByLabel("Recipient verification code").fill("WRONG-CODE");
    await page.getByRole("button", { name: "Approve reviewed device" }).click();
    await page
      .getByRole("dialog")
      .getByText("The recipient code does not match. Compare it on the other device.", {
        exact: true,
      })
      .waitFor();
    await page.getByLabel("Recipient verification code").fill("RECIPIENT-8392");
    await page.getByRole("button", { name: "Approve reviewed device" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page
      .getByRole("listitem")
      .filter({ hasText: "Other computer" })
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    await page.getByRole("button", { name: "Revoke device access" }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: "Other computer" })
      .getByText("macos · Revoked", { exact: true })
      .waitFor();
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-account-devices.png`) });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in to auracode" }).waitFor();
    await page.goto(`${url}/?preview=account&stage=pending`);
    await page.getByText("THIS-DEVICE-1234", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Check approval" }).click();
    const trust = page.getByRole("button", { name: "Trust this account key" });
    assert.equal(await trust.isDisabled(), true);
    await page.getByLabel("I compared the complete fingerprint and it matches").check();
    await trust.click();
    await page.getByText("This device is approved", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
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
      await checkAccount(browser, process.env.ORBIT_URL ?? "http://localhost:1426", out, engine);
      console.log(`${engine}: account setup and device review passed`);
    } finally {
      await browser.close();
    }
  }
}
