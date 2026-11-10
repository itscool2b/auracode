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
  assert.deepEqual(await health.json(), { ok: true, protocol: 1, tools: 8 });
  assert.equal(health.headers.get("cache-control"), "no-store");
  for (const path of ["", "nothing", "host", "host/short", `other/${id(16)}`])
    assert.equal((await runtime.dispatchFetch(`${BASE}/${path}`)).status, 404, path);
  assert.equal((await runtime.dispatchFetch(`${ORIGIN}/api/v1/config`)).status, 404);
});

test("only the desktop that claimed an id can hold its host socket", async () => {
  const hostId = id(16);
  const key = id(32);
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

test("a browser socket needs the website's origin", async () => {
  const hostId = id(16);
  (await host(hostId, id(32))).close();
  assert.equal((await upgrade(`client/${hostId}`)).status, 403);
  assert.equal((await upgrade(`client/${hostId}`, { Origin: "https://evil.test" })).status, 403);
  assert.equal(
    (await runtime.dispatchFetch(`${BASE}/client/${hostId}`, { headers: { Origin: ORIGIN } }))
      .status,
    400,
  );
});

test("forwards a browser's messages to its desktop and back, and says who is there", async () => {
  const hostId = id(16);
  const key = id(32);
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
  assert.equal(await desk.message(), `c${other}`);
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
  const hostId = id(16);
  const key = id(32);
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
  const hostId = id(16);
  const desk = await host(hostId, id(32));
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
  const hostId = id(16);
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
  const desk = await host(hostId, id(32));
  assert.equal((await mcp(hostId, reference, initialize)).status, 404);
  desk.send(
    `l${JSON.stringify([
      { id: bot, hash: hash(token) },
      { id: "bad", hash: "bad" },
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
  const hostId = id(16);
  const key = id(32);
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
