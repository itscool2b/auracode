// The relay in the Workers runtime: real Durable Object sockets, no network.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const ORIGIN = "https://auracode.test";
const BASE = `${ORIGIN}/api/remote/v1`;
const id = (bytes) => randomBytes(bytes).toString("base64url");
/** A computer's id is the start of a hash of its key. */
const idOf = (key) =>
  createHash("sha256")
    .update("auracode remote v1 host id")
    .update(Buffer.from(key, "base64url"))
    .digest()
    .subarray(0, 16)
    .toString("base64url");
const hash = (text) => createHash("sha256").update(text).digest("base64url");
let runtime;

before(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: [
        {
          type: "ESModule",
          path: "index.js",
          contents: await readFile(
            fileURLToPath(new URL("../build/index.js", import.meta.url)),
            "utf8",
          ),
        },
      ],
      compatibilityDate: "2026-10-26",
      durableObjects: { ROOMS: { className: "Room", useSQLite: true } },
      bindings: { APP_ORIGIN: ORIGIN },
    }),
  );
  await runtime.ready;
});

after(async () => {
  await runtime?.dispose();
});

/** A socket with its messages queued, so a test reads them in order. */
function reader(socket) {
  const queue = [];
  const waiting = [];
  let closed = null;
  const push = (item) => {
    const next = waiting.shift();
    if (next) next(item);
    else queue.push(item);
  };
  socket.addEventListener("message", (event) => push({ data: event.data }));
  socket.addEventListener("close", (event) => {
    closed = { code: event.code };
    push({ closed });
    // A browser completes the closing handshake by itself; this socket has to be told to.
    try {
      socket.close(event.code, "closing");
    } catch {
      // Already closed from this side.
    }
  });
  socket.accept();
  const next = () => {
    // Made here, so a timeout names the line that was waiting.
    const late = new Error("no message within 3s");
    return new Promise((resolve, reject) => {
      const item = queue.shift();
      if (item) return resolve(item);
      const timer = setTimeout(() => reject(late), 3000);
      waiting.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  };
  return {
    socket,
    send: (text) => socket.send(text),
    close: (code = 1000) => socket.close(code, "done"),
    async message() {
      const item = await next();
      assert.ok("data" in item, `socket closed (${item.closed?.code}) instead of a message`);
      return item.data;
    },
    async closing() {
      for (;;) {
        const item = await next();
        if (item.closed) return item.closed.code;
      }
    },
    async quiet(ms = 150) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      assert.deepEqual(queue, [], "unexpected messages");
    },
  };
}

async function upgrade(path, headers = {}) {
  return runtime.dispatchFetch(`${BASE}/${path}`, {
    headers: { Upgrade: "websocket", ...headers },
  });
}

async function host(hostId, key) {
  const response = await upgrade(`host/${hostId}`, { Authorization: `Bearer ${key}` });
  assert.equal(response.status, 101);
  return reader(response.webSocket);
}

async function client(hostId) {
  const response = await upgrade(`client/${hostId}`, { Origin: ORIGIN });
  assert.equal(response.status, 101);
  return reader(response.webSocket);
}

const mcp = (hostId, reference, body, init = {}) =>
  runtime.dispatchFetch(`${BASE}/mcp/${hostId}/${reference}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("reports health and hides everything else", async () => {
  const health = await runtime.dispatchFetch(`${BASE}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, protocol: 1, tools: 8, full_tools: 21 });
  assert.equal(health.headers.get("cache-control"), "no-store");
  for (const path of ["", "nothing", "host", "host/short", `other/${id(16)}`])
    assert.equal((await runtime.dispatchFetch(`${BASE}/${path}`)).status, 404, path);
  assert.equal((await runtime.dispatchFetch(`${ORIGIN}/api/v1/config`)).status, 404);
});

