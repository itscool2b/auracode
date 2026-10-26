/** Real selection component, synthetic commands only. */
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
const origin = "http://127.0.0.1:1468";
const images = resolve(app, "../../target/agent-installations-browser");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1468", "--strictPort"],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-8192);
  });
try {
  await mkdir(images, { recursive: true });
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
      const context = await browser.newContext({ viewport: { width: 1000, height: 850 } });
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const calls = () => page.evaluate(() => window.installationFixture.calls());
      for (const scenario of ["normal", "stale", "missing"]) {
        await page.goto(`${origin}/scripts/fixtures/agent-installations.html?case=${scenario}`);
        await page.getByRole("button", { name: "Choose executable" }).waitFor();
        assert.deepEqual(await calls(), []);
        await page.getByRole("button", { name: "Choose executable" }).click();
        await page.getByRole("radio").nth(2).waitFor();
        assert.deepEqual(await calls(), ["list"]);
        assert.equal(await page.getByRole("radio").nth(2).isDisabled(), true);
        if (scenario === "missing") {
          assert.equal(await page.getByRole("radio").nth(1).isDisabled(), true);
          assert.equal(
            await page.getByRole("button", { name: "Use this executable" }).isDisabled(),
            true,
          );
        } else {
          await page.getByRole("radio").nth(1).check();
          assert.deepEqual(await calls(), ["list"]);
          await page.getByRole("button", { name: "Use this executable" }).click();
          if (scenario === "stale") {
            await page.getByRole("alert").filter({ hasText: "disappeared" }).waitFor();
            assert.equal((await calls()).includes("changed"), false);
            await page.getByRole("button", { name: "Check again" }).click();
            await page.getByRole("radio").nth(1).check();
            await page.getByRole("button", { name: "Use this executable" }).click();
          }
          await page.getByRole("status").filter({ hasText: "choice saved" }).waitFor();
          assert.equal((await calls()).filter((call) => call === "changed").length, 1);
        }
        await page.getByRole("button", { name: "Use environment default" }).click();
        await page.getByText("Using the environment override, then PATH order.").waitFor();
        assert.equal(await page.getByRole("radio").nth(0).isChecked(), true);
      }
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(images, `${engine}-installations.png`) });
      await page.setViewportSize({ width: 390, height: 800 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(images, `${engine}-installations-mobile.png`) });
      console.log(
        `${engine}: explicit executable selection, broken/missing choices, stale retry and default reset passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
