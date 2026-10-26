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
});
test("static CSP authorizes only the emitted inline framework scripts", async () => {
  const headers = await readFile(new URL("_headers", root), "utf8");
  assert.match(headers, /frame-ancestors 'none'/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
  for (const path of [
    "",
    "download/",
    "signin/",
    "signup/",
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
