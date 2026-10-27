/** Production recovery presentation with synthetic callbacks and network disabled. */
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
const origin = "http://127.0.0.1:1478";
const url = `${origin}/scripts/fixtures/config-recovery.html`;
const out = resolve(app, "../../target/config-recovery-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1478",
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
    } catch {
      /* Owned server starts asynchronously. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: "reduce",
        colorScheme: "dark",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.getByRole("heading", { name: "Finish opening your workspace" }).waitFor();
      assert.equal(await page.getByLabel("Recovery calls").textContent(), "0");
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}.png`) });
      await page.getByRole("button", { name: "Restore previous settings" }).click();
      await page.getByRole("heading", { name: "Recovery confirmed" }).waitFor();
      await page.goto(`${url}?case=conflict`);
      await page.getByRole("button", { name: "Restore previous settings" }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByLabel("Recovery calls").textContent(), "1");
      assert.match(await page.getByRole("alert").textContent(), /Existing files were preserved/);
      assert.equal(
        await page.getByRole("button", { name: "Restore previous settings" }).isEnabled(),
        true,
      );
      await page.goto(`${url}?case=locked`);
      assert.equal(
        await page.getByRole("button", { name: "Restore previous settings" }).isDisabled(),
        true,
      );
      await page.goto(`${url}?case=unavailable`);
      await page.getByRole("heading", { name: "Your settings are preserved" }).waitFor();
      assert.equal(await page.getByRole("button").count(), 0);
      assert.equal(await page.getByLabel("Recovery calls").textContent(), "0");
      for (const mode of ["auth-ready", "auth-wrong", "auth-new", "auth-pending"]) {
        await page.goto(`${url}?case=${mode}`);
        await page.getByRole("heading", { name: "Unlock the account for this recovery" }).waitFor();
        if (mode === "auth-ready" || mode === "auth-wrong") {
          const unlock = page.getByRole("button", { name: "Unlock selected account" });
          await unlock.waitFor();
          assert.equal(await unlock.isDisabled(), mode === "auth-wrong");
        }
        if (mode === "auth-new") await page.getByLabel("Email address").waitFor();
        if (mode === "auth-pending") {
          await page.getByText("Use my recovery key instead", { exact: true }).click();
          await page.getByLabel("Recovery key", { exact: true }).fill("SYNTHETIC-KEY");
          await page.getByRole("button", { name: "Unlock with recovery key" }).click();
          await page.getByRole("button", { name: "Unlock selected account" }).click();
          await page.getByText("Selected account unlocked", { exact: true }).waitFor();
        }
        assert.equal(
          await page
            .getByRole("button", {
              name: /Sign out|Create recovery key|Refresh devices|Revoke|Review approval/,
            })
            .count(),
          0,
        );
        assert.equal(await page.getByLabel("Forbidden account calls").textContent(), "0");
      }
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: explicit recovery, preserved failure, locked and unavailable states passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
