// The browser's half of the remote channel, held to the vectors the desktop's half is held to.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Channel, decode, encode, importSecret, randomBytes } from "../app/remote/channel.ts";

interface Vectors {
  secret: string;
  client_nonce: string;
  host_nonce: string;
  context: string;
  client_to_host: [string, string][];
  host_to_client: [string, string][];
}

const vectors: Vectors = JSON.parse(
  await readFile(new URL("../../../crates/o7-remote/tests/vectors.json", import.meta.url), "utf8"),
);

async function channels(context = vectors.context, secret = vectors.secret) {
  const key = await importSecret(decode(secret, 32)!);
  const client = decode(vectors.client_nonce, 16)!;
  const host = decode(vectors.host_nonce, 16)!;
  return {
    client: await Channel.create("client", key, client, host, context),
    host: await Channel.create("host", key, client, host, context),
  };
}

test("seals and opens exactly what the desktop does", async () => {
  const { client, host } = await channels();
  assert.ok(vectors.client_to_host.length >= 3 && vectors.host_to_client.length >= 3);
  for (const [plain, sealed] of vectors.client_to_host) {
    assert.equal(await client.seal(plain), sealed);
    assert.equal(await host.open(sealed), plain);
  }
  for (const [plain, sealed] of vectors.host_to_client) {
    assert.equal(await host.seal(plain), sealed);
    assert.equal(await client.open(sealed), plain);
  }
});

test("opens only the next message, sealed with the same key for the same credential", async () => {
  const { client, host } = await channels();
  const first = await client.seal("one");
  const second = await client.seal("two");
  // Out of order, replayed, echoed back or changed: all refused, and nothing is lost.
  await assert.rejects(host.open(second));
  await assert.rejects(client.open(first));
  const changed = decode(first)!;
  changed[0] ^= 1;
  await assert.rejects(host.open(encode(changed)));
  await assert.rejects(host.open("not base64!"));
  assert.equal(await host.open(first), "one");
  await assert.rejects(host.open(first));
  assert.equal(await host.open(second), "two");

  const sealed = await (await channels()).client.seal("for this device");
  await assert.rejects((await channels("device|another")).host.open(sealed));
  await assert.rejects(
    (await channels(vectors.context, encode(new Uint8Array(32)))).host.open(sealed),
  );
  assert.equal(await (await channels()).host.open(sealed), "for this device");
});

test("a stored key can be used and never read", async () => {
  const key = await importSecret(randomBytes(32));
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
});

test("ids and keys decode only in their one canonical spelling", () => {
  const key = randomBytes(32);
  const text = encode(key);
  assert.equal(text.length, 43);
  assert.deepEqual(decode(text, 32), key);
  assert.equal(decode(text, 16), null);
  assert.equal(decode(`${text}=`), null);
  assert.equal(decode("a+b/"), null);
  assert.equal(decode("A"), null);
  assert.deepEqual(decode("AA"), new Uint8Array([0]));
  assert.equal(decode("AB"), null);
  assert.deepEqual(decode(""), new Uint8Array(0));
});
