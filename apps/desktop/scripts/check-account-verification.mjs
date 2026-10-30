// Tests the real two-page bridge with a synthetic widget. No network request or CAPTCHA is sent.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

// Sheets fade in and controls settle their colours; audit only once every finite animation ends.
const settled = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );

export async function checkAccountVerification(browser, desktopUrl, out, engine) {
  const root = fileURLToPath(new URL("../../web/build/client/", import.meta.url));
  const headers = await readFile(resolve(root, "_headers"), "utf8");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)[1];
  const context = await browser.newContext({
    viewport: { width: 960, height: 640 },
    colorScheme: null,
  });
  try {
    await context.addInitScript(() => {
      // Browser-wide media emulation overrides cross-origin iframe inheritance. Simulate only
      // the desktop controller's OS signal so the child still exercises the browser's real CSS.
      if (location.origin === "http://tauri.localhost") {
        const matchMedia = window.matchMedia.bind(window);
        const media = Object.assign(new EventTarget(), {
          media: "(prefers-color-scheme: dark)",
          matches: true,
        });
        window.matchMedia = (query) => (query === media.media ? media : matchMedia(query));
        window.syntheticSystemAppearance = (theme) => {
          media.matches = theme === "dark";
          media.dispatchEvent(new Event("change"));
        };
      }
      window.addEventListener("message", (event) => {
        if (event.data?.type === "auracode:verification-init")
          window.syntheticAttempt = event.data.nonce;
      });
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://tauri.localhost") {
        const response = await fetch(`${desktopUrl}${url.pathname}${url.search}`);
        return route.fulfill({
          status: response.status,
          contentType: response.headers.get("content-type") ?? "text/plain",
          body: Buffer.from(await response.arrayBuffer()),
        });
      }
      if (url.origin === "https://challenges.cloudflare.com")
        return route.fulfill({
          contentType: "text/javascript",
          body: `const widgets=new Map(); let serial=0; window.turnstile={render(node,options){ const id=String(++serial); const button=document.createElement('button'); button.className='g-button g-button-outline g-button-36'; button.textContent='Complete synthetic verification'; button.onclick=()=>options.callback('synthetic-proof'); node.append(button); widgets.set(id,button); window.syntheticTheme=options.theme; window.syntheticRenders=serial; return id; },remove(id){ widgets.get(id)?.remove(); widgets.delete(id); }};`,
        });
      if (url.origin !== "https://auracode.si") return route.abort();
      if (url.pathname === "/api/v1/config")
        return route.fulfill({ json: { turnstile_site_key: "synthetic-test-key" } });
      let path = url.pathname;
      if (!extname(path)) path += "/index.html";
      const target = resolve(root, `.${path}`);
      assert.ok(target.startsWith(resolve(root) + sep));
      const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      };
      return route.fulfill({
        body: await readFile(target),
        contentType: mime[extname(target)] ?? "application/octet-stream",
        headers: { "Content-Security-Policy": `${csp}; frame-ancestors http://tauri.localhost` },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Content Security Policy"))
        errors.push(message.text());
    });
    // The desktop frame follows its theme; the hosted verification page stays light.
    await page.goto("http://tauri.localhost/?preview=verification&theme=light");
    const request = page.getByRole("button", { name: "Request sign-in code" });
    const child = page.frameLocator("iframe");
    await child.getByRole("button", { name: "Complete synthetic verification" }).waitFor();
    const childFrame = page
      .frames()
      .find((frame) => frame.url().startsWith("https://auracode.si/verify-device"));
    assert.ok(childFrame, "the real verification page is loaded cross-origin");
    const nonce = await childFrame.evaluate(() => window.syntheticAttempt);
    const assertTheme = async (theme) => {
      await childFrame
        .waitForFunction(() => window.syntheticTheme === "light")
        .catch(async (error) => {
          const state = JSON.stringify({
            parent: await page.evaluate(() => ({
              theme: document.documentElement.dataset.theme,
              frame: getComputedStyle(document.querySelector("iframe")).colorScheme,
            })),
            child: await childFrame.evaluate(() => ({
              theme: document.documentElement.dataset.theme,
              scheme: getComputedStyle(document.documentElement).colorScheme,
              dark: matchMedia("(prefers-color-scheme: dark)").matches,
              widget: window.syntheticTheme,
            })),
          });
          throw new Error(`Expected ${theme} verification appearance. Theme state: ${state}`, {
            cause: error,
          });
        });
      assert.equal(
        await page.locator("iframe").evaluate((frame) => getComputedStyle(frame).colorScheme),
        theme,
      );
      assert.deepEqual(
        await childFrame.evaluate(() => ({
          scheme: getComputedStyle(document.documentElement).colorScheme,
          dark: matchMedia("(prefers-color-scheme: dark)").matches,
          nonce: window.syntheticAttempt,
        })),
        { scheme: "light", dark: theme === "dark", nonce },
      );
      assert.equal(
        await child.getByRole("button", { name: "Complete synthetic verification" }).count(),
        1,
      );
    };
    const setAppearance = (preference) =>
      page.evaluate(async (value) => {
        const { setAppearancePreference } = await import("/src/lib/appearance.ts");
        setAppearancePreference(value);
      }, preference);
    await assertTheme("light");
    assert.equal(await request.isDisabled(), true);
    await page.evaluate((nonce) => {
      const source = document.querySelector("iframe").contentWindow;
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://foreign.invalid",
          source,
          data: { type: "auracode:verification-token", nonce, token: "forged" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://auracode.si",
          source: window,
          data: { type: "auracode:verification-token", nonce, token: "forged" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://auracode.si",
          source,
          data: { type: "auracode:verification-token", nonce: "old-attempt", token: "forged" },
        }),
      );
    }, nonce);
    assert.equal(await request.isDisabled(), true);
    await child.getByRole("button", { name: "Complete synthetic verification" }).click();
    await page.getByText("Verification complete.", { exact: true }).waitFor();
    assert.equal(await request.isEnabled(), true);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.screenshot({ path: resolve(out, `${engine}-account-verification-light.png`) });

    // Retheme the frame without replacing the light website widget or invalidating its proof.
    const initialRenders = await childFrame.evaluate(() => window.syntheticRenders);
    await setAppearance("dark");
    await assertTheme("dark");
    assert.equal(await childFrame.evaluate(() => window.syntheticRenders), initialRenders);
    assert.equal(await request.isEnabled(), true);

    // Returning to System without a visual change keeps the valid widget, then follows the OS.
    const renders = await childFrame.evaluate(() => window.syntheticRenders);
    await setAppearance("system");
    await assertTheme("dark");
    assert.equal(await childFrame.evaluate(() => window.syntheticRenders), renders);
    assert.equal(await request.isEnabled(), true);
    await page.evaluate(() => window.syntheticSystemAppearance("light"));
    await assertTheme("light");
    assert.equal(await request.isEnabled(), true);
    await page.evaluate(() => window.syntheticSystemAppearance("dark"));
    await assertTheme("dark");
    assert.equal(await request.isEnabled(), true);
    assert.deepEqual(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
      { local: { "auracode.preview.appearance": "system" }, session: {} },
    );
    assert.equal(await childFrame.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await settled(page);
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(out, `${engine}-account-verification.png`) });
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium, webkit } = await import("playwright");
  const out = fileURLToPath(new URL("../../../target/settings-browser/", import.meta.url));
  await mkdir(out, { recursive: true });
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch();
    try {
      await checkAccountVerification(
        browser,
        process.env.CHECK_URL ?? "http://localhost:1426",
        out,
        engine,
      );
      console.log(`${engine}: account verification bridge passed`);
    } finally {
      await browser.close();
    }
  }
}
