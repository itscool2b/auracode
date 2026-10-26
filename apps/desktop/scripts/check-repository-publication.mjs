/** Real browser, production component, synthetic native responses. No remote request. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const origin = "http://127.0.0.1:1467";
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1467", "--strictPort"],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-8192);
  });
try {
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
      const calls = () => page.evaluate(() => window.publicationFixture.calls());
      for (const scenario of ["normal", "uncertain", "reopen", "refresh"]) {
        await page.goto(`${origin}/scripts/fixtures/repository-publication.html?case=${scenario}`);
        await page.getByRole("button", { name: "Publish to GitHub" }).waitFor();
        assert.deepEqual(await calls(), []);
        await page.getByRole("button", { name: "Publish to GitHub" }).click();
        await page.getByRole("textbox", { name: "Repository name" }).waitFor();
        if (scenario === "reopen") {
          assert.equal(
            await page.getByRole("textbox", { name: "Repository name" }).inputValue(),
            "project",
          );
          assert.equal(
            await page.getByRole("textbox", { name: "Repository name" }).isDisabled(),
            true,
          );
        } else await page.getByRole("textbox", { name: "Repository name" }).fill("project");
        assert.deepEqual(await calls(), ["local-draft"]);
        await page
          .getByRole("button", {
            name: scenario === "reopen" ? "Review saved publication" : "Review publication",
            exact: true,
          })
          .click();
        const confirm = page.getByRole("button", {
          name: scenario === "reopen" ? "Finish reviewed publication" : "Create private repository",
        });
        await confirm.waitFor();
        assert.deepEqual(await calls(), ["local-draft", "remote-review"]);
        await confirm.click();
        if (scenario === "uncertain") {
          await page.getByRole("status").filter({ hasText: "did not confirm" }).waitFor();
          assert.equal((await calls()).filter((call) => call === "remote-apply").length, 1);
          await page.getByRole("button", { name: "Review saved publication" }).click();
          await page.getByRole("button", { name: "Finish reviewed publication" }).click();
        }
        await page
          .getByRole("status")
          .filter({ hasText: "private repository is published" })
          .waitFor();
        assert.equal((await calls()).filter((call) => call === "published").length, 1);
        assert.equal(
          await page.getByRole("button", { name: "Review publication", exact: true }).count(),
          0,
        );
        if (scenario === "refresh")
          await page.getByRole("alert").filter({ hasText: "repository is published" }).waitFor();
      }
      assert.deepEqual(errors, []);
      console.log(
        `${engine}: explicit review, private confirmation, uncertain recovery and reopened journal passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
