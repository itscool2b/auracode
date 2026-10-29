/** Explicit installer review and cancellation using the production terminal and synthetic IPC. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

// Dialogs fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

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
      // The sheet's buttons settle their colours once the terminal is ready; audit that state.
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => !(animation instanceof CSSTransition)),
      );
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
      // Clone: the form shows Rust's exact command before anything runs; Clone starts it, Cancel
      // stops it and removes the unfinished folder, and a failure keeps Git's own last lines.
      const command =
        "git clone --progress -- https://github.com/auracode/orbit C:\\Users\\fixture\\code\\orbit";
      const cloneForm = async (query = "") => {
        await page.goto(`${url}${query}`);
        assert.deepEqual(await calls(), []);
        await page.getByRole("button", { name: "Clone a repository", exact: true }).click();
        assert.deepEqual(await calls(), [], "Opening clone never starts native work");
        await page
          .getByRole("textbox", { name: "Repository" })
          .fill("https://github.com/auracode/orbit");
        await page.getByRole("button", { name: "Choose a folder" }).click();
      };
      const started = async () => (await calls()).filter((call) => call === "clone-start").length;
      await cloneForm();
      await page.getByText(command, { exact: true }).waitFor();
      assert.equal(await started(), 0, "Showing the command runs nothing");
      assert.equal(await page.getByRole("textbox", { name: "Folder name" }).inputValue(), "orbit");
      await settled(page);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} clone form accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-clone-form.png`) });
      // A refused address says why under its field, and Clone waits.
      await page.getByRole("textbox", { name: "Repository" }).fill("http://github.com/o/r");
      await page
        .getByText("Plain http:// sends the repository unencrypted.", { exact: false })
        .waitFor();
      assert.equal(
        await page.getByRole("textbox", { name: "Repository" }).getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(
        await page.getByRole("button", { name: "Clone", exact: true }).isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "Close clone", exact: true }).click();
      assert.equal(await started(), 0);
      assert.ok((await calls()).includes("clone-cancel-review"), "Closing releases the review");
      // Start, then cancel.
      await cloneForm();
      await page.getByText(command, { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await page.getByRole("progressbar", { name: "Clone progress" }).waitFor();
      await page.getByText("7.36 MiB received").waitFor();
      await settled(page);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} cloning accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-cloning.png`) });
      await page.getByRole("button", { name: "Cancel clone" }).click();
      await page
        .getByText("Clone canceled. The unfinished folder was removed.", { exact: true })
        .waitFor();
      assert.equal(await started(), 1);
      // A finished clone hands its folder over once.
      await cloneForm("?ready");
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await page.waitForFunction(() =>
        window.setupActionsFixture.calls().includes("clone-use-folder"),
      );
      // The dialog closes with the folder.
      await page.waitForFunction(() => document.querySelector("dialog") === null);
      // A failure keeps Git's lines; Try again starts a fresh review.
      await cloneForm("?error");
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Git could not find this repository" })
        .waitFor();
      await page.getByText("remote: Repository not found.", { exact: false }).waitFor();
      await settled(page);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} clone failure accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-clone-error.png`) });
      await page.getByRole("button", { name: "Try again" }).click();
      await page.waitForFunction(
        () =>
          window.setupActionsFixture.calls().filter((call) => call === "clone-start").length === 2,
      );
      // A taken folder name is refused beside the name, before anything runs.
      await cloneForm("?existing");
      await page.getByText("already has a orbit folder", { exact: false }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Clone", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await started(), 0);
      assert.deepEqual(errors, []);
      // Recovery is record-only: no clone starts, reuse revalidates, retry needs a new folder.
      await page.goto(`${url}?recovery`);
      await page.getByRole("button", { name: "Clone a repository", exact: true }).click();
      await page.getByRole("region", { name: "Interrupted clones" }).waitFor();
      await settled(page);
      assert.equal(
        await page.locator("dialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
        true,
        `${engine} recovery actions fit the dialog`,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
        `${engine} clone recovery accessibility`,
      );
      await page.screenshot({ path: resolve(out, `${engine}-clone-recovery.png`) });
      await page.getByRole("button", { name: "Open folder", exact: true }).click();
      await page.waitForFunction(() =>
        window.setupActionsFixture.calls().includes("clone-recovery-open"),
      );
      await page.getByRole("button", { name: "Retry in another folder" }).click();
      await page.getByRole("button", { name: "Choose a folder", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Clone", exact: true }).isDisabled(),
        true,
      );
      assert.equal(await started(), 0);
      await page.getByRole("button", { name: "Dismiss notice" }).click();
      await page.getByRole("region", { name: "Interrupted clones" }).waitFor({ state: "detached" });
      assert.ok((await calls()).includes("clone-recovery-dismiss"));
      assert.equal(await started(), 0);
      assert.ok(!(await calls()).includes("clone-cancel"));
      await page.goto(`${url}?recovery`);
      await page.getByRole("button", { name: "Clone a repository", exact: true }).click();
      await page.getByRole("button", { name: "Add existing project" }).click();
      await page.waitForFunction(() =>
        window.setupActionsFixture.calls().includes("clone-use-folder"),
      );
      assert.ok((await calls()).includes("clone-recovery-validate"));
      assert.equal(await started(), 0);
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: install review/cancel, clone command before start, refused address, cancel, finish, failure, retry, taken name, interrupted clone actions and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
