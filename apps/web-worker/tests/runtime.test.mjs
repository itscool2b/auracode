// Integration assertions exercise the compiled Rust Worker. No production services are contacted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const root = new URL("../", import.meta.url);
const publicRoot = new URL("../web/build/client/", root);
const routes = [
  "",
  "download",
  "signin",
  "signup",
  "verify-device",
  "account",
  "privacy",
  "terms",
  "changelog",
  "third-party-notices",
];
let runtime;
before(() => {
  runtime = new Miniflare({
    ...convertV4MiniflareOptions({
      modules: [
        { type: "ESModule", path: fileURLToPath(new URL("build/index.js", root)) },
        { type: "CompiledWasm", path: fileURLToPath(new URL("build/index_bg.wasm", root)) },
      ],
      compatibilityDate: "2026-10-26",
      outboundService() {
        assert.fail("the static Worker must never make an outbound request");
      },
    }),
    cf: false,
    host: "127.0.0.1",
    port: 0,
    telemetry: { enabled: false },
  });
});
after(async () => runtime?.dispose());
const request = (path, init = {}) =>
  runtime.dispatchFetch(`https://auracode.test${path}`, {
    ...init,
    headers: { "Accept-Encoding": "identity", ...init.headers },
  });
const security = (response) => {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=()",
  );
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.doesNotMatch(
    response.headers.get("content-security-policy"),
    /script-src[^;]*'unsafe-inline'/,
  );
  assert.equal(response.headers.get("set-cookie"), null);
};

test("prerendered pretty, trailing-slash and index routes serve exact public HTML", async () => {
  for (const route of routes) {
    const path = route ? `/${route}` : "/";
    const expected = await readFile(new URL(`${route ? `${route}/` : ""}index.html`, publicRoot));
    for (const alias of new Set([
      path,
      `${path.replace(/\/$/, "")}/`,
      `${path.replace(/\/$/, "")}/index.html`,
    ])) {
      const response = await request(`${alias}?source=synthetic`);
      assert.equal(response.status, 200, alias);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("content-length"), String(expected.length));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, alias);
      security(response);
      const noStore = ["account", "signin", "signup", "verify-device"].includes(route);
      assert.equal(
        response.headers.get("cache-control"),
        noStore ? "no-store" : "public, max-age=0, must-revalidate",
      );
      const csp = response.headers.get("content-security-policy");
      if (route === "verify-device") {
        assert.equal(response.headers.get("x-frame-options"), null);
        assert.match(
          csp,
          /frame-ancestors tauri:\/\/localhost http:\/\/tauri.localhost https:\/\/tauri.localhost/,
        );
        assert.doesNotMatch(csp, /frame-ancestors 'none'/);
        assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      } else {
        assert.equal(response.headers.get("x-frame-options"), "DENY");
        assert.match(csp, /frame-ancestors 'none'/);
      }
      for (const script of expected.toString().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/\bsrc\s*=/.test(script[1]) && script[2])
          assert.ok(
            csp.includes(`'sha256-${createHash("sha256").update(script[2]).digest("base64")}'`),
          );
      }
    }
  }
});

test("every public byte is embedded with its MIME and content-addressed cache policy", async () => {
  const mime = {
    js: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    txt: "text/plain; charset=utf-8",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  async function visit(relative = "") {
    for (const entry of await readdir(new URL(relative, publicRoot), { withFileTypes: true })) {
      const path = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        await visit(`${path}/`);
        continue;
      }
      if (path.endsWith(".html") || path === "_headers") continue;
      const expected = await readFile(new URL(path, publicRoot));
      const response = await request(`/${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("content-type"), mime[path.split(".").at(-1)], path);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, path);
      security(response);
      assert.equal(
        response.headers.get("etag"),
        `"${createHash("sha256").update(expected).digest("hex")}"`,
      );
      assert.equal(
        response.headers.get("cache-control"),
        path.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
        path,
      );
    }
  }
  await visit();
});

test("HEAD and conditional requests retain representation headers without response bytes", async () => {
  for (const path of ["/", "/download", "/account", "/images/desktop-dark.png", "/missing.js"]) {
    const get = await request(path);
    const head = await request(path, { method: "HEAD" });
    assert.equal(head.status, get.status);
    for (const name of [
      "content-type",
      "content-length",
      "cache-control",
      "etag",
      "content-security-policy",
    ])
      assert.equal(head.headers.get(name), get.headers.get(name), name);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  const get = await request("/download");
  const cached = await request("/download", {
    headers: { "If-None-Match": `"other", W/${get.headers.get("etag")}` },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("etag"), get.headers.get("etag"));
  assert.equal(cached.headers.get("content-length"), null);
  assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const account = await request("/account", { headers: { "If-None-Match": "*" } });
  assert.equal(account.status, 200);
  assert.equal(account.headers.get("etag"), null);
  assert.equal(account.headers.get("cache-control"), "no-store");
});

test("missing files, internal artifacts, API paths and methods do not get a homepage fallback", async () => {
  for (const path of [
    "/missing",
    "/assets/missing.js",
    "/_headers",
    "/__spa-fallback.html",
    "/server/index.js",
    "/Cargo.toml",
    "/api",
    "/api/v1/config",
    "/API/v1/auth/start",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await response.text(), "Not found\n");
    security(response);
  }
  assert.equal((await request("/api/v1/auth/start", { method: "POST", body: "{}" })).status, 404);
  const post = await request("/signin", {
    method: "POST",
    body: "email=synthetic@example.invalid",
  });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  assert.equal(post.headers.get("cache-control"), "no-store");
});

test("encoded traversal, encoded separators and noncanonical public paths are refused", async () => {
  // WHATWG Request normalizes literal dot segments before user code. Remaining encoded paths
  // are refused; the immutable allowlist never opens a filesystem path from any request.
  for (const path of [
    "/%2e%2e%2findex.html",
    "/%252e%252e/index.html",
    "/assets%2fmissing.js",
    "/assets%5cmissing.js",
    "/%00",
    "/%61ccount",
    "//index.html",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Invalid path\n");
  }
});
