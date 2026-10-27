// Harmless UI fixtures. The actual Rust API is tested separately against D1/R2 in apps/api/tests.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "playwright";

// Graphite settles a control's colours over 300ms when its state changes; audit the settled page.
const settled = (page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => !(animation instanceof CSSTransition)),
  );

const root = resolve(fileURLToPath(new URL("../build/client/", import.meta.url)));
const headerText = await readFile(join(root, "_headers"), "utf8");
const csp = headerText.match(/Content-Security-Policy: ([^\n]+)/)[1];
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};
const server = createServer(async (request, response) => {
  try {
    let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!extname(path)) path += "/index.html";
    const target = resolve(root, `.${path}`);
    if (!target.startsWith(root + sep)) throw new Error("path");
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mime[extname(target)] ?? "application/octet-stream",
      "Content-Security-Policy": csp,
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const artifacts = fileURLToPath(new URL("../../../target/web-checks/", import.meta.url));
await mkdir(artifacts, { recursive: true });
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    if (process.argv[2] && process.argv[2] !== name) continue;
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Content Security Policy"))
          failures.push(message.text());
      });
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (!url.startsWith(base)) return route.abort();
        return route.continue();
      });
      await page.goto(base);
      await page.getByRole("heading", { name: "One window for your coding agents" }).waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector(".product-frame img");
        return image?.complete && image.naturalWidth > 0;
      });
      assert.match(
        await page.locator(".product-frame img").evaluate((image) => image.currentSrc),
        /desktop-dark-\d+\.webp$/,
      );
      await page.screenshot({ path: join(artifacts, `${name}-home.png`), fullPage: true });
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      await settled(page);
      let axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        [],
      );
      // This Windows WebKit harness does not expose OS full-keyboard-access settings.
      // Chromium verifies Tab order; WebKit verifies the same link's explicit focus and activation.
      if (name === "webkit") await page.getByRole("link", { name: "Skip to content" }).focus();
      else await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        "Skip to content",
      );
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).hash, "#main");
      await page.evaluate(() => document.activeElement?.blur());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(artifacts, `${name}-mobile.png`), fullPage: true });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      await page.goto(`${base}/download`);
      assert.equal(await page.getByRole("button", { name: "Installer coming soon" }).count(), 2);
      await page.route("**/api/v1/config", (route) =>
        route.fulfill({ json: { protocol: 1, turnstile_site_key: "synthetic-ui-test" } }),
      );
      await page.route(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: "window.turnstile={render(el,options){options.callback('synthetic-ui-token');return 'test';},remove(){}};",
          }),
      );
      let verifications = 0;
      let inviteDenied = true;
      await page.route("**/api/v1/auth/challenges", async (route) => {
        assert.equal(route.request().postDataJSON().client_kind, "browser");
        if (inviteDenied) return route.fulfill({ status: 403, json: { error: "invite_required" } });
        await route.fulfill({
          json: { challenge_id: "synthetic", expires_in: 600, resend_after: 60 },
        });
      });
      await page.route("**/api/v1/auth/verify", async (route) => {
        verifications++;
        await route.fulfill(
          verifications === 1
            ? { status: 400, json: { error: "invalid_code" } }
            : { json: { user_id: "test", csrf_token: "synthetic-csrf", token: null } },
        );
      });
      await page.goto(`${base}/signup`);
      await page.getByRole("heading", { name: "Invited sign-in" }).waitFor();
      await page.getByLabel("Email address").fill("uninvited@example.invalid");
      await page.getByRole("button", { name: "Send a code" }).click();
      await page.getByRole("alert").filter({ hasText: "invite-only" }).waitFor();
      assert.equal(await page.getByLabel("Six-digit code").count(), 0);
      assert.equal(
        await page.getByRole("link", { name: "Explore the free Local app" }).getAttribute("href"),
        "/download",
      );
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({
        path: join(artifacts, `${name}-invite-required.png`),
        fullPage: true,
      });
      inviteDenied = false;
      await page.goto(`${base}/signin`);
      await page.getByLabel("Email address").fill("person@example.invalid");
      await page.getByRole("button", { name: "Send a code" }).click();
      await page.getByLabel("Six-digit code").waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "code");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "code");
      await page.getByLabel("Six-digit code").fill("000000");
      await page.getByRole("button", { name: "Verify and sign in" }).click();
      await page.getByRole("alert").filter({ hasText: "invalid or expired" }).waitFor();
      await page.getByLabel("Six-digit code").fill("123456");
      await page.getByRole("button", { name: "Verify and sign in" }).click();
      assert.equal(
        await page.getByRole("link", { name: "Open auracode" }).getAttribute("href"),
        "auracode://signin?email=person%40example.invalid",
      );
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      const now = Math.floor(Date.now() / 1000);
      const device = {
        id: "d",
        name: "Test Mac",
        platform: "macos",
        created_at: now,
        last_seen: now,
        approved_at: now,
        revoked_at: null,
      };
      let revoked = false;
      let restricted = false;
      let devicesUnavailable = false;
      await page.route("**/api/v1/auth/session", (route) =>
        route.fulfill({
          json: {
            session: {
              user_id: "test",
              client_kind: "browser",
              device_id: null,
              created_at: now,
              expires_at: now + 1000,
            },
            csrf_token: "synthetic-csrf",
          },
        }),
      );
      await page.route("**/api/v1/account", (route) =>
        route.fulfill({
          json: {
            account: {
              id: "test",
              email: "person@example.invalid",
              created_at: now,
              sync_used_bytes: 100000,
              sync_limit_bytes: 104857600,
              blob_reserved_bytes: 1000,
              blob_limit_bytes: 1073741824,
            },
          },
        }),
      );
      await page.route("**/api/v1/devices", (route) =>
        route.fulfill(
          devicesUnavailable
            ? { status: 503, json: { error: "unavailable" } }
            : restricted
              ? { status: 403, json: { error: "invite_required" } }
              : { json: { devices: [{ ...device, revoked_at: revoked ? now : null }] } },
        ),
      );
      await page.route("**/api/v1/devices/d", async (route) => {
        assert.equal(route.request().method(), "DELETE");
        assert.equal(route.request().headers()["x-auracode-csrf"], "synthetic-csrf");
        revoked = true;
        await route.fulfill({ json: { revoked: true } });
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/account`);
      await page.getByRole("heading", { name: "person@example.invalid" }).waitFor();
      await page.screenshot({ path: join(artifacts, `${name}-account.png`), fullPage: true });
      await settled(page);
      axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        [],
      );
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(revoked, false);
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await page.getByRole("button", { name: "Revoke device", exact: true }).click();
      await page.getByText("Revoked", { exact: true }).waitFor();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(revoked, true);
      restricted = true;
      await page.reload();
      await page.getByRole("status").filter({ hasText: "Cloud access is paused" }).waitFor();
      assert.equal(
        await page.getByRole("link", { name: "Download encrypted archive" }).getAttribute("href"),
        "/api/v1/account/export",
      );
      assert.equal(
        await page.getByRole("button", { name: "Sign out ↗", exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByRole("button", { name: "Change email" }).count(), 0);
      assert.equal(await page.getByText("No devices connected yet.", { exact: true }).count(), 0);
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({
        path: join(artifacts, `${name}-cloud-restricted.png`),
        fullPage: true,
      });
      restricted = false;
      devicesUnavailable = true;
      await page.reload();
      await page.getByRole("heading", { name: "person@example.invalid" }).waitFor();
      await page.getByRole("alert").filter({ hasText: "Device list unavailable" }).waitFor();
      assert.equal(
        await page.getByRole("link", { name: "Download encrypted archive" }).getAttribute("href"),
        "/api/v1/account/export",
      );
      assert.equal(
        await page.getByRole("button", { name: "Sign out ↗", exact: true }).isEnabled(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Sign out all", exact: true }).isEnabled(),
        true,
      );
      assert.equal(await page.getByText("No devices connected yet.", { exact: true }).count(), 0);
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page
        .locator("#security")
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      const confirm = page.getByRole("dialog");
      assert.equal(
        await confirm.getByRole("button", { name: "Delete account" }).isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      devicesUnavailable = false;
      await page.getByRole("button", { name: "Retry devices" }).click();
      await page.getByText("Revoked", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("alert").filter({ hasText: "Device list unavailable" }).count(),
        0,
      );
      await page.route("**/api/v1/account", (route) =>
        route.fulfill({ status: 410, json: { error: "account_deleted" } }),
      );
      await page
        .locator("#security")
        .getByRole("button", { name: "Delete account", exact: true })
        .click();
      await confirm.getByLabel("person@example.invalid").fill("person@example.invalid");
      await confirm.getByRole("button", { name: "Delete account", exact: true }).click();
      await page.getByRole("heading", { name: "This account was deleted." }).waitFor();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#security").count(), 0);
      await page.reload();
      await page.getByRole("heading", { name: "This account was deleted." }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Reload account" }).count(), 0);
      assert.equal(
        await page.getByRole("link", { name: "Open auracode", exact: true }).getAttribute("href"),
        "auracode://signin",
      );
      await settled(page);
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
      await page.screenshot({
        path: join(artifacts, `${name}-account-deleted.png`),
        fullPage: true,
      });
      assert.deepEqual(failures, []);
      const nojs = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await nojs.newPage();
      await staticPage.goto(`${base}/download`);
      await staticPage.getByRole("heading", { name: "Windows", exact: true }).waitFor();
      await staticPage.getByRole("heading", { name: "macOS", exact: true }).waitFor();
      await nojs.close();
      await context.close();
      console.log(
        `${name}: dark desktop/mobile, no-JS download, code errors, deep link, account actions, keyboard and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
