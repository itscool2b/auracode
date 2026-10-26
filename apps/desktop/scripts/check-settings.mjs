/** Synthetic command responses exercise production settings without touching native state. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";
import { checkGitReview } from "./check-git-review.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] ?? "http://127.0.0.1:1464";
const out = resolve(app, "../../target/settings-browser");
const require = createRequire(import.meta.url);
const server = process.argv[2]
  ? null
  : spawn(
      process.execPath,
      [
        resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        "1464",
        "--strictPort",
      ],
      { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
let output = "";
if (server)
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (data) => {
      output = (output + data).slice(-8192);
    });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode != null) throw new Error(output);
    try {
      ready = (await fetch(url)).ok;
    } catch {
      /* The owned server is still starting. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output || "The preview server did not start.");
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === new URL(url).origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?preview=settings`);
      await page.getByRole("radio", { name: "Reduced", exact: true }).check();
      assert.equal(await page.evaluate(() => window.settingsFixture.motion()), "reduced");
      await page.evaluate(() => sessionStorage.setItem("settings-fail-save", "yes"));
      await page.getByRole("radio", { name: "Off", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Preferences could not be saved" }).waitFor();
      assert.equal(
        await page.getByRole("radio", { name: "Reduced", exact: true }).isChecked(),
        true,
      );
      await page.evaluate(() => sessionStorage.removeItem("settings-fail-save"));
      await page.getByRole("button", { name: "Reload preferences" }).click();
      await page.getByRole("alert").waitFor({ state: "hidden" });
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-general.png`) });
      await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
      assert.equal(
        await page
          .getByRole("heading", { name: "Shortcuts", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.getByRole("button", { name: "About", exact: true }).click();
      await page.getByRole("button", { name: "Check for updates" }).waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          window.settingsFixture
            .calls()
            .filter((call) => ["check", "download", "install"].includes(call)),
        ),
        [],
      );
      await page.getByRole("button", { name: "Check for updates" }).click();
      await page.getByRole("button", { name: "Download", exact: true }).click();
      await page.getByRole("button", { name: "Install update", exact: true }).waitFor();
      await page.getByRole("button", { name: "Install update", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.settingsFixture.calls().includes("install")),
        false,
      );
      await page.getByRole("button", { name: "Keep working", exact: true }).click();
      await page.getByRole("button", { name: "Install update", exact: true }).click();
      await page.getByRole("button", { name: "Install and restart", exact: true }).click();
      await page.getByText("Waiting for your work to finish", { exact: true }).waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          window.settingsFixture
            .calls()
            .filter((call) => ["check", "download", "install"].includes(call)),
        ),
        ["check", "download", "install"],
      );
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-update.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Back to workspace" }).waitFor();
      await page.goto(`${url}/?preview=settings&unsigned`);
      await page.getByRole("button", { name: "About", exact: true }).click();
      await page.getByText("Manual installation", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Check for updates" }).count(), 0);
      await checkGitReview(page, url, out, engine);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: settings persistence failures, focus, accessibility and explicit updater actions passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.kill();
}
