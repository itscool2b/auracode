/** Production folder picker with synthetic command responses. No real folders or remotes. */
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
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const origin = "http://127.0.0.1:1466";
const out = resolve(app, "../../target/folder-resolution-browser");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1466", "--strictPort"],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* Wait for the owned server. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const calls = () => page.evaluate(() => window.folderFixture.calls());
      for (const scenario of ["normal", "stale", "refresh"]) {
        await page.goto(`${origin}/scripts/fixtures/folder-resolution.html?case=${scenario}`);
        await page.getByRole("button", { name: "Search for repository" }).waitFor();
        assert.deepEqual(await calls(), ["inspect"]);
        await page.getByRole("button", { name: "Search for repository" }).click();
        await page.getByRole("button", { name: "C:\\Code\\project", exact: true }).click();
        await page.getByRole("button", { name: "Use on this device" }).waitFor();
        assert.deepEqual(await calls(), ["inspect", "search", "review"]);
        await page.getByRole("button", { name: "Use on this device" }).click();
        if (scenario === "stale") {
          await page.getByRole("alert").filter({ hasText: "folder changed" }).waitFor();
          await page.getByRole("button", { name: "Cancel", exact: true }).click();
          await page.getByRole("button", { name: "Locate folder", exact: true }).click();
          await page.getByRole("button", { name: "Use on this device" }).click();
        }
        await page.getByRole("status").filter({ hasText: "Folder location saved" }).waitFor();
        assert.equal((await calls()).filter((call) => call === "located").length, 1);
        if (scenario === "refresh")
          await page.getByRole("alert").filter({ hasText: "location was saved" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Use on this device" }).count(), 0);
      }
      await page.getByRole("button", { name: "Clone this repository" }).click();
      const remote = page.getByRole("textbox", { name: "GitHub repository" });
      assert.equal(await remote.inputValue(), "https://github.com/fixture/project");
      assert.equal(await remote.isDisabled(), true);
      await page.getByRole("button", { name: "Close clone" }).click();
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-folder-resolution.png`) });
      await page.setViewportSize({ width: 390, height: 800 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await page.locator(".chat-modal").evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      await page.screenshot({ path: resolve(out, `${engine}-folder-resolution-mobile.png`) });
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: reviewed mapping, stale review, saved-result refresh failure and locked clone origin passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
