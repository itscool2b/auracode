// Platform integration tests only. All backend behavior under test is the compiled Rust Worker.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
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
const turnstileSeen = new Set();

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
      // Only this synthetic provider response is allowed. No request reaches the network.
      async outboundService(request) {
        assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        const input = await request.json();
        assert.equal(input.secret, "synthetic-unused");
        assert.equal(input.remoteip, "127.0.0.1");
        const token = input.response;
        assert.ok(token.startsWith("synthetic-"));
        const replayed = turnstileSeen.has(token);
        turnstileSeen.add(token);
        return Response.json(
          {
            success: !replayed && token !== "synthetic-rejected",
            hostname: token === "synthetic-wrong-host" ? "foreign.invalid" : "auracode.test",
            action: token === "synthetic-wrong-action" ? "different-action" : "signin",
          },
          { status: token === "synthetic-unavailable" ? 503 : 200 },
        );
      },
    }),
    cf: false,
    telemetry: { enabled: false },
  });
  db = await runtime.getD1Database("DB");
  const migrations = new URL("../../infra/migrations/", root);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = await readFile(new URL(name, migrations), "utf8");
    await db.batch(unstable_splitSqlQuery(migration).map((statement) => db.prepare(statement)));
  }
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

test("retained-device proof binds only its fresh desktop session and cannot be replayed", async () => {
  const fresh = Buffer.alloc(32, 10).toString("base64url");
  const challenge = Buffer.alloc(32, 11).toString("base64url");
  const proof = Buffer.alloc(32, 12).toString("base64url");
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES(?,'account','desktop','csrf',?,?)",
    )
    .bind(hash(fresh), now, now + 1000)
    .run();
  // Fixed synthetic challenge fixture. Rust unit tests cover sealing, low-order keys and AAD.
  await db
    .prepare(
      "INSERT INTO device_rebind_challenges(id,session_hash,device_id,verifier,created_at,expires_at) VALUES(?,?,'device',?,?,?)",
    )
    .bind(challenge, hash(fresh), verifier("device-rebind", [challenge, proof]), now, now + 300)
    .run();
  const call = (proof) =>
    request(
      "/devices/rebind/verify",
      "POST",
      { challenge_id: challenge, proof },
      { Authorization: `Bearer ${fresh}` },
    );
  assert.equal((await call(Buffer.alloc(32, 13).toString("base64url"))).status, 403);
  const response = await call(proof);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { device_id: "device", rebound: true });
  assert.equal((await call(proof)).status, 403);
});

test("account export streams ciphertext with a completion marker and no session secrets", async () => {
  const response = await request("/account/export");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition"), /attachment/);
  const text = await response.text();
  const lines = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines[0].type, "account");
  assert.equal(lines[0].account.email, "test@example.invalid");
  assert.equal(lines.at(-1).type, "complete");
  assert.ok(
    lines.some((line) => line.type === "record" && typeof line.record.deleted === "boolean"),
  );
  assert.ok(lines.some((line) => line.type === "blob" && line.blob.ciphertext));
  assert.equal(text.includes("object_key"), false);
  assert.equal(text.includes("csrf_hash"), false);
  assert.equal(text.includes("recovery_verifier"), false);
  assert.equal(text.includes(token), false);
});

test("retained device lookup is targeted and scoped to its authenticated account", async () => {
  const response = await request("/devices/device");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).device.name, "Test PC");
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email_key,email,created_at) VALUES('foreign','foreign','foreign@example.invalid',?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen) VALUES('foreign-device','foreign','Other PC','windows','key','123456',?,?)",
      )
      .bind(now, now),
  ]);
  assert.equal((await request("/devices/foreign-device")).status, 404);
  assert.equal((await request("/devices/unknown-device")).status, 404);
});

