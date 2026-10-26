/** Real browser checks against development-only protocol fixtures. No agent processes or prompts. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

const { values } = parseArgs({
  options: { server: { type: "string" }, engines: { type: "string", default: "chromium,webkit" } },
});
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "../../target/orbit-browser");
const url = values.server ?? "http://127.0.0.1:1457";
const require = createRequire(import.meta.url);
let server;
let serverOutput = "";
await mkdir(out, { recursive: true });

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverOutput);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Startup has not bound its port yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview did not start: ${serverOutput}`);
}

async function inspect(engine, launcher) {
  const browser = await launcher.launch({ headless: true });
  const errors = [];
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      window.__orbitFrames = 0;
      const request = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) =>
        request((time) => {
          window.__orbitFrames++;
          callback(time);
        });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const mode of [
        "new",
        "settled",
        "thinking",
        "permission",
        "error",
        "recorded-thinking",
        "recorded-tools",
      ]) {
        await page.goto(`${url}/?preview=${mode}`);
        await page
          .locator(mode === "new" ? '[data-testid="new-chat"]' : '[data-test-phase="live"]')
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Finish finite control transitions before testing text contrast or taking screenshots.
        await page.waitForTimeout(300);
        assert.equal(
          await page.locator("canvas").count(),
          0,
          `${engine}/${theme}/${mode}: GPU canvas`,
        );
        assert.equal(
          await page.evaluate(() => document.body.scrollWidth > innerWidth),
          false,
          `${mode}: horizontal page overflow`,
        );
        assert.equal(
          await page.locator(".chat-app").getAttribute("data-theme"),
          theme,
          "system theme was not applied",
        );
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const violations = scan.violations.map((violation) => ({
          rule: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            reason: node.failureSummary,
          })),
        }));
        results.push({ theme, mode, violations });
        await page.screenshot({ path: resolve(out, `${engine}-${theme}-${mode}.png`) });
        if (mode === "recorded-thinking") {
          await page.locator(".chat-thought summary").click();
          assert.match(
            (await page.locator(".chat-thought").textContent()) ?? "",
            /did not share its reasoning/,
          );
        }
        if (mode === "settled") {
          const tool = page.locator('[data-test-kind="tool"] details').first();
          assert.equal(await tool.getAttribute("open"), null);
          await tool.locator("summary").focus();
          await page.keyboard.press("Enter");
          assert.notEqual(
            await tool.getAttribute("open"),
            null,
            "keyboard disclosure did not open",
          );
          await page.getByTestId("composer-input").fill("A browser-only verification message");
          await page.getByTestId("composer-input").press("Enter");
          await page
            .getByText("This is a local UI preview. No prompt was sent to an agent.", {
              exact: true,
            })
            .waitFor();
        }
        // Reduced motion and settled views must consume no continuous animation frames.
        await page.waitForTimeout(100);
        await page.evaluate(() => {
          window.__orbitFrames = 0;
        });
        await page.waitForTimeout(250);
        assert.equal(
          await page.evaluate(() => window.__orbitFrames),
          0,
          `${mode}: frames under reduced motion`,
        );
      }
    }

    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.goto(`${url}/?preview=thinking`);
    await page.locator('[data-test-phase="live"]').waitFor();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => window.__orbitFrames > 0), "active marks never animate");
    await page.locator('.o-mark[data-state="thinking"]').evaluateAll((nodes) => {
      for (const node of nodes) node.style.display = "none";
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__orbitFrames),
      0,
      "offscreen marks still animate",
    );
    await page.locator('.o-mark[data-state="thinking"]').evaluateAll((nodes) => {
      for (const node of nodes) node.style.removeProperty("display");
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.__orbitFrames = 0;
    });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.__orbitFrames),
      0,
      "hidden document still animates",
    );

    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto(`${url}/?preview=permission`);
    await page.locator('[data-test-phase="live"]').waitFor();
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth > innerWidth),
      false,
      "minimum window overflows",
    );
    await page.screenshot({ path: resolve(out, `${engine}-minimum-window.png`) });
    assert.deepEqual(errors, [], "browser errors");
    await writeFile(
      resolve(out, `${engine}-accessibility.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    const failures = results.filter((result) => result.violations.length > 0);
    assert.deepEqual(failures, [], `${engine} accessibility violations`);
    console.log(
      `${engine}: 14 theme/state accessibility scans, recorded transcripts, keyboard disclosure/send, no GPU, reduced/offscreen/hidden motion and minimum window passed`,
    );
  } finally {
    await browser.close();
  }
}

try {
  if (!values.server) {
    const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    server = spawn(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", "1457", "--strictPort"],
      { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        serverOutput = (serverOutput + data).slice(-8192);
      });
  }
  await ready();
  for (const engine of values.engines.split(",")) {
    const launcher = { chromium, webkit }[engine];
    assert.ok(launcher, `Unsupported engine: ${engine}`);
    await inspect(engine, launcher);
  }
} finally {
  server?.kill();
}
