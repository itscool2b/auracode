/**
 * Added agent accounts (docs/agent-accounts.md) in the production components, on synthetic
 * commands only: the Accounts section of Claude Code's details, Add account with its token sheet
 * and checks, Remove, the account choice, and a chat's usage-limit card, in Chromium and WebKit,
 * light and dark. No native call is made and no real token exists here.
 */
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
const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
const origin = "http://127.0.0.1:1479";
const images = resolve(app, "../../target/accounts-browser");
const server = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "1479", "--strictPort"],
  { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    output = (output + chunk).slice(-8192);
  });

const axe = async (page) => {
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`),
    [],
  );
};

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
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: 1000, height: 900 },
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.route("**/*", (route) =>
          new URL(route.request().url()).hostname === "127.0.0.1"
            ? route.continue()
            : route.abort(),
        );
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const calls = () => page.evaluate(() => window.accountsFixture.calls());
        const shot = (name) =>
          page.screenshot({ path: resolve(images, `${engine}-${theme}-${name}.png`) });

        // A chat at its limit continues on another account: the switch names the chat and account.
        await page.goto(`${origin}/?preview=accounts`);
        const card = page.getByTestId("usage-limit-card");
        await card.getByRole("button", { name: "Continue with Work" }).waitFor();
        assert.match(
          await card.getByTestId("usage-limit-message").textContent(),
          /hit your 5-hour limit/,
        );
        assert.equal(await card.getByText("Resets at").count(), 0, "the agent's words say it");
        await axe(page);
        await shot("accounts");
        await card.getByRole("button", { name: "Continue with Work" }).click();
        await page.waitForFunction(() => window.accountsFixture.switched() === "fixture-1");
        assert.ok((await calls()).includes("switch:chat-limited:claude:fixture-1"));

        // Add account: the steps, the token sheet, a refused API key, then a token a terminal
        // copy broke over two lines.
        await page.goto(`${origin}/?preview=accounts`);
        const section = page.getByTestId("agent-accounts");
        await section.getByRole("button", { name: "Add account", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add a Claude Code account" });
        await dialog.waitFor();
        assert.equal(await dialog.getByRole("listitem").count(), 3);
        await axe(page);
        await shot("add");
        await dialog.getByRole("button", { name: "Get a token…" }).click();
        const sheet = page.getByRole("dialog", { name: "Get a Claude Code token" });
        await sheet.getByRole("button", { name: "Get token" }).click();
        await sheet
          .getByText("Copy the token above, then paste it into Add account.", { exact: true })
          .waitFor();
        assert.ok((await calls()).includes("token:start:claude"));
        await sheet.getByRole("button", { name: "Close token terminal" }).click();
        await sheet.waitFor({ state: "detached" });
        await dialog
          .getByText("Copy the token from the terminal, close it, and paste the token here.")
          .waitFor();
        await dialog.getByLabel("Name").fill("Personal");
        const token = dialog.getByLabel("Token");
        assert.equal(await token.getAttribute("type"), "password");
        await token.fill("sk-ant-api03-a-fixture-api-key-not-a-setup-token-0123456789");
        await dialog.getByRole("button", { name: "Add account" }).click();
        await dialog.getByRole("alert").filter({ hasText: "sk-ant-oat" }).waitFor();
        const fixtureToken = await page.evaluate(() => window.accountsFixture.token);
        await token.fill(`${fixtureToken.slice(0, 50)}\n${fixtureToken.slice(50)}`);
        await dialog.getByRole("button", { name: "Add account" }).click();
        await dialog.waitFor({ state: "detached" });
        await section.getByText("Added Personal.", { exact: false }).waitFor();
        assert.deepEqual(await section.locator(".agent-account-name").allInnerTexts(), [
          "Work",
          "Personal",
        ]);
        assert.ok(
          (await calls()).includes(`add:claude:Personal:${fixtureToken.length}`),
          "the line break a copy carried is gone",
        );

        // The account choice, then Remove with its confirmation.
        await section
          .getByLabel("Claude Code account", { exact: true })
          .selectOption({ label: "Personal" });
        await section.getByText("New Claude Code starts sign in as Personal.").waitFor();
        assert.ok((await calls()).includes("use:claude:fixture-2"));
        assert.match(await section.locator(".agent-account").nth(1).textContent(), /In use/);
        await section.getByRole("button", { name: "Remove Work" }).click();
        await section.getByRole("button", { name: "Keep" }).waitFor();
        await axe(page);
        await section.getByRole("button", { name: "Remove Work" }).click();
        await section.getByText("Removed Work and its token.").waitFor();
        assert.deepEqual(await section.locator(".agent-account-name").allInnerTexts(), [
          "Personal",
        ]);

        // Without secure storage nothing can be added, and the card says to wait for the reset.
        await page.goto(`${origin}/?preview=accounts&accounts=unavailable`);
        const unavailable = page.getByTestId("agent-accounts");
        await unavailable.getByText("no secure storage", { exact: false }).waitFor();
        assert.equal(
          await unavailable.getByRole("button", { name: "Add account", exact: true }).isDisabled(),
          true,
        );
        await page
          .getByTestId("usage-limit-card")
          .getByText("Send it again once the limit resets.", { exact: false })
          .waitFor();
        assert.equal(await page.getByRole("button", { name: /^Continue with/ }).count(), 0);
        await axe(page);

        // The Agents page shows Claude Code's accounts in its details.
        await page.goto(`${origin}/?preview=agents`);
        await page
          .getByRole("button", { name: /Claude Code/ })
          .first()
          .click();
        await page.getByLabel("Claude Code account", { exact: true }).waitFor();
        await page
          .getByRole("list", { name: "Added Claude Code accounts" })
          .getByText("Work", { exact: true })
          .waitFor();
        await shot("agents");

        assert.deepEqual(errors, []);
        await context.close();
      }
      console.log(
        `${engine}: added accounts, the token sheet, the choice and the limit card passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