test("only the desktop that claimed an id can hold its host socket", async () => {
  const key = id(32);
  const hostId = idOf(key);
  // Nothing is behind an id no desktop has claimed.
  assert.equal((await upgrade(`client/${hostId}`, { Origin: ORIGIN })).status, 404);
  assert.equal((await upgrade(`host/${hostId}`)).status, 401);
  assert.equal((await upgrade(`host/${hostId}`, { Authorization: "Bearer short" })).status, 401);
  // A browser cannot open a host socket, and a plain request is not a socket.
  assert.equal(
    (await upgrade(`host/${hostId}`, { Authorization: `Bearer ${key}`, Origin: ORIGIN })).status,
    400,
  );
  assert.equal((await runtime.dispatchFetch(`${BASE}/host/${hostId}`)).status, 400);
  const first = await host(hostId, key);
  assert.equal(
    (await upgrade(`host/${hostId}`, { Authorization: `Bearer ${id(32)}` })).status,
    401,
    "another key took over a claimed id",
  );
  first.close();
  await first.closing();
  // The same key connects again after the socket closed.
  (await host(hostId, key)).close();
});

test("a computer's id is made from its key, so nobody can take it", async () => {
  // Someone who knows a computer's id, but not its key, gets there first with a key of their own.
  const key = id(32);
  const hostId = idOf(key);
  const theirs = id(32);
  assert.equal(
    (await upgrade(`host/${hostId}`, { Authorization: `Bearer ${theirs}` })).status,
    401,
    "an id was claimed with a key it is not made from",
  );
  // Nothing was claimed, and nothing stored: the id still has nothing behind it.
  assert.equal((await upgrade(`client/${hostId}`, { Origin: ORIGIN })).status, 404);
  // An id of their own choosing is no better, whatever key goes with it.
  assert.equal(
    (await upgrade(`host/${id(16)}`, { Authorization: `Bearer ${theirs}` })).status,
    401,
  );
  // The computer itself connects as always.
  (await host(hostId, key)).close();
});

test("a socket that has shown no key gets the handshake's few small messages", async () => {
  const key = id(32);
  const hostId = idOf(key);
  const desk = await host(hostId, key);
  // One large message: closed, and it never reaches the computer.
  const loud = await client(hostId);
  assert.equal(await loud.message(), "h1");
  const opened = await desk.message();
  assert.equal(opened[0], "o");
  loud.send(`m${"x".repeat(3000)}`);
  assert.equal(await loud.closing(), 1008);
  assert.equal(await desk.message(), `c${opened.slice(1)}`);
  // Many small ones: the first four pass, the fifth ends it.
  const chatty = await client(hostId);
  assert.equal(await chatty.message(), "h1");
  const cid = (await desk.message()).slice(1);
  for (let sent = 0; sent < 4; sent += 1) {
    chatty.send("mH{}");
    assert.equal(await desk.message(), `m${cid} H{}`);
  }
  chatty.send("mH{}");
  assert.equal(await chatty.closing(), 1008);
  assert.equal(await desk.message(), `c${cid}`);
  // Once the computer accepts a browser, it is held to the ordinary limits instead.
  const paired = await client(hostId);
  assert.equal(await paired.message(), "h1");
  const accepted = (await desk.message()).slice(1);
  desk.send(`a${accepted}`);
  await desk.quiet(100);
  for (let sent = 0; sent < 8; sent += 1) paired.send(`m${"y".repeat(4000)}`);
  for (let sent = 0; sent < 8; sent += 1)
    assert.equal((await desk.message()).length, `m${accepted} `.length + 4000);
  desk.close();
});

test("a browser socket needs the website's origin", async () => {
  const hostKey = id(32);
  const hostId = idOf(hostKey);
  (await host(hostId, hostKey)).close();
  assert.equal((await upgrade(`client/${hostId}`)).status, 403);
  assert.equal((await upgrade(`client/${hostId}`, { Origin: "https://evil.test" })).status, 403);
  assert.equal(
    (await runtime.dispatchFetch(`${BASE}/client/${hostId}`, { headers: { Origin: ORIGIN } }))
      .status,
    400,
  );
});

