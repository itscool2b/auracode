import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../build/client/", import.meta.url);
test("public pages are prerendered, dark and usable without JavaScript", async () => {
  for (const path of ["", "download/", "privacy/", "terms/", "changelog/"]) {
    const html = await readFile(new URL(`${path}index.html`, root), "utf8");
    assert.match(html, /<html[^>]*data-theme="dark"/);
    assert.match(html, /<main/);
    assert.match(html, /<h1/);
    assert.doesNotMatch(html, /data-theme="light"/);
  }
  const downloads = await readFile(new URL("download/index.html", root), "utf8");
  assert.match(downloads, /macOS/);
  assert.match(downloads, /Windows/);
  assert.match(downloads, /Not published/);
  assert.doesNotMatch(downloads, /href="[^"]+\.(exe|dmg)"/);
  await access(new URL("images/desktop-dark.png", root));
  for (const width of [480, 960, 1440])
    await access(new URL(`images/desktop-dark-${width}.webp`, root));
  const home = await readFile(new URL("index.html", root), "utf8");
  assert.match(home, /<picture><source[^>]*type="image\/webp"/);
  assert.match(
    home,
    /desktop-dark-480.webp 480w, \/images\/desktop-dark-960.webp 960w, \/images\/desktop-dark-1440.webp 1440w/,
  );
  assert.match(home, /sizes="\(max-width: 620px\) calc\(100vw - 60px\)/);
});
test("static CSP authorizes only the emitted inline framework scripts", async () => {
  const headers = await readFile(new URL("_headers", root), "utf8");
  assert.match(headers, /frame-ancestors 'none'/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
  assert.match(
    headers,
    /\/verify-device\n {2}! X-Frame-Options\n {2}Content-Security-Policy: frame-ancestors tauri:\/\/localhost http:\/\/tauri.localhost https:\/\/tauri.localhost/,
  );
  assert.ok(headers.split("\n").every((line) => line.length <= 2000));
  for (const path of [
    "",
    "download/",
    "signin/",
    "signup/",
    "verify-device/",
    "account/",
    "privacy/",
    "terms/",
    "changelog/",
  ]) {
    const html = await readFile(new URL(`${path}index.html`, root), "utf8");
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/\bsrc\s*=/.test(match[1]) && match[2])
        assert.ok(
          headers.includes(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`),
          path,
        );
    }
  }
});

test("cloud entry pages explain invitation access while Local remains free", async () => {
  for (const path of ["", "signin/", "signup/"]) {
    const html = await readFile(new URL(`${path}index.html`, root), "utf8");
    assert.match(html, /invite-only|INVITE-ONLY/);
    assert.match(html, /free/);
    assert.doesNotMatch(html, /Create (?:your |an )?account/);
    assert.doesNotMatch(html, /open.source|Choose a plan|Subscribe now/i);
  }
});
test("third-party notices are emitted and linked from every page footer", async () => {
  const text = await readFile(new URL("third-party-notices.txt", root), "utf8");
  assert.match(text, /react-router/);
  assert.doesNotMatch(text, /SQLCipher|openssl-src/);
  const page = await readFile(new URL("third-party-notices/index.html", root), "utf8");
  assert.match(page, /color-scheme:dark/);
  assert.doesNotMatch(page, /<script/);
  const home = await readFile(new URL("index.html", root), "utf8");
  assert.match(home, /<a href="\/third-party-notices">Notices<\/a>/);
  const headers = await readFile(new URL("_headers", root), "utf8");
  assert.match(
    headers,
    /\/third-party-notices\*\n {2}Content-Security-Policy: frame-ancestors 'none'/,
  );
});
