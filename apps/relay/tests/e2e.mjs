/**
 * Remote sessions end to end, on this machine: the relay in the Workers runtime, the desktop's
 * real connection task in front of a scripted agent (`crates/aura-remote/examples/demo_host.rs`),
 * the built website's remote page in real browsers, and a bot speaking MCP over HTTP.
 *
 *   corepack pnpm --filter @auracode/web build
 *   cargo build -p aura-remote --example demo_host
 *   corepack pnpm --filter @auracode/relay worker:build
 *   node apps/relay/tests/e2e.mjs [--host <demo_host executable>] [--engines chromium,webkit]
 *
 * Nothing leaves the machine: every address is localhost.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const here = fileURLToPath(new URL(".", import.meta.url));
const { values } = parseArgs({
  options: {
    host: { type: "string" },
    engines: { type: "string", default: "chromium" },
    shots: { type: "string" },
  },
});
const hostBinary =
  values.host ??
  resolve(
    here,
    "../../../target/debug/examples",
    process.platform === "win32" ? "demo_host.exe" : "demo_host",
  );
// Playwright is the website's and the desktop's test dependency, not the relay's.
const { chromium, webkit, devices } = createRequire(resolve(here, "../../web/package.json"))(
  "playwright",
);
const SITE_PORT = 1437;
const RELAY_PORT = 8799;
const SITE = `http://localhost:${SITE_PORT}`;

/** The built website, as its Worker serves it: files, and each route's own page. */
function serveSite() {
  const root = resolve(here, "../../web/build/client");
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".json": "application/json",
    ".webp": "image/webp",
  };
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, SITE).pathname));
    for (const candidate of [path, join(path, "index.html")]) {
      const file = join(root, candidate);
      if (!file.startsWith(root)) break;
      try {
        if ((await stat(file)).isFile()) {
          response.writeHead(200, {
            "Content-Type": types[extname(file)] ?? "application/octet-stream",
          });
          response.end(await readFile(file));
          return;
        }
      } catch {
        // Try the next candidate.
      }
    }
    response.writeHead(404).end("Not found");
  });
  return new Promise((done) => server.listen(SITE_PORT, "127.0.0.1", () => done(server)));
}

/** The stand-in desktop: its pairing links and bot address as it prints them. */
function startHost(folder) {
  const child = spawn(hostBinary, [`ws://127.0.0.1:${RELAY_PORT}`, SITE, folder], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = [];
  const waiting = [];
  let rest = "";
  child.stdout.on("data", (chunk) => {
    rest += chunk;
    for (;;) {
      const end = rest.indexOf("\n");
      if (end < 0) break;
      const line = rest.slice(0, end).trim();
      rest = rest.slice(end + 1);
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    }
  });
  const line = (prefix) =>
    new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`the host printed no ${prefix}`)), 10_000);
      const take = (text) => {
        clearTimeout(timer);
        assert.ok(text.startsWith(`${prefix} `), text);
        done(text.slice(prefix.length + 1));
      };
      const ready = lines.shift();
      if (ready) take(ready);
      else waiting.push(take);
    });
  return {
    child,
    line,
    /** Asks for a fresh pairing link. */
    async pair() {
      child.stdin.write("pair\n");
      return line("PAIR");
    },
  };
}

const page = (link) => `${link.replace("/remote#", `/remote?relay=ws://127.0.0.1:${RELAY_PORT}#`)}`;

