/** Runs only synthetic reviewed workspace metadata controls in both browser engines. */
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
const origin = "http://127.0.0.1:1467";
const out = resolve(app, "../../target/workspace-removal-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1467",
    "--strictPort",
  ],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (part) => {
    output = (output + part).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* Wait for owned preview. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const calls = () => page.evaluate(() => window.workspaceRemovalFixture.calls());
      await page.goto(`${origin}/scripts/fixtures/workspace-removal.html?case=cancel`);
      await page.getByRole("button", { name: "Remove from workspace", exact: true }).waitFor();
      assert.deepEqual(await calls(), ["review:remove"]);
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-review.png`) });
      await page.getByRole("button", { name: "Close", exact: true }).last().click();
      assert.deepEqual(await calls(), ["review:remove"]);
      await page.goto(`${origin}/scripts/fixtures/workspace-removal.html?case=stale`);
      await page.getByRole("button", { name: "Remove from workspace", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Remove from workspace", exact: true }).count(),
        0,
      );
      assert.deepEqual(await calls(), ["review:remove", "apply"]);
      await page.goto(`${origin}/scripts/fixtures/workspace-removal.html?case=restore`);
      const restore = page.getByRole("button", { name: "Review restore", exact: true });
      await restore.first().waitFor();
      assert.equal(await restore.nth(1).isDisabled(), true);
      await restore.first().click();
      assert.deepEqual(await calls(), ["list", "review:restore"]);
      await page.setViewportSize({ width: 390, height: 800 });
      assert.equal(
        await page.locator(".g-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      await page.screenshot({ path: resolve(out, `${engine}-restore-mobile.png`) });
      await page.getByRole("button", { name: "Restore saved item", exact: true }).click();
      await page.getByText("Dialog closed.", { exact: true }).waitFor();
      assert.deepEqual(await calls(), ["list", "review:restore", "apply", "refresh"]);
      console.log(
        `${engine}: review, cancel, one-use stale failure, restore and narrow dialog passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