test("forwards a browser's messages to its desktop and back, and says who is there", async () => {
  const key = id(32);
  const hostId = idOf(key);
  const desk = await host(hostId, key);
  const phone = await client(hostId);
  assert.equal(await phone.message(), "h1");
  const opened = await desk.message();
  assert.match(opened, /^o[A-Za-z0-9_-]{16}$/);
  const cid = opened.slice(1);

  phone.send('mH{"v":1}');
  assert.equal(await desk.message(), `m${cid} H{"v":1}`);
  desk.send(`m${cid} W{"n":"a b c"}`);
  assert.equal(await phone.message(), 'mW{"n":"a b c"}');

  // A second browser has its own id, and neither sees the other's messages.
  const tablet = await client(hostId);
  assert.equal(await tablet.message(), "h1");
  const other = (await desk.message()).slice(1);
  assert.notEqual(other, cid);
  desk.send(`m${other} Etablet`);
  assert.equal(await tablet.message(), "mEtablet");
  await phone.quiet();

  // Keep-alives are answered by the relay.
  phone.send("ping");
  assert.equal(await phone.message(), "pong");
  desk.send("ping");
  assert.equal(await desk.message(), "pong");

  // The desktop can end one browser's connection.
  desk.send(`c${other}`);
  assert.equal(await tablet.message(), "x");
  tablet.close();
  desk.send(`m${other} Egone`);
  assert.equal(await desk.message(), `c${other}`);

  // A browser that leaves is reported, and messages for it come back as closed.
  phone.close();
  assert.equal(await desk.message(), `c${cid}`);
  desk.send(`m${cid} Elate`);
  assert.equal(await desk.message(), `c${cid}`);
  desk.close();
});

test("tells browsers when the desktop goes and comes back", async () => {
  const key = id(32);
  const hostId = idOf(key);
  const desk = await host(hostId, key);
  const phone = await client(hostId);
  assert.equal(await phone.message(), "h1");
  const cid = (await desk.message()).slice(1);
  desk.close();
  assert.equal(await phone.message(), "h0");
  phone.send("mEwhile away");
  assert.equal(await phone.message(), "h0");

  const back = await host(hostId, key);
  assert.equal(await phone.message(), "h1");
  assert.equal(await back.message(), `o${cid}`);

  // A second host socket replaces the first; the browser starts its session again.
  const replacement = await host(hostId, key);
  assert.equal(await back.message(), "x");
  assert.equal(await phone.message(), "h0");
  assert.equal(await phone.message(), "h1");
  assert.equal(await replacement.message(), `o${cid}`);
  phone.send("mEagain");
  assert.equal(await replacement.message(), `m${cid} Eagain`);
  await phone.quiet();

  // A browser that connects while the desktop is away waits for it.
  replacement.close();
  assert.equal(await phone.message(), "h0");
  const late = await client(hostId);
  assert.equal(await late.message(), "h0");
  const again = await host(hostId, key);
  assert.equal(await late.message(), "h1");
  assert.equal(await phone.message(), "h1");
  again.close();
});

test("refuses what a browser should not send", async () => {
  const hostKey = id(32);
  const hostId = idOf(hostKey);
  const desk = await host(hostId, hostKey);
  const noisy = await client(hostId);
  await noisy.message();
  await desk.message();
  noisy.send("xnot a message");
  assert.equal(await noisy.closing(), 1008);
  await desk.message();

  const large = await client(hostId);
  await large.message();
  await desk.message();
  large.send(`m${"a".repeat(96 * 1024)}`);
  assert.equal(await large.closing(), 1009);
  await desk.message();

  const flood = await client(hostId);
  await flood.message();
  await desk.message();
  for (let sent = 0; sent < 241; sent += 1) flood.send("mE");
  assert.equal(await flood.closing(), 1008);
  desk.close();
});