async function browserFlow(engine, launcher, host, first, shots) {
  const browser = await launcher.launch();
  const errors = [];
  try {
    const phone = await browser.newContext({
      ...(engine === "webkit" ? devices["iPhone 14"] : devices["Pixel 7"]),
    });
    const tab = await phone.newPage();
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("console", (entry) => {
      if (entry.type() === "error") errors.push(entry.text());
    });

    // Pairing: the link opens the computer's chats, and its key leaves the address bar at once.
    await tab.goto(page(first));
    // Opening the link pairs nothing: the page asks first, and the computer has heard nothing.
    await tab.getByRole("heading", { name: "Pair this browser?" }).waitFor();
    await tab.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await tab.getByRole("heading", { level: 1, name: "Demo computer" }).waitFor();
    assert.equal(new URL(tab.url()).hash, "", "the pairing key stayed in the address");
    await tab.getByText("Connected", { exact: true }).waitFor();
    const row = tab.getByRole("button", { name: /Fix the login form/ });
    await row.waitFor();
    assert.match(await row.textContent(), /Demo agent · Idle/);
    if (shots) await tab.screenshot({ path: join(shots, `${engine}-list.png`) });

    // The same link is spent: a second browser gets told so, and nothing else.
    const other = await browser.newContext();
    const stranger = await other.newPage();
    await stranger.goto(page(first));
    await stranger.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await stranger.getByRole("heading", { name: "This pairing is over." }).waitFor();
    await stranger.getByText(/already used or has expired/).waitFor();
    await other.close();

    // A chat's history, then a turn live: the message, the agent's words, its step, its request.
    await row.click();
    await tab.getByText("Why does the login form submit empty emails?").waitFor();
    await tab.getByText("The submit handler never checks the field. I can add a check.").waitFor();
    const box = tab.getByRole("textbox", { name: "Message" });
    await box.fill("Add the check and run the tests");
    await tab.getByRole("button", { name: "Send" }).click();
    await tab.locator(".remote-user", { hasText: "Add the check and run the tests" }).waitFor();
    // The box empties once the computer has taken the message.
    await tab.waitForFunction(
      () => document.querySelector('textarea[aria-label="Message"]')?.value === "",
    );
    await tab.locator(".remote-markdown strong", { hasText: "login form" }).waitFor();
    await tab.locator(".remote-steps summary", { hasText: "Read src/login.ts" }).waitFor();
    const card = tab.getByRole("region", { name: "The agent asks for permission" });
    await card.getByText("Run `npm test`").waitFor();
    await tab.getByText("Demo agent · Needs you").waitFor();
    if (shots) await tab.screenshot({ path: join(shots, `${engine}-permission.png`) });
    await card.getByRole("button", { name: "Allow once" }).click();
    await tab.getByText("Run `npm test`: Allow once").waitFor();
    await tab.getByText("Done. The form now checks the email before it submits:").waitFor();
    await tab.locator(".remote-markdown pre code", { hasText: 'email.includes("@")' }).waitFor();
    await tab.locator(".remote-markdown li code", { hasText: "a@b" }).waitFor();
    await tab.getByText("Demo agent · Idle").waitFor();
    assert.equal(await card.count(), 0, "an answered request still asked");
    if (shots) await tab.screenshot({ path: join(shots, `${engine}-chat.png`) });

    // Stopping a turn that waits declines its request and says the turn stopped.
    await box.fill("Now the signup form");
    await box.press("Control+Enter");
    await card.getByText("Run `npm test`").waitFor();
    await tab.getByRole("button", { name: "Stop" }).click();
    await tab.getByText("Stopped", { exact: true }).waitFor();
    await tab.getByText("Run `npm test`: declined").waitFor();
    assert.equal(await tab.getByRole("button", { name: "Stop" }).count(), 0);

    // Reloading keeps the pairing (the key is stored, unreadable) and the history.
    await tab.reload();
    await tab.getByRole("heading", { level: 1, name: "Demo computer" }).waitFor();
    await tab.getByRole("button", { name: /Fix the login form/ }).click();
    await tab.locator(".remote-user", { hasText: "Now the signup form" }).waitFor();
    const stored = await tab.evaluate(
      () =>
        new Promise((done, fail) => {
          const open = indexedDB.open("auracode-remote");
          open.onerror = () => fail(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("hosts").objectStore("hosts").getAll();
            all.onsuccess = () =>
              done(
                all.result.map((host) => ({
                  name: host.hostName,
                  key: Object.prototype.toString.call(host.key),
                  extractable: host.key.extractable,
                })),
              );
          };
        }),
    );
    assert.deepEqual(stored, [
      { name: "Demo computer", key: "[object CryptoKey]", extractable: false },
    ]);
    // Nothing of the pairing is kept where a script could read it back: the site's router
    // remembers scroll positions there, and that is all.
    assert.deepEqual(
      await tab.evaluate(() => Object.keys({ ...localStorage, ...sessionStorage })),
      ["react-router-scroll-positions"],
    );

    // A new chat from here opens on its first turn.
    await tab.getByRole("button", { name: "All chats" }).click();
    await tab.getByRole("button", { name: "New chat", exact: true }).click();
    const sheet = tab.getByRole("dialog", { name: "New chat" });
    assert.equal(await sheet.getByLabel("Agent").inputValue(), "");
    await sheet.getByLabel("Message").fill("Write a README");
    await sheet.getByRole("button", { name: "Start chat" }).click();
    await tab.getByRole("heading", { level: 1, name: "New chat" }).waitFor();
    await tab.locator(".remote-user", { hasText: "Write a README" }).waitFor();
    await tab.getByRole("region", { name: "The agent asks for permission" }).waitFor();
    await tab.getByRole("button", { name: "All chats" }).click();
    await tab.getByRole("button", { name: /New chat.*Needs you/s }).waitFor();

    // A second device pairs with its own link and sees the first one's turn arrive live.
    const second = await browser.newContext();
    const laptop = await second.newPage();
    laptop.on("pageerror", (error) => errors.push(error.message));
    await laptop.goto(page(await host.pair()));
    await laptop.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await laptop.getByRole("button", { name: /New chat.*Needs you/s }).click();
    await laptop.getByRole("region", { name: "The agent asks for permission" }).waitFor();
    await tab.getByRole("button", { name: /New chat.*Needs you/s }).click();
    await tab.getByRole("button", { name: "Reject" }).click();
    await laptop.getByText("Run `npm test`: Reject").waitFor();
    await laptop.getByText("Done. The form now checks the email before it submits:").waitFor();

    // Forgetting unpairs: this browser has nothing left, and its key opens nothing.
    await laptop.getByRole("button", { name: "All chats" }).click();
    await laptop.getByRole("button", { name: "This computer" }).click();
    await laptop.getByRole("button", { name: "Forget this computer" }).click();
    await laptop.getByRole("heading", { name: "Reach your computer from here." }).waitFor();
    await laptop.reload();
    await laptop.getByRole("heading", { name: "Reach your computer from here." }).waitFor();
    await second.close();
    // The first device is untouched by the second one leaving.
    await tab.getByRole("button", { name: "All chats" }).click();
    await tab.getByText("Connected", { exact: true }).waitFor();

    // A link that is not whole is refused before anything connects.
    const broken = await browser.newContext();
    const wrong = await broken.newPage();
    await wrong.goto(`${SITE}/remote?relay=ws://127.0.0.1:${RELAY_PORT}#not.a.link`);
    await wrong.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await wrong.getByText("This pairing link is not complete.").waitFor();
    await broken.close();
    assert.deepEqual(errors, []);
    await phone.close();
  } finally {
    await browser.close();
  }
}

