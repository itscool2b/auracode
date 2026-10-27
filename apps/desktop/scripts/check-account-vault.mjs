/** Production storage view with synthetic callbacks. No OS store, account or network access. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:1484";
const url = `${origin}/scripts/fixtures/account-vault.html`;
const out = resolve(app, "../../target/account-vault-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1484",
    "--strictPort",
  ],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    log = (log + data).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(log);
    try {
      ready = (await fetch(url)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
  for (const [name, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1100, height: 800 },
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        route.request().url().startsWith(origin) ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.getByLabel("Passphrase", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Vault writes").textContent(), "0");
      await page.getByLabel("Passphrase", { exact: true }).fill("incorrect synthetic passphrase");
      await page.getByRole("button", { name: "Unlock store", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByLabel("Passphrase", { exact: true }).inputValue(), "");
      await page.getByLabel("Passphrase", { exact: true }).fill("synthetic correct passphrase");
      await page.getByRole("button", { name: "Unlock store", exact: true }).click();
      await page.getByText("Account access can continue", { exact: true }).waitFor();
      await page.goto(`${url}?mode=create`);
      await page.getByRole("button", { name: "Use a passphrase store" }).click();
      assert.equal(await page.getByLabel("Vault writes").textContent(), "0");
      await page.getByLabel("Passphrase", { exact: true }).fill("synthetic correct passphrase");
      assert.equal(
        await page
          .getByRole("button", { name: "Create passphrase store", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByLabel("Confirm passphrase", { exact: true })
        .fill("synthetic correct passphrase");
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await page.getByLabel("Vault writes").textContent(), "0");
      await page.getByRole("button", { name: "Use a passphrase store" }).click();
      assert.equal(await page.getByLabel("Passphrase", { exact: true }).inputValue(), "");
      await page.getByLabel("Passphrase", { exact: true }).fill("synthetic correct passphrase");
      await page
        .getByLabel("Confirm passphrase", { exact: true })
        .fill("synthetic correct passphrase");
      await page.getByRole("button", { name: "Create passphrase store", exact: true }).click();
      await page.getByText(/Quit and reopen auracode/).waitFor();
      assert.equal(await page.getByText("Account access can continue", { exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(
        `${name}: explicit create, cancellation, unlock, wrong-passphrase retention and restart state passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