test("serves a bot's MCP calls through the desktop", async () => {
  const hostKey = id(32);
  const hostId = idOf(hostKey);
  const bot = id(8);
  const token = id(32);
  const reference = `${bot}.${token}`;
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  };

  // No such link until the desktop lists it.
  const desk = await host(hostId, hostKey);
  assert.equal((await mcp(hostId, reference, initialize)).status, 404);
  // A second link, made with full control. Anything but `true` is not full control.
  const wide = id(8);
  const wideToken = id(32);
  desk.send(
    `l${JSON.stringify([
      { id: bot, hash: hash(token), full: "yes" },
      { id: wide, hash: hash(wideToken), full: true },
      { id: "bad", hash: "bad", full: true },
    ])}`,
  );
  await desk.quiet(100);
  assert.equal((await mcp(hostId, `${bot}.${id(32)}`, initialize)).status, 404);
  assert.equal((await mcp(hostId, `${id(8)}.${token}`, initialize)).status, 404);
  assert.equal((await mcp(id(16), reference, initialize)).status, 404);

  const started = await mcp(hostId, reference, initialize);
  assert.equal(started.status, 200);
  assert.equal(started.headers.get("access-control-allow-origin"), "*");
  const hello = await started.json();
  assert.equal(hello.result.protocolVersion, "2025-06-18");
  assert.deepEqual(hello.result.capabilities, { tools: { listChanged: false } });
  assert.equal(hello.result.serverInfo.name, "auracode");
  assert.match(hello.result.instructions, /list_chats/);
  // An unknown protocol version gets the newest one this server speaks.
  const newer = await (
    await mcp(hostId, reference, { ...initialize, params: { protocolVersion: "2099-01-01" } })
  ).json();
  assert.equal(newer.result.protocolVersion, "2025-11-25");

  // The token may travel in the Authorization header instead of the URL.
  const byHeader = await mcp(
    hostId,
    bot,
    { jsonrpc: "2.0", id: 2, method: "ping" },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.deepEqual(await byHeader.json(), { jsonrpc: "2.0", id: 2, result: {} });

  const listed = await (
    await mcp(hostId, reference, { jsonrpc: "2.0", id: "a", method: "tools/list" })
  ).json();
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      "list_chats",
      "list_projects",
      "read_chat",
      "send_message",
      "wait_for_chat",
      "respond_to_request",
      "stop_chat",
      "start_chat",
    ],
  );
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description.length > 40);
  }
  // A link without full control is not shown the wider tools, and they do not exist for it:
  // nothing reaches the desktop.
  const refused = await (
    await mcp(hostId, reference, {
      jsonrpc: "2.0",
      id: "w",
      method: "tools/call",
      params: { name: "set_access", arguments: { chat_id: "c1", access: "full_auto" } },
    })
  ).json();
  assert.equal(refused.error.code, -32602);
  await desk.quiet(100);
  // The full-control link is shown all of them, each a plain MCP tool with no mark of ours.
  const everything = await (
    await mcp(hostId, `${wide}.${wideToken}`, { jsonrpc: "2.0", id: "b", method: "tools/list" })
  ).json();
  const names = everything.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 21);
  assert.deepEqual(
    names.slice(0, 8),
    listed.result.tools.map((tool) => tool.name),
  );
  for (const name of [
    "create_project",
    "chat_options",
    "set_model",
    "set_thinking",
    "set_access",
    "switch_agent",
    "rename_chat",
    "archive_chat",
    "start_agent",
    "list_changes",
    "read_change",
    "read_memory",
    "write_memory",
  ])
    assert.ok(names.includes(name), name);
  for (const tool of everything.result.tools) {
    assert.equal("full" in tool, false, tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.description.length > 20, tool.name);
  }
  const widened = mcp(hostId, `${wide}.${wideToken}`, {
    jsonrpc: "2.0",
    id: "c",
    method: "tools/call",
    params: { name: "set_access", arguments: { chat_id: "c1", access: "ask" } },
  });
  const passed = JSON.parse((await desk.message()).slice(1));
  assert.deepEqual(
    { ...passed, rid: "" },
    {
      rid: "",
      bot: wide,
      token: wideToken,
      tool: "set_access",
      args: { chat_id: "c1", access: "ask" },
    },
  );
  desk.send(`b${JSON.stringify({ rid: passed.rid, text: "Access is now ask.", error: false })}`);
  assert.equal((await (await widened).json()).result.isError, false);

  // Notifications get no body.
  const noted = await mcp(hostId, reference, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(noted.status, 202);
  assert.equal(await noted.text(), "");

  // A tool call is one request to the desktop, which answers it.
  const calling = mcp(hostId, reference, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "send_message", arguments: { chat_id: "c1", text: "Run the tests" } },
  });
  const asked = await desk.message();
  assert.equal(asked[0], "b");
  const call = JSON.parse(asked.slice(1));
  assert.deepEqual(
    { ...call, rid: "" },
    { rid: "", bot, token, tool: "send_message", args: { chat_id: "c1", text: "Run the tests" } },
  );
  desk.send(`b${JSON.stringify({ rid: call.rid, text: "Sent.", error: false })}`);
  assert.deepEqual(await (await calling).json(), {
    jsonrpc: "2.0",
    id: 3,
    result: { content: [{ type: "text", text: "Sent." }], isError: false },
  });

  // A batch answers each request and skips notifications.
  const batch = mcp(hostId, reference, [
    { jsonrpc: "2.0", id: 4, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/cancelled" },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_chats" } },
  ]);
  const second = JSON.parse((await desk.message()).slice(1));
  assert.deepEqual(second.args, {});
  desk.send(`b${JSON.stringify({ rid: second.rid, text: "Nothing is open.", error: true })}`);
  assert.deepEqual(await (await batch).json(), [
    { jsonrpc: "2.0", id: 4, result: {} },
    {
      jsonrpc: "2.0",
      id: 5,
      result: { content: [{ type: "text", text: "Nothing is open." }], isError: true },
    },
  ]);

  // What the server does not offer.
  const errors = [
    [{ jsonrpc: "2.0", id: 6, method: "resources/list" }, -32601],
    [{ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "rm_rf" } }, -32602],
    [
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "list_chats", arguments: [] },
      },
      -32602,
    ],
    [{ id: 9, method: "ping" }, -32600],
  ];
  for (const [message, code] of errors)
    assert.equal((await (await mcp(hostId, reference, message)).json()).error.code, code);
  assert.equal((await mcp(hostId, reference, "{nope")).status, 400);
  assert.equal((await mcp(hostId, reference, [])).status, 400);
  const got = await runtime.dispatchFetch(`${BASE}/mcp/${hostId}/${reference}`);
  assert.equal(got.status, 405);
  const preflight = await runtime.dispatchFetch(`${BASE}/mcp/${hostId}/${reference}`, {
    method: "OPTIONS",
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Mcp-Protocol-Version/);

  // A call waiting when the desktop leaves, and any call after, says the computer is away.
  const waiting = mcp(hostId, reference, {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "list_chats" },
  });
  await desk.message();
  desk.close();
  const dropped = await (await waiting).json();
  assert.equal(dropped.result.isError, true);
  assert.match(dropped.result.content[0].text, /not reachable/);
  const away = await (
    await mcp(hostId, reference, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "list_chats" },
    })
  ).json();
  assert.match(away.result.content[0].text, /not reachable/);
  // Listing tools still works, so a bot can be connected while the computer is off.
  assert.equal(
    (await mcp(hostId, reference, { jsonrpc: "2.0", id: 12, method: "tools/list" })).status,
    200,
  );
});