/** A bot, speaking MCP over HTTP to the address the desktop printed. */
async function botFlow(address) {
  const url = address.replace(SITE, `http://127.0.0.1:${RELAY_PORT}`);
  let id = 0;
  const rpc = async (method, params) => {
    id += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    assert.equal(response.status, 200, `${method}: ${response.status}`);
    const body = await response.json();
    assert.equal(body.id, id);
    return body.result;
  };
  const tool = async (name, args = {}) => {
    const result = await rpc("tools/call", { name, arguments: args });
    return { text: result.content[0].text, error: result.isError };
  };
  // The link exists at the relay a moment after the desktop made it: wait for that moment.
  for (let tries = 0; tries < 50; tries += 1) {
    const probe = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
    });
    if (probe.status === 200) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  const hello = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  assert.equal(hello.serverInfo.name, "auracode");
  // The demo's link has the chat tools: the wider ones are not shown to it.
  assert.equal((await rpc("tools/list")).tools.length, 8);

  const chats = await tool("list_chats");
  assert.equal(chats.error, false);
  assert.match(chats.text, /^Chats on Demo computer, most recently active first:\n/);
  assert.match(chats.text, /- c1 "Fix the login form" in demo with Demo agent: idle\n/);
  const projects = await tool("list_projects");
  assert.match(projects.text, /- folder f1: demo\n/);

  // Start a chat, wait until it asks, allow it, wait until it is done, and read the result.
  const started = await tool("start_chat", { folder_id: "f1", text: "Tidy the tests" });
  assert.equal(started.error, false, started.text);
  const chat = /^Started chat (\S+) with Demo agent\./.exec(started.text)?.[1];
  assert.ok(chat, started.text);
  const asking = await tool("wait_for_chat", { chat_id: chat, timeout_seconds: 20 });
  assert.match(asking.text, /: working, waiting for an answer\./);
  const request = /Waiting request (\S+) \(permission\): Run `npm test`/.exec(asking.text)?.[1];
  assert.ok(request, asking.text);
  assert.match(asking.text, /Options for respond_to_request: allow = Allow once; reject = Reject/);
  const answered = await tool("respond_to_request", {
    chat_id: chat,
    request_id: request,
    option_id: "allow",
  });
  assert.equal(answered.error, false, answered.text);
  const finished = await tool("wait_for_chat", { chat_id: chat, timeout_seconds: 20 });
  assert.match(finished.text, /: idle\./);
  assert.match(finished.text, /User: Tidy the tests\n/);
  assert.match(finished.text, /Steps: Read src\/login\.ts\n/);
  assert.match(finished.text, /Agent: [\s\S]*Done\. The form now checks the email/);
  assert.match(finished.text, /The turn finished\.\n/);
  assert.doesNotMatch(finished.text, /Waiting request/);

  // What a bot gets wrong comes back as words it can act on.
  const twice = await tool("respond_to_request", {
    chat_id: chat,
    request_id: request,
    option_id: "allow",
  });
  assert.equal(twice.error, true);
  assert.match(twice.text, /not waiting any more/);
  assert.equal((await tool("read_chat", { chat_id: "nope" })).error, true);

  // A link with another token does not exist.
  const forged = url.replace(/\.[A-Za-z0-9_-]{43}$/, `.${"A".repeat(43)}`);
  const refused = await fetch(forged, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(refused.status, 404);
}

