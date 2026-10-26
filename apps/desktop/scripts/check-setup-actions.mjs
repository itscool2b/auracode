/** Explicit installer review and cancellation using the production terminal and synthetic IPC. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/setup-actions-browser");
const url = "http://127.0.0.1:1467/setup-actions.html";
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1467", "--strictPort"],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    output = (output + data).slice(-8192);
  });
try {
  await mkdir(out, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(url)).ok;
    } catch {
      /* Owned fixture server starting. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      const calls = () => page.evaluate(() => window.setupActionsFixture.calls());
      assert.deepEqual(await calls(), []);
      await page.getByRole("button", { name: "Review installation" }).click();
      const start = page.getByRole("button", { name: "Start installation" });
      await start.waitFor();
      await page.waitForFunction(
        () => !document.querySelector(".terminal-sheet__button--primary")?.disabled,
      );
      assert.deepEqual(
        await calls(),
        ["review"],
        "Opening review cannot reserve or start a process",
      );
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} review accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-install-review.png`) });
      await page.getByRole("button", { name: "Close installation terminal" }).click();
      assert.deepEqual(await calls(), ["review", "refresh"]);
      await page.getByRole("button", { name: "Review installation" }).click();
      await page.getByRole("button", { name: "Start installation" }).click();
      await page.waitForFunction(() => window.setupActionsFixture.calls().includes("start"));
      await page.getByRole("button", { name: "Close installation terminal" }).click();
      await page.waitForFunction(() => window.setupActionsFixture.calls().includes("close"));
      assert.equal((await calls()).filter((call) => call === "start").length, 1);
      await page.goto(`${url}?stale`);
      await page.getByRole("button", { name: "Review installation" }).click();
      await page.getByRole("button", { name: "Start installation" }).click();
      await page
        .getByText("The installer changed. Review the installation again.", { exact: true })
        .waitFor();
      assert.deepEqual(await calls(), ["review", "reserve", "start", "close"]);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: passive mount/review, explicit start, close cancellation, stale review rejection and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
