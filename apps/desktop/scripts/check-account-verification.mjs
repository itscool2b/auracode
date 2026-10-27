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
  const context = await browser.newContext({ viewport: { width: 900, height: 640 } });
  try {
    await context.addInitScript(() =>
      window.addEventListener("message", (event) => {
        if (event.data?.type === "auracode:verification-init")
          window.syntheticAttempt = event.data.nonce;
      }),
    );
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
          body: `window.turnstile={render(node,options){ const button=document.createElement('button'); button.className='g-button g-button-outline g-button-36'; button.textContent='Complete synthetic verification'; button.onclick=()=>options.callback('synthetic-proof'); node.append(button); return 'fixture'; },remove(){}};`,
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
    await page.goto("http://tauri.localhost/?preview=verification");
    const request = page.getByRole("button", { name: "Request sign-in code" });
    const child = page.frameLocator("iframe");
    await child.getByRole("button", { name: "Complete synthetic verification" }).waitFor();
    const nonce = await page
      .frames()
      .find((frame) => frame.url().startsWith("https://auracode.si/verify-device"))
      .evaluate(() => window.syntheticAttempt);
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
