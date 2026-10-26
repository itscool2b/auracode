// Platform integration tests only. All backend behavior under test is the compiled Rust Worker.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

const root = new URL("../", import.meta.url);
const key = Buffer.alloc(32, 1);
const now = Math.floor(Date.now() / 1000);
const token = Buffer.alloc(32, 2).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const verifier = (domain, fields) => {
  const mac = createHmac("sha256", key).update(domain);
  for (const field of fields) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(Buffer.byteLength(field)));
    mac.update(length).update(field);
  }
  return mac.digest("base64url");
};
let runtime;
let db;

before(async () => {
  runtime = new Miniflare({
    ...convertV4MiniflareOptions({
      modules: [
        { type: "ESModule", path: fileURLToPath(new URL("build/index.js", root)) },
        { type: "CompiledWasm", path: fileURLToPath(new URL("build/index_bg.wasm", root)) },
      ],
      compatibilityDate: "2026-10-26",
      d1Databases: ["DB"],
      r2Buckets: ["BLOBS"],
      bindings: {
        APP_ORIGIN: "https://auracode.test",
        AUTH_HMAC_KEY: key.toString("base64url"),
        TURNSTILE_SECRET: "synthetic-unused",
        EMAIL_FROM: "signin@auracode.test",
      },
      // Any accidental network subrequest fails the test instead of reaching a real service.
      outboundService() {
        throw new Error("unexpected external request");
      },
    }),
    cf: false,
    telemetry: { enabled: false },
  });
  db = await runtime.getD1Database("DB");
  const migration = await readFile(
    new URL("../../infra/migrations/0001_accounts_sync.sql", root),
    "utf8",
  );
  await db.batch(unstable_splitSqlQuery(migration).map((statement) => db.prepare(statement)));
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email_key,email,created_at) VALUES('account','key','test@example.invalid',?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,device_id,created_at,expires_at) VALUES(?,'account','desktop','csrf','device',?,?)",
      )
      .bind(hash(token), now, now + 1000),
    db
      .prepare(
        "INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen,approved_at) VALUES('device','account','Test PC','windows','public','123456',?,?,?)",
      )
      .bind(now, now, now),
    db.prepare("INSERT INTO user_keys VALUES('account',1,'verifier','{}',?,'device')").bind(now),
  ]);
});
after(async () => {
  await runtime?.dispose();
});

const request = (path, method = "GET", body, headers = {}) =>
  runtime.dispatchFetch(`https://auracode.test/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "CF-Connecting-IP": "127.0.0.1",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("compiled Worker serializes sync booleans, preserves cursors and rejects cross-origin writes", async () => {
  const record = {
    collection: "chats",
    id: "chat",
    hlc: `${now * 1000}:0000000001:device`,
    deleted: false,
    nonce: Buffer.alloc(24).toString("base64url"),
    ciphertext: Buffer.alloc(16, 4).toString("base64url"),
    key_version: 1,
  };
  const pushed = await request("/sync", "POST", { records: [record] });
  assert.equal(pushed.status, 200, await pushed.clone().text());
  const { heads } = await pushed.json();
  assert.equal(heads[0].deleted, false);
  const pulled = await request("/sync?after=0");
  const changes = await pulled.json();
  assert.equal(changes.records.length, 1);
  assert.equal(changes.records[0].deleted, false);
  assert.equal(changes.next_cursor, heads[0].server_seq);
  const blocked = await request(
    "/sync",
    "POST",
    { records: [record] },
    { Origin: "https://attacker.invalid" },
  );
  assert.equal(blocked.status, 403);
});

test("private R2 routes enforce expected ETags and return the stored ciphertext", async () => {
  const blob = {
    nonce: Buffer.alloc(24).toString("base64url"),
    ciphertext: Buffer.alloc(32, 7).toString("base64url"),
    key_version: 1,
    expected_etag: null,
  };
  const created = await request("/blobs/image", "PUT", blob);
  assert.equal(created.status, 200, await created.clone().text());
  const { etag } = await created.json();
  assert.equal((await request("/blobs/image", "PUT", blob)).status, 409);
  const downloaded = await (await request("/blobs/image")).json();
  assert.equal(downloaded.ciphertext, blob.ciphertext);
  assert.equal(downloaded.etag, etag);
  assert.equal(downloaded.object_key, undefined);
});

test("two concurrent valid code submissions create only one authenticated session", async () => {
  const challenge = Buffer.alloc(32, 3).toString("base64url");
  const emailKey = "synthetic-email-key";
  await db
    .prepare(
      "INSERT INTO auth_challenges(id,email_key,email,verifier,client_kind,created_at,expires_at,delivery) VALUES(?,?,?,?, 'desktop',?,?,'sent')",
    )
    .bind(
      challenge,
      emailKey,
      "second@example.invalid",
      verifier("code", [challenge, emailKey, "123456"]),
      now,
      now + 600,
    )
    .run();
  const responses = await Promise.all(
    [1, 2].map(() => request("/auth/verify", "POST", { challenge_id: challenge, code: "123456" })),
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const winner = await responses.find((response) => response.status === 200).json();
  assert.equal(Buffer.from(winner.token, "base64url").length, 32);
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id=?")
    .bind(winner.user_id)
    .first();
  assert.equal(row.count, 1);
});

test("browser cookie mutations require both same Origin and matching CSRF", async () => {
  const browser = Buffer.alloc(32, 5).toString("base64url");
  const csrf = verifier("csrf", [browser]);
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES(?,'account','browser',?,?,?)",
    )
    .bind(hash(browser), hash(csrf), now, now + 1000)
    .run();
  const call = (headers) =>
    runtime.dispatchFetch("https://auracode.test/api/v1/auth/logout", {
      method: "POST",
      headers: { Cookie: `__Host-auracode=${browser}`, ...headers },
    });
  assert.equal((await call({ Origin: "https://auracode.test" })).status, 403);
  assert.equal((await call({ "X-Auracode-CSRF": csrf })).status, 403);
  assert.equal(
    (await call({ Origin: "https://auracode.test", "X-Auracode-CSRF": csrf })).status,
    200,
  );
  assert.equal(
    (await call({ Origin: "https://auracode.test", "X-Auracode-CSRF": csrf })).status,
    401,
  );
});
