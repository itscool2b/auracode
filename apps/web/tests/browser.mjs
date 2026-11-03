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

/** The marquee as a still list: every agent shown once, inside the viewport, nothing moving. */
const stillMarquee = (page) =>
  page.evaluate(() => {
    const shown = [...document.querySelectorAll(".marquee-item")].filter(
      (item) => item.getClientRects().length > 0,
    );
    return {
      names: shown.map((item) => item.textContent),
      inView: shown.every((item) => {
        const box = item.getBoundingClientRect();
        return box.left >= 0 && box.right <= document.documentElement.clientWidth;
      }),
      moving: [...document.querySelectorAll(".marquee-lane")].some(
        (lane) => lane.getAnimations().length > 0,
      ),
    };
  });

/**
 * Each moving lane, measured: its view, its sets, and where its loop ends. The loop is seamless
 * when every set is the same width, the track is at least twice the view, the animation moves it by
 * exactly half its length, and the set that starts the second half ends the loop exactly where the
 * first set began. The speed is in pixels per second: half the track over the loop's duration.
 */
const movingMarquee = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".marquee-lane")].map((lane) => {
      const sets = [...lane.querySelectorAll(":scope > .marquee-set")];
      const widths = sets.map((set) => set.getBoundingClientRect().width);
      const animation = lane.getAnimations()[0];
      const duration = Number(animation.effect.getTiming().duration);
      const reverse = getComputedStyle(lane).animationDirection === "reverse";
      const half = sets.length / 2;
      const seek = (time) => {
        animation.pause();
        animation.currentTime = time;
      };
      // The frame that starts the loop and the frame that ends it.
      seek(reverse ? duration - 0.001 : 0);
      const start = sets[0].getBoundingClientRect().left;
      seek(reverse ? 0 : duration - 0.001);
      const end = sets[half].getBoundingClientRect().left;
      const shift = Math.abs(new DOMMatrixReadOnly(getComputedStyle(lane).transform).m41);
      // Seeking took the animation out of CSS's hands; restart it so CSS holds it again.
      lane.style.animationName = "none";
      void lane.offsetWidth;
      lane.style.animationName = "";
      const track = lane.getBoundingClientRect().width;
      return {
        back: lane.classList.contains("marquee-lane-back"),
        view: lane.parentElement.clientWidth,
        track,
        sets: sets.length,
        setSpread: Math.max(...widths) - Math.min(...widths),
        setWidth: widths[0],
        shift,
        seam: Math.abs(end - start),
        pxPerSecond: (half * widths[0]) / (duration / 1000),
      };
    }),
  );