test("verified email change preserves account data, revokes other sessions and refuses proof replay", async () => {
  const primary = Buffer.alloc(32, 20).toString("base64url");
  const secondary = Buffer.alloc(32, 21).toString("base64url");
  const challenge = Buffer.alloc(32, 22).toString("base64url");
  const email = "changed@example.invalid";
  const emailKey = verifier("email", [email]);
  const code = "654321";
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email_key,email,created_at) VALUES('change-account','change-old','old@example.invalid',?)",
      )
      .bind(now),
    ...[primary, secondary].map((value) =>
      db
        .prepare(
          "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES(?,'change-account','desktop','csrf',?,?)",
        )
        .bind(hash(value), now, now + 1000),
    ),
    db
      .prepare(
        "INSERT INTO email_changes(id,session_hash,user_id,email,email_key,verifier,created_at,expires_at,delivery) VALUES(?,?,'change-account',?,?,?,?,?,'sent')",
      )
      .bind(
        challenge,
        hash(primary),
        email,
        emailKey,
        verifier("email-change", [challenge, hash(primary), emailKey, code]),
        now,
        now + 600,
      ),
  ]);
  const call = (path, method, body, value = primary) =>
    request(path, method, body, { Authorization: `Bearer ${value}` });
  assert.equal(
    (await call("/account/email/verify", "POST", { challenge_id: challenge, code }, secondary))
      .status,
    400,
  );
  assert.equal(
    (await call("/account/email/verify", "POST", { challenge_id: challenge, code: "000000" }))
      .status,
    400,
  );
  const changed = await call("/account/email/verify", "POST", { challenge_id: challenge, code });
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await (await call("/account")).json()).account.email, email);
  assert.equal(
    (await call("/account/email/verify", "POST", { challenge_id: challenge, code })).status,
    400,
  );
  assert.equal((await call("/account", "GET", undefined, secondary)).status, 401);
  assert.equal((await call("/auth/logout-all", "POST")).status, 200);
  assert.equal((await call("/account")).status, 401);
});

test("sign-in rejects failed, wrong-site, wrong-action and replayed verification before creating a challenge", async () => {
  const begin = (turnstile_token) =>
    request("/auth/challenges", "POST", {
      email: "provider-check@example.invalid",
      client_kind: "desktop",
      turnstile_token,
    });
  for (const value of ["synthetic-rejected", "synthetic-wrong-host", "synthetic-wrong-action"])
    assert.equal((await begin(value)).status, 403);
  assert.equal((await begin("synthetic-unavailable")).status, 503);
  assert.equal(
    await db
      .prepare("SELECT COUNT(*) AS n FROM auth_challenges WHERE email=?")
      .bind("provider-check@example.invalid")
      .first("n"),
    0,
  );
  // An accepted provider proof reaches the deliberately unavailable email binding once.
  assert.equal((await begin("synthetic-once")).status, 503);
  assert.equal((await begin("synthetic-once")).status, 403);
  assert.equal(
    await db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email=?")
      .bind("provider-check@example.invalid")
      .first("n"),
    0,
  );
});

test("delivery failure leaves an unusable challenge and enforces a fresh-code cooldown", async () => {
  const email = "delivery-check@example.invalid";
  const begin = (turnstile_token) =>
    request("/auth/challenges", "POST", { email, client_kind: "desktop", turnstile_token });
  const failed = await begin("synthetic-delivery-first");
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "delivery_failed");
  assert.equal(failed.headers.get("Retry-After"), "60");
  const row = await db
    .prepare("SELECT id,email_key,delivery FROM auth_challenges WHERE email=?")
    .bind(email)
    .first();
  assert.equal(row.delivery, "failed");
  const code = "012345";
  await db
    .prepare("UPDATE auth_challenges SET verifier=? WHERE id=?")
    .bind(verifier("code", [row.id, row.email_key, code]), row.id)
    .run();
  assert.equal((await request("/auth/verify", "POST", { challenge_id: row.id, code })).status, 400);
  assert.equal((await begin("synthetic-delivery-cooldown")).status, 429);
  await db
    .prepare("UPDATE auth_challenges SET created_at=created_at-61 WHERE id=?")
    .bind(row.id)
    .run();
  assert.equal((await begin("synthetic-delivery-retry")).status, 503);
  const replacement = await db
    .prepare("SELECT id,delivery,attempts FROM auth_challenges WHERE email=?")
    .bind(email)
    .first();
  assert.notEqual(replacement.id, row.id);
  assert.equal(replacement.delivery, "failed");
  assert.equal(replacement.attempts, 0);
  assert.equal((await request("/auth/verify", "POST", { challenge_id: row.id, code })).status, 400);
});

