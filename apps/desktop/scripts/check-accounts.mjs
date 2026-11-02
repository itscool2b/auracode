/**
 * Added agent accounts (docs/agent-accounts.md) in the production components, on synthetic
 * commands only: the composer's account picker, Add account with its automatic token pick-up and
 * paste fallback, the Accounts list in Claude Code's details with Use and Remove, and a chat's
 * usage-limit card, in Chromium and WebKit, light and dark. No native call is made and no real token exists here.
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

        // The composer's account picker: the main account and Work, a switch restarts the chat on
        // the chosen one, and a running turn keeps its account until it ends.
        await page.goto(`${origin}/?preview=accounts`);
        const idle = page.getByTestId("composer-idle");
        await idle.getByLabel("Account: Main account").click();
        const work = idle.getByRole("button", { name: /^Work/ });
        await work.waitFor();
        assert.equal(
          await idle.getByRole("button", { name: /^Main account/ }).getAttribute("aria-pressed"),
          "true",
        );
        // Each account's usage as it last reported it: one line in the composer, meters on the page.
        await idle.getByText("5 hours 42% · 7 days 81%").waitFor();
        await idle.getByText("5 hours 100% · 7 days 18%").waitFor();
        const page_ = page.getByTestId("agent-accounts");
        assert.equal(await page_.getByTestId("account-usage").count(), 2);
        await page_.getByText("As of 5 min ago").waitFor();
        assert.equal(await page_.locator(".account-usage-window[data-full]").count(), 1);
        await axe(page);
        await shot("composer");
        await work.click();
        await page.waitForFunction(() =>
          window.accountsFixture.calls().includes("switch:chat-idle:claude:fixture-1"),
        );
        const running = page.getByTestId("composer-running");
        await running.getByLabel(/^Account: /).click();
        await running.getByText("Switch after this turn finishes", { exact: false }).waitFor();
        for (const row of await running.getByTestId("picker-account-choice").all())
          assert.equal(await row.isDisabled(), true, "a running turn is never cut short");
        await page.keyboard.press("Escape");

        // Add account from the composer: one Sign in, the token picked up off the terminal, and
        // the chat moves to the new account. Nothing is pasted.
        await page.goto(`${origin}/?preview=accounts`);
        await idle.getByLabel(/^Account: /).click();
        await idle.getByRole("button", { name: "Add account" }).click();
        const dialog = page.getByRole("dialog", { name: "Add a Claude Code account" });
        await dialog.waitFor();
        assert.equal(await dialog.getByLabel("Name").inputValue(), "Account 3");
        await axe(page);
        await shot("add");
        await dialog.getByRole("button", { name: "Sign in…" }).click();
        await dialog.waitFor({ state: "detached" });
        const fixtureToken = await page.evaluate(() => window.accountsFixture.token);
        await page.waitForFunction(() =>
          window.accountsFixture.calls().includes("switch:chat-idle:claude:fixture-2"),
        );
        const added = await calls();
        assert.ok(added.includes("token:start:claude"), "Sign in starts the token command");
        assert.ok(
          added.includes(`add:claude:Account 3:${fixtureToken.length}`),
          "the wrapped token was read whole",
        );

        // A browser that shows a code: it is pasted into the terminal, and Continue is its Enter.
        await page.goto(`${origin}/?preview=accounts&accounts=code`);
        await page
          .getByTestId("agent-accounts")
          .getByRole("button", { name: "Add account", exact: true })
          .click();
        await dialog.waitFor();
        await dialog.getByRole("button", { name: "Sign in…" }).click();
        const codeSheet = page.getByRole("dialog", {
          name: "Sign in to another Claude Code account",
        });
        await codeSheet.getByText("paste it below and choose Continue", { exact: false }).waitFor();
        await codeSheet.getByRole("button", { name: "Continue" }).click();
        await dialog.waitFor({ state: "detached" });
        assert.ok((await calls()).includes("token:enter"), "Continue sends Enter to the terminal");
        assert.ok((await calls()).some((call) => call.startsWith("add:claude:Account 3:")));

        // When the token is not picked up, the paste field opens: an API key is refused, and a
        // token a terminal copy broke over two lines is accepted.
        await page.goto(`${origin}/?preview=accounts&accounts=nocapture`);
        const section = page.getByTestId("agent-accounts");
        await section.getByRole("button", { name: "Add account", exact: true }).click();
        await dialog.waitFor();
        await dialog.getByLabel("Name").fill("Personal");
        await dialog.getByRole("button", { name: "Sign in…" }).click();
        const sheet = page.getByRole("dialog", { name: "Sign in to another Claude Code account" });
        await sheet.getByText("did not show up", { exact: false }).waitFor();
        await sheet.getByRole("button", { name: "Close token terminal" }).click();
        await sheet.waitFor({ state: "detached" });
        await dialog.getByText("its token was not picked up", { exact: false }).waitFor();
        const token = dialog.getByLabel("Token");
        assert.equal(await token.getAttribute("type"), "password");
        await token.fill("sk-ant-api03-a-fixture-api-key-not-a-setup-token-0123456789");
        await dialog.getByRole("button", { name: "Add with this token" }).click();
        await dialog.getByRole("alert").filter({ hasText: "sk-ant-oat" }).waitFor();
        await token.fill(`${fixtureToken.slice(0, 50)}\n${fixtureToken.slice(50)}`);
        await dialog.getByRole("button", { name: "Add with this token" }).click();
        await dialog.waitFor({ state: "detached" });
        await section.getByText("Added Personal.", { exact: false }).waitFor();
        assert.deepEqual(await section.locator(".agent-account-name").allInnerTexts(), [
          "Main account",
          "Work",
          "Personal",
        ]);
        assert.ok(
          (await calls()).includes(`add:claude:Personal:${fixtureToken.length}`),
          "the line break a copy carried is gone",
        );

        // Use for new chats, then Remove with its confirmation.
        await section.getByRole("button", { name: "Use Personal for new chats" }).click();
        await section
          .getByText("New Claude Code chats start on Personal.", { exact: false })
          .waitFor();
        assert.ok((await calls()).includes("use:claude:fixture-2"));
        assert.match(
          await section.locator(".agent-account").nth(2).textContent(),
          /Used by new chats/,
        );
        await section.getByRole("button", { name: "Remove Work" }).click();
        await section.getByRole("button", { name: "Keep" }).waitFor();
        await axe(page);
        await section.getByRole("button", { name: "Remove Work" }).click();
        await section.getByText("Removed Work and its token.").waitFor();
        assert.deepEqual(await section.locator(".agent-account-name").allInnerTexts(), [
          "Main account",
          "Personal",
        ]);

        // Without secure storage nothing can be added, the composer shows no picker, and the
        // card says to wait for the reset.
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
        assert.equal(await page.getByLabel(/^Account: /).count(), 0);
        await axe(page);

        // The Agents page shows Claude Code's accounts in its details.
        await page.goto(`${origin}/?preview=agents`);
        await page
          .getByRole("button", { name: /Claude Code/ })
          .first()
          .click();
        await page
          .getByRole("list", { name: "Claude Code accounts" })
          .getByText("Work", { exact: true })
          .waitFor();
        await shot("agents");

        assert.deepEqual(errors, []);
        await context.close();
      }
      console.log(
        `${engine}: the account picker, Add account, the Accounts list and the limit card passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