const site = await serveSite();
const relay = new Miniflare(
  convertV4MiniflareOptions({
    modules: [
      {
        type: "ESModule",
        path: "index.js",
        contents: await readFile(resolve(here, "../build/index.js"), "utf8"),
      },
    ],
    compatibilityDate: "2026-10-26",
    durableObjects: { ROOMS: { className: "Room", useSQLite: true } },
    bindings: { APP_ORIGIN: SITE },
    host: "127.0.0.1",
    port: RELAY_PORT,
  }),
);
await relay.ready;

/** A desktop of its own for each run, so one run's chats are not in the next one's way. */
async function withHost(work) {
  const folder = await mkdtemp(join(tmpdir(), "aura-remote-e2e-"));
  const host = startHost(folder);
  try {
    const first = await host.line("PAIR");
    const bot = await host.line("BOT");
    assert.match(first, /^http:\/\/localhost:1437\/remote#[\w-]{22}\.[\w-]{11}\.[\w-]{43}$/);
    await work(host, first, bot);
  } finally {
    host.child.stdin.end();
    host.child.kill();
    await rm(folder, { recursive: true, force: true });
  }
}

try {
  await withHost(async (_host, _first, bot) => {
    await botFlow(bot);
    console.log("bot: MCP tools drove a chat through the relay");
  });
  for (const engine of values.engines.split(",")) {
    await withHost(async (host, first) => {
      await browserFlow(engine, engine === "webkit" ? webkit : chromium, host, first, values.shots);
      console.log(`${engine}: paired, followed a turn live, answered, stopped, started and forgot`);
    });
  }
} finally {
  await relay.dispose();
  site.close();
}