test("browser verification emits a protected cookie and never returns its session token in JSON", async () => {
  const challenge = Buffer.alloc(32, 40).toString("base64url");
  const email = "cookie-check@example.invalid";
  const emailKey = verifier("email", [email]);
  const code = "246810";
  await db
    .prepare(
      "INSERT INTO auth_challenges(id,email_key,email,verifier,client_kind,created_at,expires_at,delivery) VALUES(?,?,?,?,'browser',?,?,'sent')",
    )
    .bind(challenge, emailKey, email, verifier("code", [challenge, emailKey, code]), now, now + 600)
    .run();
  const payload = { challenge_id: challenge, code };
  assert.equal((await request("/auth/verify", "POST", payload)).status, 403);
  const response = await request("/auth/verify", "POST", payload, {
    Origin: "https://auracode.test",
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.token, null);
  const cookie = response.headers.get("Set-Cookie");
  assert.match(cookie, /^__Host-auracode=[A-Za-z0-9_-]+;/);
  for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"])
    assert.ok(cookie.includes(attribute));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("account deletion immediately revokes access and scheduled cleanup only purges its owned ciphertext", async () => {
  const value = Buffer.alloc(32, 50).toString("base64url");
  await db.batch([
    db
      .prepare(
        "INSERT INTO users(id,email_key,email,created_at) VALUES('cleanup-account','cleanup-key','cleanup@example.invalid',?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,client_kind,csrf_hash,created_at,expires_at) VALUES(?,'cleanup-account','desktop','csrf',?,?)",
      )
      .bind(hash(value), now - 301, now + 1000),
  ]);
  const call = (path, method = "GET") =>
    request(path, method, undefined, { Authorization: `Bearer ${value}` });
  assert.equal((await call("/account", "DELETE")).status, 403);
  await db
    .prepare("UPDATE sessions SET created_at=? WHERE token_hash=?")
    .bind(now, hash(value))
    .run();
  const bucket = await runtime.getR2Bucket("BLOBS");
  await bucket.put("cleanup-account/owned", "synthetic ciphertext");
  await bucket.put("foreign/keep", "foreign ciphertext");
  assert.equal((await call("/account", "DELETE")).status, 200);
  assert.equal((await call("/account")).status, 401);
  assert.equal((await call("/sync")).status, 401);
  const worker = await runtime.getWorker();
  assert.equal((await worker.scheduled({ cron: "*/5 * * * *" })).outcome, "ok");
  assert.equal(await bucket.get("cleanup-account/owned"), null);
  assert.equal(await (await bucket.get("foreign/keep")).text(), "foreign ciphertext");
  const tombstone = await db
    .prepare("SELECT email,purged_at FROM users WHERE id='cleanup-account'")
    .first();
  assert.equal(tombstone.email, "deleted-cleanup-account@invalid");
  assert.ok(tombstone.purged_at);
  assert.equal(
    await db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='cleanup-account'")
      .first("n"),
    0,
  );
  // An upload already in flight at revocation is caught by a later retained-prefix scan.
  await bucket.put("cleanup-account/late", "late ciphertext");
  await db.prepare("UPDATE users SET cleanup_after=0 WHERE id='cleanup-account'").run();
  await worker.scheduled({ cron: "*/5 * * * *" });
  assert.equal(await bucket.get("cleanup-account/late"), null);
  assert.ok(await bucket.get("foreign/keep"));
});