const assertSeamless = (lanes, where) => {
  assert.equal(lanes.length, 2, `${where}: two lanes`);
  for (const lane of lanes) {
    const name = `${where}, ${lane.back ? "back" : "front"} lane`;
    assert.ok(lane.sets >= 2 && lane.sets % 2 === 0, `${name}: an even run of sets`);
    assert.ok(lane.setSpread < 0.01, `${name}: every set is the same width`);
    assert.ok(lane.track >= 2 * lane.view, `${name}: the track is at least twice the view`);
    assert.ok(
      Math.abs(lane.shift - (lane.sets / 2) * lane.setWidth) < 0.5,
      `${name}: the loop moves by exactly half the track (${lane.shift})`,
    );
    assert.ok(lane.seam < 0.5, `${name}: the loop's last frame matches its first (${lane.seam}px)`);
  }
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
      assert.equal(await heroStage.locator(".handoff-link").count(), 1);
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
      // Reduced motion: the agent marquee is a still list, every agent once and in view.
      let still = await stillMarquee(page);
      assert.equal(still.names.length, 9, "the still marquee names every agent once");
      assert.equal(new Set(still.names).size, 9);
      assert.ok(still.inView, "the still marquee fits the page");
      assert.equal(still.moving, false, "the marquee holds still under reduced motion");
      assert.equal(await page.getByRole("list", { name: "Agents auracode runs" }).count(), 1);
      await page.waitForFunction(() => {
        const image = document.querySelector(".product-frame img");
        return image?.complete && image.naturalWidth > 0;
      });
      await settled(page);
      await page.screenshot({ path: join(artifacts, `${name}-home-light.png`), fullPage: true });
      await page.getByRole("tab", { name: "Switch agents mid-chat" }).click();
      await page
        .locator(".caps .handoff-stage")
        .screenshot({ path: join(artifacts, `${name}-handoff-light.png`) });
      await page.reload();
      assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
      await page.getByRole("heading", { name: "One window for your coding agents" }).waitFor();
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
      await handoff.screenshot({ path: join(artifacts, `${name}-handoff-mobile.png`) });
      await tabs.first().click();
      await page.screenshot({ path: join(artifacts, `${name}-mobile.png`), fullPage: true });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      still = await stillMarquee(page);
      assert.equal(still.names.length, 9);
      assert.ok(still.inView, "the still marquee wraps inside a 390px page");
      // The narrowest phones still in use: nothing may scroll sideways at 320px either.
      await page.setViewportSize({ width: 320, height: 640 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "the home page scrolls sideways at 320px",
      );
      still = await stillMarquee(page);
      assert.equal(still.names.length, 9);
      assert.ok(still.inView, "the still marquee wraps inside a 320px page");
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
      // Full motion: the hero's handoff loop, the reveals, the wheel and the night bands run
      // without errors or sideways scrolling, and the loop leaves its printed first frame.
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
      // The marquee loops seamlessly at every width, at the same pixels per second at each.
      const ready = () =>
        motion.waitForFunction(() => {
          const lanes = [...document.querySelectorAll(".marquee-lane")];
          return (
            lanes.length === 2 &&
            lanes.every(
              (lane) =>
                lane.hasAttribute("data-ready") &&
                lane.getAnimations().length === 1 &&
                lane.querySelectorAll(":scope > .marquee-set").length === Number(lane.dataset.sets),
            )
          );
        });
      const speeds = [];
      for (const width of [1440, 2560, 1024, 768, 390, 320]) {
        await motion.setViewportSize({ width, height: 900 });
        await motion.evaluate(() => window.scrollTo(0, 0));
        await ready();
        await motion.waitForTimeout(200);
        await ready();
        const lanes = await movingMarquee(motion);
        assertSeamless(lanes, `${width}px`);
        speeds.push(lanes.map((lane) => lane.pxPerSecond));
      }
      for (const lane of [0, 1]) {
        const values = speeds.map((pair) => pair[lane]);
        assert.ok(
          Math.max(...values) - Math.min(...values) < 0.05,
          `the marquee's ${lane ? "back" : "front"} lane keeps one speed in px/s: ${values}`,
        );
      }
      await motion.setViewportSize({ width: 1440, height: 900 });
      await ready();
      // It holds under a fine pointer, and while the tab is hidden. Hover settles on the next
      // frame, so each state is awaited, then confirmed.
      const states = () =>
        motion.evaluate(() =>
          [...document.querySelectorAll(".marquee-lane")].map(
            (lane) => lane.getAnimations()[0]?.playState,
          ),
        );
      const lanesIn = async (state, why) => {
        await motion
          .waitForFunction(
            (want) =>
              [...document.querySelectorAll(".marquee-lane")].every(
                (lane) => lane.getAnimations()[0]?.playState === want,
              ),
            state,
            { timeout: 3000 },
          )
          .catch(() => {});
        assert.deepEqual(await states(), [state, state], why);
      };
      // The pills never stand still, so the pointer goes to the lanes' stable frame.
      await motion.locator(".marquee").scrollIntoViewIfNeeded();
      const lanesBox = await motion.locator(".marquee").boundingBox();
      await motion.mouse.move(
        lanesBox.x + lanesBox.width / 2,
        lanesBox.y + Math.min(40, lanesBox.height / 2),
      );
      await lanesIn("paused", "the marquee holds under the pointer");
      await motion.mouse.move(4, 4);
      await lanesIn("running", "the marquee runs again once the pointer leaves");
      await motion.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await lanesIn("paused", "the marquee holds in a hidden tab");
      await motion.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await lanesIn("running", "the marquee runs again in a visible tab");
      for (const top of [1100, 2500, 3600, 4800, 5600, 6400, 7600, 1e6]) {
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
      // Without scripts the marquee is the same still, complete list, at desktop and phone widths.
      await staticPage.goto(base);
      for (const width of [1440, 390]) {
        await staticPage.setViewportSize({ width, height: 900 });
        const list = await stillMarquee(staticPage);
        assert.equal(
          list.names.length,
          9,
          `the script-free marquee names every agent at ${width}px`,
        );
        assert.ok(list.inView, `the script-free marquee fits a ${width}px page`);
        assert.equal(list.moving, false);
      }
      await staticPage.goto(`${base}/download`);
      await staticPage.getByRole("heading", { name: "Windows", exact: true }).waitFor();
      await staticPage.getByRole("heading", { name: "macOS", exact: true }).waitFor();
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
