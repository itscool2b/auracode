/** Production reset presentation, synthetic backend, no account service or credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:1486";
const url = `${origin}/scripts/fixtures/account-reset.html`;
const out = resolve(app, "../../target/account-reset-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1486",
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
  for (let i = 0; i < 100; i++) {
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
        viewport: { width: 1100, height: 1000 },
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        route.request().url().startsWith(origin) ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const calls = async () => JSON.parse(await page.getByLabel("Reset calls").textContent());
      await page.goto(url);
      await page.getByRole("button", { name: "Lost every device and recovery key?" }).click();
      assert.deepEqual(await calls(), { review: 0, confirm: 0, retry: 0, cancel: 0 });
      await page.getByRole("button", { name: "Review reset sync", exact: true }).click();
      await page.getByLabel("New recovery key", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Permanently reset sync", exact: true })
          .isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Cancel review", exact: true }).click();
      assert.equal((await calls()).confirm, 0);
      assert.equal(await page.getByLabel("New recovery key", { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Review reset sync", exact: true }).click();
      await page
        .getByLabel("I saved this new recovery key somewhere safe", { exact: true })
        .check();
      assert.equal(
        await page
          .getByRole("button", { name: "Permanently reset sync", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByLabel("Type RESET SYNC to permanently remove the old cloud data", { exact: true })
        .fill("RESET SYNC");
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
      await page.getByRole("button", { name: "Permanently reset sync", exact: true }).click();
      await page.getByRole("alert").waitFor();
      await page.getByRole("button", { name: "Retry saved reset", exact: true }).click();
      await page.getByLabel("Account access").filter({ hasText: "ready" }).waitFor();
      assert.equal((await calls()).confirm, 1);
      assert.equal((await calls()).retry, 1);
      await page.goto(`${url}?mode=pending`);
      await page.getByRole("button", { name: "Cancel pending reset safely", exact: true }).click();
      assert.equal((await calls()).cancel, 1);
      assert.equal((await calls()).review, 0);
      await page.goto(`${url}?mode=committed`);
      await page.getByRole("button", { name: "Finish reset locally", exact: true }).click();
      assert.equal((await calls()).retry, 1);
      assert.equal((await calls()).confirm, 0);
      await page.goto(`${origin}/?preview=account&stage=deleted`);
      await page.getByRole("heading", { name: "This account was deleted", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open retained account workspace" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Review Keep as Local" }).count(), 0);
      await page.goto(`${origin}/?preview=account&stage=deleted&active=fixture-profile`);
      await page.getByRole("button", { name: "Review Keep as Local" }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.goto(`${url}?mode=rebind`);
      await page.getByRole("button", { name: "Choose existing workspace" }).waitFor();
      assert.deepEqual(JSON.parse(await page.getByLabel("Rebind calls").textContent()), {
        list: 0,
        restore: 0,
      });
      await page.getByRole("button", { name: "Choose existing workspace" }).click();
      assert.equal(
        await page.getByRole("button", { name: "Restore workspace binding" }).isDisabled(),
        true,
      );
      assert.equal(await page.locator("option[value='local']").count(), 0);
      await page.getByLabel("Existing Account workspace").selectOption("synthetic-profile");
      await page.getByRole("button", { name: "Restore workspace binding" }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByLabel("Bound profile").textContent(), "");
      await page.getByRole("button", { name: "Restore workspace binding" }).click();
      await page.getByLabel("Bound profile").filter({ hasText: "synthetic-profile" }).waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `${name}: explicit destructive review, cancel, retained failure, exact retry and committed local completion passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
