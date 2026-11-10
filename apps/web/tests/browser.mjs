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

/**
 * The agents' row: every agent named once, each wholly inside the viewport and none overlapping
 * the next, and nothing in it moving.
 */
const agentWall = (page) =>
  page.evaluate(() => {
    const shown = [...document.querySelectorAll(".agent-cell")].filter(
      (item) => item.getClientRects().length > 0,
    );
    const boxes = shown.map((item) => item.getBoundingClientRect());
    return {
      names: shown.map((item) => item.textContent),
      inView: boxes.every(
        (box) => box.left >= 0 && box.right <= document.documentElement.clientWidth,
      ),
      apart: boxes.every((box, i) =>
        boxes.every(
          (other, j) =>
            i === j ||
            box.right <= other.left + 0.5 ||
            other.right <= box.left + 0.5 ||
            box.bottom <= other.top + 0.5 ||
            other.bottom <= box.top + 0.5,
        ),
      ),
      moving: shown.some((item) => item.getAnimations({ subtree: true }).length > 0),
    };
  });

const assertWall = (wall, where) => {
  assert.equal(wall.names.length, 9, `${where}: the row names every agent`);
  assert.equal(new Set(wall.names).size, 9, `${where}: each agent once`);
  assert.ok(wall.inView, `${where}: the row fits the page`);
  assert.ok(wall.apart, `${where}: no two names overlap`);
  assert.equal(wall.moving, false, `${where}: the row holds still`);
};

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
        colorScheme: "dark",
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
      await page.addInitScript(() => localStorage.setItem("auracode-appearance", "dark"));
      await page.goto(base);
      const heroStage = page.locator(".hero-detail .handoff-stage");
      assert.equal(await heroStage.locator(".handoff-prior").isVisible(), true);
      assert.equal(await heroStage.locator(".handoff-next").isVisible(), true);
      assert.equal(
        await page
          .getByRole("tab", { name: "Optional file checkpoints" })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      assert.equal(await page.getByLabel("Appearance").count(), 0);
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        "rgb(250, 250, 250)",
      );
      // The agents' row: every agent once, in view, in one line at this width.
      assertWall(await agentWall(page), "1440px");
      assert.equal(await page.getByRole("list", { name: "Agents auracode runs" }).count(), 1);
      assert.equal(
        await page.evaluate(
          () =>
            new Set(
              [...document.querySelectorAll(".agent-cell")].map((cell) =>
                Math.round(cell.getBoundingClientRect().top),
              ),
            ).size,
        ),
        1,
        "the agents sit on one line at 1440px",
      );
      // The header is a plain bar, and nothing on the page is a dark band.
      assert.equal(await page.locator(".night").count(), 0);
      assert.equal(
        await page.getByRole("navigation", { name: "Main" }).getByRole("link").count(),
        4,
      );
      await page.waitForFunction(() => {
        const image = document.querySelector(".product-frame img");
        return image?.complete && image.naturalWidth > 0;
      });
      await settled(page);
      await page.screenshot({ path: join(artifacts, `${name}-home-light.png`), fullPage: true });
      await page.getByRole("tab", { name: "Switch agents mid-chat" }).click();
      // Park the pointer: a capture scrolls the page, and a tab passing under a resting pointer
      // would take the view (hover intent).
      await page.mouse.move(2, 2);
      await page
        .locator(".caps .handoff-stage")
        .screenshot({ path: join(artifacts, `${name}-handoff-light.png`) });
      await page.reload();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      await page.getByRole("heading", { name: "One window for every coding agent." }).waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector(".product-frame img");
        return image?.complete && image.naturalWidth > 0;
      });
      assert.match(
        await page.locator(".product-frame img").evaluate((image) => image.currentSrc),
        /desktop-light-\d+\.webp$/,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(artifacts, `${name}-home.png`), fullPage: true });
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
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
      // No canvas anywhere (the window is CSS) and no film Pause button.
      assert.equal(await page.locator("canvas").count(), 0);
      assert.equal(await page.getByRole("button", { name: /pause|play/i }).count(), 0);
      // The capabilities panel: six tabs, each view clean under axe once shown.
      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 6);
      for (let i = 0; i < 6; i++) {
        await tabs.nth(i).click();
        assert.equal(await tabs.nth(i).getAttribute("aria-selected"), "true");
        await settled(page);
        axe = await new AxeBuilder({ page })
          .include(".caps")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          [],
          `capability ${i}`,
        );
      }
      // Arrow keys move the selection and the focus; Home and End jump to the ends.
      await tabs.first().focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "caps-tab-handoff");
      const handoff = page.locator(".caps .handoff-stage");
      assert.equal(await handoff.isVisible(), true);
      assert.equal(await handoff.locator(".handoff-prior").isVisible(), true);
      assert.equal(await handoff.locator(".handoff-next").isVisible(), true);
      assert.match(await handoff.locator(".handoff-prior").textContent(), /Frame pacing now waits/);
      assert.match(
        await handoff.locator(".handoff-next").textContent(),
        /Next message includes a handoff to Codex/,
      );
      await handoff.screenshot({ path: join(artifacts, `${name}-handoff.png`) });
      await page.keyboard.press("End");
      assert.equal(await tabs.nth(5).getAttribute("aria-selected"), "true");
      await page.keyboard.press("Home");
      assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
      await page.evaluate(() => document.activeElement?.blur());
      await page.setViewportSize({ width: 390, height: 844 });
      await tabs.nth(1).click();
      await page.mouse.move(2, 2);
      await handoff.screenshot({ path: join(artifacts, `${name}-handoff-mobile.png`) });
      await tabs.first().click();
      await page.screenshot({ path: join(artifacts, `${name}-mobile.png`), fullPage: true });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      assertWall(await agentWall(page), "390px");
      // The phone menu is a solid sheet under the bar, over whatever the page shows behind it.
      await page.evaluate(() => {
        const band = document.querySelector("#features");
        window.scrollTo(0, band.getBoundingClientRect().top + window.scrollY + 400);
      });
      await page.waitForFunction(() =>
        document.querySelector(".site-nav")?.hasAttribute("data-scrolled"),
      );
      await page.locator(".nav-menu-button").click();
      await page.getByRole("navigation", { name: "Menu" }).waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector(".nav-sheet")
          .getAnimations()
          .every((animation) => animation.playState === "finished"),
      );
      await settled(page);
      axe = await new AxeBuilder({ page })
        .include(".nav-sheet")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        [],
        "the phone menu",
      );
      assert.equal(
        await page
          .locator(".nav-sheet")
          .evaluate((sheet) => getComputedStyle(sheet).backgroundColor),
        "rgb(250, 250, 250)",
        "the phone menu is solid",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("navigation", { name: "Menu" }).waitFor({ state: "hidden" });
      // A link to a section of this page closes the menu and goes there.
      await page.locator(".nav-menu-button").click();
      await page
        .getByRole("navigation", { name: "Menu" })
        .getByRole("link", { name: "FAQ" })
        .click();
      await page.getByRole("navigation", { name: "Menu" }).waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).hash, "#faq");
      await page.evaluate(() => window.scrollTo(0, 0));
      // The narrowest phones still in use: nothing may scroll sideways at 320px either.
      await page.setViewportSize({ width: 320, height: 640 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "the home page scrolls sideways at 320px",
      );
      assertWall(await agentWall(page), "320px");
      await page.goto(`${base}/download`);
      assert.equal(await page.getByRole("button", { name: "Installer coming soon" }).count(), 3);
      await page.route("**/api/v1/config", (route) =>
        route.fulfill({ json: { protocol: 1, turnstile_site_key: "synthetic-ui-test" } }),
      );
      await page.route(
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: "window.turnstile={render(el,options){window.testTurnstileTheme=options.theme;options.callback('synthetic-ui-token');return 'test';},remove(){}};",
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
      await page.waitForFunction(() => window.testTurnstileTheme === "light");
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
      assert.equal(await page.evaluate(() => localStorage.getItem("auracode-appearance")), "dark");
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
      // Full motion: the hero's handoff loop, the reveals and the capability cycle run without
      // errors or sideways scrolling, and the loop leaves its printed first frame.
      const moving = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "no-preference",
        colorScheme: "light",
      });
      const motion = await moving.newPage();
      const motionFailures = [];
      motion.on("pageerror", (error) => motionFailures.push(error.message));
      motion.on("console", (message) => {
        if (message.type() === "error") motionFailures.push(message.text());
      });
      await motion.route("**/*", (route) =>
        route.request().url().startsWith(base) ? route.continue() : route.abort(),
      );
      await motion.goto(base);
      await motion.waitForFunction(
        () => !document.querySelector(".hw")?.hasAttribute("data-settled"),
        null,
        {
          timeout: 10000,
        },
      );
      await motion.waitForTimeout(1200);
      await motion.screenshot({ path: join(artifacts, `${name}-motion-hero.png`) });
      // The agents' row holds still and fits at every width, with motion on as well.
      for (const width of [1440, 2560, 1024, 768, 390, 320]) {
        await motion.setViewportSize({ width, height: 900 });
        await motion.evaluate(() => window.scrollTo(0, 0));
        assertWall(await agentWall(motion), `${width}px with motion`);
      }
      await motion.setViewportSize({ width: 1440, height: 900 });
      // The capability cycle runs while its section is in view, holds while the pointer rests in
      // it, and holds in a hidden tab.
      const cycle = (attribute, present, why) =>
        motion
          .waitForFunction(
            ([name, want]) => document.querySelector(".caps-frame")?.hasAttribute(name) === want,
            [attribute, present],
            { timeout: 4000 },
          )
          .catch(() => assert.fail(why));
      await motion.locator(".caps-view").scrollIntoViewIfNeeded();
      await motion.mouse.move(4, 4);
      await cycle("data-running", true, "the capability cycle runs in view");
      const stage = await motion.locator(".caps-view").boundingBox();
      await motion.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await cycle("data-auto", false, "the capability cycle holds under the pointer");
      await motion.mouse.move(4, 4);
      await cycle("data-running", true, "the capability cycle runs again once the pointer leaves");
      await motion.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "hidden",
        });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await cycle("data-running", false, "the capability cycle holds in a hidden tab");
      await motion.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await cycle("data-running", true, "the capability cycle runs again in a visible tab");
      for (const top of [1100, 2200, 3300, 4400, 5500, 6400, 1e6]) {
        await motion.evaluate((y) => window.scrollTo(0, y), top);
        await motion.waitForTimeout(600);
        assert.ok(
          await motion.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `the moving home page scrolls sideways at ${top}`,
        );
      }
      await motion.screenshot({ path: join(artifacts, `${name}-motion-end.png`) });
      await motion.setViewportSize({ width: 390, height: 844 });
      await motion.evaluate(() => window.scrollTo(0, 0));
      await motion.waitForTimeout(600);
      await motion.screenshot({ path: join(artifacts, `${name}-motion-mobile.png`) });
      assert.ok(
        await motion.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "the moving home page scrolls sideways at 390px",
      );
      assert.deepEqual(motionFailures, []);
      await moving.close();
      const nojs = await browser.newContext({ javaScriptEnabled: false, colorScheme: "dark" });
      const staticPage = await nojs.newPage();
      // Without scripts the agents' row is the same complete list, at desktop and phone widths.
      await staticPage.goto(base);
      for (const width of [1440, 390]) {
        await staticPage.setViewportSize({ width, height: 900 });
        assertWall(await agentWall(staticPage), `${width}px without scripts`);
      }
      await staticPage.goto(`${base}/download`);
      await staticPage.getByRole("heading", { name: "Windows", exact: true }).waitFor();
      await staticPage.getByRole("heading", { name: "macOS", exact: true }).waitFor();
      await staticPage.getByRole("heading", { name: "Linux", exact: true }).waitFor();
      assert.equal(
        await staticPage.evaluate(() => getComputedStyle(document.body).backgroundColor),
        "rgb(250, 250, 250)",
      );
      await nojs.close();
      await context.close();
      console.log(
        `${name}: light desktop/mobile under dark system, no-JS download, code errors, deep link, account actions, keyboard and accessibility passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
