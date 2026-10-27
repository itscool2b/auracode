/** Real chat recovery and terminal components, synthetic native IO only. */
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
const origin = "http://127.0.0.1:1471";
const out = resolve(app, "../../target/chat-auth-browser");
const server = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "1471",
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
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      await page.goto(`${origin}/scripts/fixtures/chat-auth.html`);
      const calls = () => page.evaluate(() => window.chatAuthFixture.calls());
      const signIn = page.getByRole("button", { name: "Sign in…", exact: true });
      await signIn.waitFor();
      assert.deepEqual(await calls(), ["maintenance:claude"]);
      assert.equal(
        await page.getByTestId("auth-command").textContent(),
        "vendor-display-only login",
      );
      await page.screenshot({ path: resolve(out, `${engine}-card.png`) });
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await signIn.click();
      const sheet = page.getByRole("dialog", { name: "Sign in to Claude Code" });
      await sheet.waitFor();
      assert.deepEqual(await calls(), ["maintenance:claude"]);
      await page.getByRole("button", { name: "Close sign-in terminal" }).click();
      assert.deepEqual(await calls(), ["maintenance:claude"]);
      await signIn.click();
      await page.getByRole("button", { name: "Start sign-in", exact: true }).click();
      await page.locator('dialog[data-state="finished"]').waitFor();
      assert.equal((await calls()).filter((value) => value === "start:claude").length, 1);
      assert.ok(!(await calls()).includes("retry"));
      assert.ok((await calls()).includes("close"));
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-terminal.png`) });
      await page.getByRole("button", { name: "Close sign-in terminal" }).click();
      await page.getByRole("status").filter({ hasText: "Press Retry to check access" }).waitFor();
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      assert.equal((await calls()).filter((value) => value === "retry").length, 1);

      await page.evaluate(() => window.chatAuthFixture.exitCode(1));
      await signIn.click();
      await page.getByRole("button", { name: "Start sign-in", exact: true }).click();
      await page.locator('dialog[data-state="finished"]').waitFor();
      await page.getByRole("button", { name: "Close sign-in terminal" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Sign-in did not finish successfully" })
        .waitFor();
      assert.equal((await calls()).filter((value) => value === "retry").length, 1);

      await page.getByRole("button", { name: "unsupported", exact: true }).click();
      assert.equal(await signIn.count(), 0);
      assert.equal(await page.getByRole("button", { name: "Copy", exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 1);
      await page.getByRole("button", { name: "failed", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "The sign-in sheet is unavailable" })
        .waitFor();
      assert.equal(await signIn.count(), 0);
      await page.getByRole("button", { name: "delayed", exact: true }).click();
      await page.getByRole("button", { name: "unsupported", exact: true }).click();
      await page.evaluate(() => window.chatAuthFixture.resolveDelayed());
      assert.equal(await signIn.count(), 0);
      assert.equal((await calls()).filter((value) => value.startsWith("start:")).length, 2);

      await page.getByRole("button", { name: "claude", exact: true }).click();
      await signIn.waitFor();
      await page.setViewportSize({ width: 390, height: 760 });
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-narrow.png`) });
      assert.equal(
        await page
          .getByTestId("auth-card")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
      );
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: explicit sign-in, cancellation, success/failure, Retry, unsupported fallback, stale lookup and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