test("a removed bot link stops working", async () => {
  const key = id(32);
  const hostId = idOf(key);
  const bot = id(8);
  const token = id(32);
  const desk = await host(hostId, key);
  desk.send(`l${JSON.stringify([{ id: bot, hash: hash(token) }])}`);
  await desk.quiet(100);
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await mcp(hostId, `${bot}.${token}`, ping)).status, 200);
  desk.send("l[]");
  await desk.quiet(100);
  assert.equal((await mcp(hostId, `${bot}.${token}`, ping)).status, 404);
  desk.close();
});

test("sockets that prove nothing cannot keep a paired browser out", async () => {
  const key = id(32);
  const hostId = idOf(key);
  const desk = await host(hostId, key);
  const open = async (from) => {
    const response = await upgrade(`client/${hostId}`, {
      Origin: ORIGIN,
      "CF-Connecting-IP": from,
    });
    assert.equal(response.status, 101);
    const socket = reader(response.webSocket);
    assert.equal(await socket.message(), "h1");
    return { socket, cid: (await desk.message()).slice(1) };
  };

  // The desktop accepted this browser's session; nothing below can take its place.
  const paired = await open("192.0.2.1");
  desk.send(`a${paired.cid}`);
  await desk.quiet(100);

  // One address holds three unproven sockets at most: its fourth replaces its oldest.
  const same = [];
  for (let count = 0; count < 3; count += 1) same.push(await open("192.0.2.9"));
  const fourth = await upgrade(`client/${hostId}`, {
    Origin: ORIGIN,
    "CF-Connecting-IP": "192.0.2.9",
  });
  assert.equal(fourth.status, 101);
  assert.equal(await same[0].socket.message(), "x");
  assert.equal(await desk.message(), `c${same[0].cid}`);
  const fourthSocket = reader(fourth.webSocket);
  assert.equal(await fourthSocket.message(), "h1");
  await desk.message();

  // Eight unproven sockets in all: a ninth, from anywhere, replaces the oldest of them.
  const others = [];
  for (let count = 0; count < 5; count += 1) others.push(await open(`198.51.100.${count}`));
  const ninth = await upgrade(`client/${hostId}`, {
    Origin: ORIGIN,
    "CF-Connecting-IP": "203.0.113.5",
  });
  assert.equal(ninth.status, 101);
  assert.equal(await same[1].socket.message(), "x");
  assert.equal(await desk.message(), `c${same[1].cid}`);

  // The paired browser was never touched and still talks to its desktop.
  await paired.socket.quiet(50);
  paired.socket.send("mEstill here");
  assert.equal(
    await desk.message().then((first) => (first.startsWith("o") ? desk.message() : first)),
    `m${paired.cid} Estill here`,
  );

  // Accepting a browser that already left is answered as closed.
  desk.send(`a${same[0].cid}`);
  let closed = "";
  while (closed !== `c${same[0].cid}`) closed = await desk.message();

  // The desktop reconnecting does not make an accepted browser replaceable.
  const again = await upgrade(`host/${hostId}`, { Authorization: `Bearer ${key}` });
  assert.equal(again.status, 101);
  const back = reader(again.webSocket);
  assert.equal(await paired.socket.message(), "h0");
  assert.equal(await paired.socket.message(), "h1");
  for (let count = 0; count < 12; count += 1) {
    const flood = await upgrade(`client/${hostId}`, {
      Origin: ORIGIN,
      "CF-Connecting-IP": `203.0.113.${count}`,
    });
    assert.equal(flood.status, 101);
  }
  await paired.socket.quiet(100);
  paired.socket.send("mEafter the flood");
  let seen = "";
  while (!seen.startsWith(`m${paired.cid}`)) seen = await back.message();
  assert.equal(seen, `m${paired.cid} Eafter the flood`);
  back.close();
});
