/** Synthetic command responses exercise production settings without touching native state. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";
import { checkAccount } from "./check-account.mjs";
import { checkAccountPreservation } from "./check-account-preservation.mjs";
import { checkAccountVerification } from "./check-account-verification.mjs";
import { checkConfigSync } from "./check-config-sync.mjs";
import { checkDataTransfer } from "./check-data-transfer.mjs";
import { checkGitReview } from "./check-git-review.mjs";
import { checkNotices } from "./check-notices.mjs";
import { checkProfiles } from "./check-profiles.mjs";
import { checkProjectTools } from "./check-project-tools.mjs";
import { checkQuestions } from "./check-questions.mjs";
import { checkSessionFallback } from "./check-session-fallback.mjs";
import { checkSettingsNavigation } from "./check-settings-navigation.mjs";
import { checkSetupRecovery } from "./check-setup-recovery.mjs";
import { checkSteering } from "./check-steering.mjs";
import { checkWorktreeSetup } from "./check-worktree-setup.mjs";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

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
      await checkSettingsNavigation(page, url);
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
      // General's defaults for new chats and the background switches save at once.
      const general = () => page.evaluate(() => window.settingsFixture.general());
      assert.equal(await page.getByLabel("Default model").count(), 0);
      await page.getByLabel("Default agent").selectOption("codex");
      await page.getByLabel("Default model").selectOption("gpt-5.5-codex");
      await page.getByRole("radio", { name: "Ask", exact: true }).check();
      await page.getByRole("switch", { name: "Notifications" }).uncheck();
      await page.getByRole("switch", { name: "Keep awake" }).uncheck();
      await page.getByRole("switch", { name: "Keep running in the tray" }).uncheck();
      await page.waitForFunction(() => !window.settingsFixture.general().close_to_tray);
      assert.deepEqual(await general(), {
        default_agent: "codex",
        default_model: "gpt-5.5-codex",
        default_autonomy: "ask",
        notifications: false,
        keep_awake: false,
        close_to_tray: false,
        config_sync_paused: [],
      });
      // Another agent clears the model, which belonged to Codex; it has not listed its own.
      await page.getByLabel("Default agent").selectOption("claude");
      await page.getByText("Claude Code lists its models once one of its chats starts.").waitFor();
      assert.equal(await page.getByLabel("Default model").count(), 0);
      assert.equal((await general()).default_model, null);
      await page.getByRole("radio", { name: "Full auto", exact: true }).check();
      for (const name of ["Notifications", "Keep awake", "Keep running in the tray"])
        await page.getByRole("switch", { name }).check();
      await page.waitForFunction(() => window.settingsFixture.general().close_to_tray);
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-general.png`) });
      await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
      // Settings moves focus to the new heading in the next animation frame. Wait for the heading
      // itself: in Chromium the clicked "Shortcuts" button holds focus until then.
      await page.waitForFunction(
        () =>
          /^H[1-6]$/.test(document.activeElement?.tagName ?? "") &&
          document.activeElement?.textContent === "Shortcuts",
        null,
        { timeout: 5000 },
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Shortcuts", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await settled(page);
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
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({ path: resolve(out, `${engine}-update.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("heading", { name: "Back to workspace" }).waitFor();
      await page.goto(`${url}/?preview=settings&unsigned`);
      await page.getByRole("button", { name: "About", exact: true }).click();
      await page.getByText("Manual installation", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Check for updates" }).count(), 0);
      await page.goto(`${url}/?preview=settings&staging`);
      await page.getByRole("button", { name: "About", exact: true }).click();
      await page
        .getByText("Staging build. Updates are restricted to release qualification builds.", {
          exact: true,
        })
        .waitFor();
      await checkNotices(page, out, engine);
      await checkGitReview(page, url, out, engine);
      await checkProjectTools(page, url, out, engine);
      await checkDataTransfer(page, url, out, engine);
      await checkAccountPreservation(page, url, out, engine);
      await checkAccountVerification(browser, url, out, engine);
      await checkAccount(browser, url, out, engine);
      await checkProfiles(browser, url, out, engine);
      await checkWorktreeSetup(browser, url, out, engine);
      await checkSetupRecovery(browser, url);
      await checkConfigSync(browser, url, out, engine);
      await checkSteering(browser, url, out, engine);
      await checkQuestions(browser, url, out, engine);
      await checkSessionFallback(browser, url, out, engine);
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
