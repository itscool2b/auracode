// Platform fixtures only: authorization and authentication execute in the compiled Rust Worker.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

const root = new URL("../", import.meta.url);
const secret = Buffer.alloc(32, 51);
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const verifier = (domain, fields) => {
  const mac = createHmac("sha256", secret).update(domain);
  for (const field of fields) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(Buffer.byteLength(field)));
    mac.update(length).update(field);
  }
  return mac.digest("base64url");
};
const owner = "invited@example.invalid";
const changed = "changed@example.invalid";
const outsider = "outsider@example.invalid";
const now = Math.floor(Date.now() / 1000);

test("private preview gates the compiled Worker without trapping existing account management", async (t) => {
  let providerCalls = 0;
  let tokenNumber = 0;
  const options = (allowlist) => ({
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
        AUTH_HMAC_KEY: secret.toString("base64url"),
        TURNSTILE_SECRET: "synthetic-provider-secret",
        EMAIL_FROM: "signin@auracode.test",
        ...(allowlist === undefined ? {} : { CLOUD_ACCOUNT_ALLOWLIST: allowlist }),
      },
      // Miniflare captures mail locally. There is no remote binding or delivery service.
      email: {
        send_email: [{ name: "EMAIL", allowed_sender_addresses: ["signin@auracode.test"] }],
      },
      async outboundService(request) {
        assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        const body = await request.json();
        assert.equal(body.secret, "synthetic-provider-secret");
        assert.ok(body.response.startsWith("synthetic-"));
        providerCalls++;
        return Response.json({ success: true, hostname: "auracode.test", action: "signin" });
      },
    }),
    cf: false,
    host: "127.0.0.1",
    port: 0,
    telemetry: { enabled: false },
  });
  const runtime = new Miniflare(options(JSON.stringify([owner, changed])));
  t.after(() => runtime.dispose());
  let db = await runtime.getD1Database("DB");
  const migrations = new URL("../../infra/migrations/", root);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = await readFile(new URL(name, migrations), "utf8");
    await db.batch(unstable_splitSqlQuery(migration).map((sql) => db.prepare(sql)));
  }
  const configure = async (value) => {
    await runtime.setOptions(options(value));
    db = await runtime.getD1Database("DB");
  };
  const call = (path, method = "GET", body, token) =>
    runtime.dispatchFetch(`https://auracode.test/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "127.0.0.1",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const begin = (email) =>
    call("/auth/challenges", "POST", {
      email,
      client_kind: "desktop",
      turnstile_token: `synthetic-${++tokenNumber}`,
    });
  const expectError = async (response, status, error) => {
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await response.json()).error, error);
  };
  const proof = async (id) => {
    const row = await db
      .prepare("SELECT email_key,delivery FROM auth_challenges WHERE id=?")
      .bind(id)
      .first();
    assert.equal(row.delivery, "sent");
    const code = "123456";
    await db
      .prepare("UPDATE auth_challenges SET verifier=? WHERE id=?")
      .bind(verifier("code", [id, row.email_key, code]), id)
      .run();
    return { challenge_id: id, code };
  };
  let session;

  await t.test(
    "unknown excluded email is answered only after the bot check, without delivery or account writes",
    async () => {
      const before = providerCalls;
      await expectError(await begin(outsider), 403, "invite_required");
      // Membership is never revealed without a verified Turnstile token and the IP limit.
      assert.equal(providerCalls, before + 1);
      for (const table of ["auth_challenges", "users", "sessions"]) {
        assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0);
      }
      // Only the keyed per-IP counter exists. No per-address limit row was created.
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM rate_limits").first()).n, 1);
      await expectError(
        await call("/auth/challenges", "POST", {
          email: outsider,
          client_kind: "desktop",
          turnstile_token: "",
        }),
        400,
        "invalid_request",
      );
      const config = await (await call("/config")).json();
      assert.equal(config.private_preview, true);
      assert.equal(JSON.stringify(config).includes("@"), false);
    },
  );

  await t.test(
    "invited normalized address completes local delivery and single-use verification",
    async () => {
      const response = await begin(" INVITED@EXAMPLE.INVALID ");
      assert.equal(response.status, 200, await response.clone().text());
      const input = await proof((await response.json()).challenge_id);
      const verified = await call("/auth/verify", "POST", input);
      assert.equal(verified.status, 200, await verified.clone().text());
      session = await verified.json();
      assert.equal(
        (await db.prepare("SELECT email FROM users WHERE id=?").bind(session.user_id).first())
          .email,
        owner,
      );
      assert.equal((await call("/devices", "GET", undefined, session.token)).status, 200);
      await expectError(await call("/auth/verify", "POST", input), 400, "invalid_code");
    },
  );

  await t.test(
    "invitation removal between initiation and verification cannot create an account",
    async () => {
      const response = await begin(changed);
      assert.equal(response.status, 200);
      const input = await proof((await response.json()).challenge_id);
      await configure(JSON.stringify([owner]));
      await expectError(await call("/auth/verify", "POST", input), 403, "invite_required");
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").bind(changed).first()).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT consumed_at FROM auth_challenges WHERE id=?")
            .bind(input.challenge_id)
            .first()
        ).consumed_at,
        null,
      );
    },
  );

  await t.test(
    "missing, empty and malformed configuration fail closed for new and existing auth/cloud",
    async () => {
      for (const value of [undefined, "", "[]", "null", '["invited@example.invalid","invalid"]']) {
        await configure(value);
        const before = providerCalls;
        await expectError(await begin(owner), 503, "unavailable");
        await expectError(
          await call("/auth/verify", "POST", {
            challenge_id: Buffer.alloc(32, 1).toString("base64url"),
            code: "123456",
          }),
          503,
          "unavailable",
        );
        await expectError(
          await call("/devices", "GET", undefined, session.token),
          503,
          "unavailable",
        );
        assert.equal(providerCalls, before);
      }
      const exported = await call("/account/export", "GET", undefined, session.token);
      assert.equal(exported.status, 200);
      await exported.text();
    },
  );

  await t.test(
    "current invitation gates an approved device and direct tokens without deleting data",
    async () => {
      await configure(JSON.stringify([changed]));
      await db.batch([
        db
          .prepare(
            "INSERT INTO devices(id,user_id,name,platform,public_key,verification_code,created_at,last_seen,approved_at) VALUES('owned-device',?,'Synthetic','windows','public','123456',?,?,?)",
          )
          .bind(session.user_id, now, now, now),
        db
          .prepare("UPDATE sessions SET device_id='owned-device' WHERE token_hash=?")
          .bind(hash(session.token)),
        db
          .prepare("INSERT INTO user_keys VALUES(?,1,'verifier','{}',?,'owned-device')")
          .bind(session.user_id, now),
      ]);
      for (const [path, method, body] of [
        ["/sync", "GET"],
        ["/sync", "POST", { records: [] }],
        ["/devices", "GET"],
        ["/devices", "POST", {}],
        ["/keys", "GET"],
        ["/keys", "POST", {}],
        ["/devices/rebind/challenges", "POST", {}],
        ["/devices/recover", "POST", {}],
        ["/sync/reset/review", "POST", {}],
        ["/sync/reset", "POST", {}],
        ["/blobs/owned", "GET"],
        ["/blobs/owned", "PUT", {}],
        ["/account/email/challenges", "POST", {}],
      ]) {
        await expectError(await call(path, method, body, session.token), 403, "invite_required");
      }
      for (const path of ["/account", "/auth/session", "/account/export"]) {
        const response = await call(path, "GET", undefined, session.token);
        assert.equal(response.status, 200);
        await response.text();
      }
      assert.equal(
        (
          await db
            .prepare("SELECT deletion_requested_at FROM users WHERE id=?")
            .bind(session.user_id)
            .first()
        ).deletion_requested_at,
        null,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM user_keys WHERE user_id=?")
            .bind(session.user_id)
            .first()
        ).n,
        1,
      );
      // Re-invitation restores access without recreating the user's account, keys or session.
      await configure(JSON.stringify([owner, changed]));
      assert.equal((await call("/devices", "GET", undefined, session.token)).status, 200);
    },
  );

  await t.test(
    "email changes require both current and target eligibility at initiation and consumption",
    async () => {
      await expectError(
        await call(
          "/account/email/challenges",
          "POST",
          { email: outsider, turnstile_token: "synthetic-denied-change" },
          session.token,
        ),
        403,
        "invite_required",
      );
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM email_changes").first()).n, 0);
      const challenge = Buffer.alloc(32, 60).toString("base64url");
      const emailKey = verifier("email", [changed]);
      await db
        .prepare(
          "INSERT INTO email_changes(id,session_hash,user_id,email,email_key,verifier,created_at,expires_at,delivery) VALUES(?,?,?,?,?,?,?,?,'sent')",
        )
        .bind(
          challenge,
          hash(session.token),
          session.user_id,
          changed,
          emailKey,
          verifier("email-change", [challenge, hash(session.token), emailKey, "123456"]),
          now,
          now + 600,
        )
        .run();
      await configure(JSON.stringify([owner]));
      await expectError(
        await call(
          "/account/email/verify",
          "POST",
          { challenge_id: challenge, code: "123456" },
          session.token,
        ),
        403,
        "invite_required",
      );
      assert.equal(
        (await db.prepare("SELECT email FROM users WHERE id=?").bind(session.user_id).first())
          .email,
        owner,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT consumed_by FROM email_changes WHERE id=?")
            .bind(challenge)
            .first()
        ).consumed_by,
        null,
      );
    },
  );

  await t.test(
    "excluded existing users may reauthenticate for export, logout and fresh deletion",
    async () => {
      await configure(JSON.stringify([changed]));
      // The prior challenge is older than the resend window; no real time or retries are needed.
      await db
        .prepare("UPDATE auth_challenges SET created_at=created_at-61 WHERE email=?")
        .bind(owner)
        .run();
      const response = await begin(owner);
      assert.equal(response.status, 200, await response.clone().text());
      const verified = await call(
        "/auth/verify",
        "POST",
        await proof((await response.json()).challenge_id),
      );
      assert.equal(verified.status, 200, await verified.clone().text());
      const management = await verified.json();
      assert.equal(management.user_id, session.user_id);
      await expectError(
        await call("/devices", "GET", undefined, management.token),
        403,
        "invite_required",
      );
      assert.equal((await call("/auth/logout", "POST", {}, session.token)).status, 200);
      const exported = await call("/account/export", "GET", undefined, management.token);
      assert.equal(exported.status, 200);
      assert.ok((await exported.text()).includes('"complete"'));
      assert.equal((await call("/account", "DELETE", undefined, management.token)).status, 200);
      await expectError(await begin(owner), 403, "invite_required");
    },
  );

  await t.test(
    "deletion during code consumption cannot recreate an uninvited existing account",
    async () => {
      const doomed = "doomed@example.invalid";
      await db
        .prepare("INSERT INTO users(id,email_key,email,created_at) VALUES('doomed','doomed',?,?)")
        .bind(doomed, now)
        .run();
      const response = await begin(doomed);
      assert.equal(response.status, 200);
      const input = await proof((await response.json()).challenge_id);
      // The policy read sees a live account, then deletion races inside the verification batch.
      await db
        .prepare(
          "CREATE TRIGGER delete_during_verification AFTER UPDATE ON auth_challenges WHEN NEW.email='doomed@example.invalid' AND NEW.consumed_by IS NOT NULL BEGIN DELETE FROM users WHERE id='doomed'; END",
        )
        .run();
      await expectError(await call("/auth/verify", "POST", input), 400, "invalid_code");
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").bind(doomed).first()).n,
        0,
      );
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='doomed'").first()).n,
        0,
      );
    },
  );
});
