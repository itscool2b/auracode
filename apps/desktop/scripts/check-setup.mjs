/** Real browser checks of the production setup UI with synthetic Rust command responses. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/setup-browser");
const url = "http://127.0.0.1:1463";
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1463", "--strictPort"],
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
      /* Wait for the owned preview server. */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, output);
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?preview=setup`);
      await page.getByRole("button", { name: "Get started" }).waitFor();
      await page.waitForFunction(() => !document.querySelector("[data-cinematic]"));
      await page.screenshot({ path: resolve(out, `${engine}-welcome.png`) });
      const checkMapLabels = async () => {
        const boxes = await page.locator(".setup-night").evaluate((panel) => {
          const bounds = panel.getBoundingClientRect();
          return [...panel.querySelectorAll(".o-globe-label")].map((label) => {
            const box = label.getBoundingClientRect();
            return {
              left: box.left - bounds.left,
              top: box.top - bounds.top,
              right: box.right - bounds.left,
              bottom: box.bottom - bounds.top,
              width: bounds.width,
              height: bounds.height,
              text: label.textContent,
            };
          });
        });
        assert.equal(boxes.length, 9);
        for (const [index, box] of boxes.entries()) {
          assert.ok(
            box.left >= 8 &&
              box.top >= 8 &&
              box.right <= box.width - 8 &&
              box.bottom <= box.height - 8,
            `${engine}: clipped ${box.text}`,
          );
          for (const other of boxes.slice(index + 1))
            assert.ok(
              box.right + 4 <= other.left ||
                other.right + 4 <= box.left ||
                box.bottom + 4 <= other.top ||
                other.bottom + 4 <= box.top,
              `${engine}: overlapping ${box.text} / ${other.text}`,
            );
        }
      };
      await checkMapLabels();
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForFunction(
        () =>
          Number(document.querySelector(".setup-night svg")?.getAttribute("width")) ===
          document.querySelector(".setup-night")?.clientWidth,
      );
      await checkMapLabels();
      await page.screenshot({ path: resolve(out, `${engine}-compact-map.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
      const assertNoVendorCalls = async () =>
        assert.deepEqual(
          await page.evaluate(() =>
            window.setupFixture
              .methods()
              .filter((name) =>
                ["agentAuthStatus", "agentUpdate", "chatCreate", "send", "start"].includes(name),
              ),
          ),
          [],
        );
      await assertNoVendorCalls();
      // The newly announced heading is focused. Enter advances without stealing input/form keys.
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Your agents, together." }).waitFor();
      await page.getByRole("button", { name: /Claude Code.*Installed/ }).click();
      await assertNoVendorCalls();
      await page.screenshot({ path: resolve(out, `${engine}-discovery.png`) });
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} discovery accessibility`,
      );
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Open Account", exact: true }).click();
      await page.getByRole("heading", { name: "Account settings" }).waitFor();
      await assertNoVendorCalls();
      await page.getByRole("button", { name: "Back to setup" }).click();
      await page.getByRole("button", { name: "Open Account", exact: true }).waitFor();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("radio", { name: /Off/ }).check();
      await page.waitForFunction(() => document.documentElement.dataset.motion === "off");
      await page.reload();
      await page.getByRole("heading", { name: "Set your pace." }).waitFor();
      await page.waitForFunction(() => !document.querySelector("[data-cinematic]"));
      assert.equal(await page.getByRole("radio", { name: /Off/ }).isChecked(), true);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: /Choose a folder/ }).click();
      await page.getByRole("textbox", { name: "Project name" }).fill("A quiet project");
      await page.evaluate(() => sessionStorage.setItem("fail-setup", "yes"));
      await page.getByRole("button", { name: "Add project", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.evaluate(() => window.setupFixture.projects()), 1);
      await page.evaluate(() => sessionStorage.removeItem("fail-setup"));
      await page.getByRole("button", { name: "Save selection", exact: true }).click();
      await page.getByText("A quiet project is ready.", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.setupFixture.projects()),
        1,
        "Retry duplicated the project",
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} project accessibility`,
      );
      await page.getByRole("button", { name: "Open auracode", exact: true }).click();
      await page.getByRole("heading", { name: "Workspace ready" }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Workspace ready" }).waitFor();
      await page.getByRole("button", { name: "Agents", exact: true }).click();
      await page.getByRole("button", { name: "Run setup again" }).click();
      await page.getByRole("button", { name: "Get started" }).waitFor();
      await page.getByRole("button", { name: "Skip setup", exact: true }).click();
      await page.getByRole("heading", { name: "Workspace ready" }).waitFor();
      const empty = await context.newPage();
      await empty.goto(`${url}/?preview=setup&missing`);
      await empty.getByRole("button", { name: "Get started" }).click();
      await empty.getByRole("button", { name: /Explore the local demo/ }).click();
      await empty.getByRole("heading", { name: "Local demo" }).waitFor();
      const small = await context.newPage();
      await small.setViewportSize({ width: 720, height: 600 });
      await small.goto(`${url}/?preview=setup`);
      await small.getByRole("button", { name: "Get started" }).waitFor();
      assert.equal(await small.evaluate(() => document.body.scrollWidth > innerWidth), false);
      await small.screenshot({ path: resolve(out, `${engine}-small.png`) });
      const intro = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "no-preference",
      });
      const introPage = await intro.newPage();
      await introPage.goto(`${url}/?preview=setup`);
      await introPage.getByRole("button", { name: "Skip intro" }).waitFor();
      await introPage.keyboard.press("Escape");
      await introPage.waitForFunction(() => !document.querySelector("[data-cinematic]"));
      await introPage.getByRole("button", { name: "Skip setup", exact: true }).click();
      await introPage.getByRole("heading", { name: "Workspace ready" }).waitFor();
      await introPage.reload();
      await introPage.getByRole("heading", { name: "Workspace ready" }).waitFor({ timeout: 1500 });
      await intro.close();
      assert.deepEqual(errors, [], `${engine} page errors`);
      console.log(
        `${engine}: setup persistence, restart/skip, storage retry without duplicate project, motion, local demo, passive detection and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
