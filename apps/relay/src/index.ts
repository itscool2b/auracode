/**
 * The remote-sessions relay. A desktop keeps one outbound WebSocket here (its "host" socket);
 * paired browsers and bots reach it through this Worker, so the desktop opens no port.
 *
 * - A browser's traffic is sealed end to end between the browser and the desktop
 *   (docs/remote-sessions.md). The relay forwards opaque text and cannot read or forge it.
 * - A bot speaks MCP over HTTPS, so its calls are readable here in passing. The relay turns each
 *   tool call into one request to the desktop, which checks the bot's token itself.
 *
 * One Durable Object per desktop holds its sockets. Its only stored state is the hash of the
 * desktop's key and the hashes of its bot tokens.
 */
import { DurableObject } from "cloudflare:workers";
import ALL_TOOLS from "./tools.json";

type Tool = (typeof ALL_TOOLS)[number] & { full?: boolean };
/** The tools as MCP lists them: `full` is this relay's own mark, not part of a tool. */
const listed = (tools: readonly Tool[]) => tools.map(({ full: _full, ...tool }) => tool);
/** What every bot link has, and what a full-control link has. */
const CHAT_TOOLS = listed((ALL_TOOLS as readonly Tool[]).filter((tool) => !tool.full));
const FULL_TOOLS = listed(ALL_TOOLS as readonly Tool[]);

export interface Env {
  readonly ROOMS: DurableObjectNamespace<Room>;
  /** The website's origin: the only origin a browser socket may come from. */
  readonly APP_ORIGIN: string;
}

const PREFIX = "/api/remote/v1/";
/** 16 random bytes, base64url. */
const HOST_ID = /^[A-Za-z0-9_-]{22}$/;
/** 32 random bytes, base64url. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;
/** 8 random bytes, base64url. */
const BOT_ID = /^[A-Za-z0-9_-]{11}$/;
const CID_LENGTH = 16;

/** Browsers the desktop has accepted: each proved it holds a pairing or device key. */
const MAX_PROVEN = 16;
/**
 * Browsers that have not proved anything yet. Knowing a desktop's id is not a credential, so
 * these sockets are few, and a newcomer takes the place of the oldest: nobody can hold the door
 * shut against a paired device by opening sockets.
 */
const MAX_WAITING = 8;
const MAX_WAITING_PER_ADDRESS = 3;
/** How long an accepted browser keeps its place after the desktop reconnects, to prove itself again. */
const REPROVE_MS = 30_000;
const MAX_BOTS = 32;
/** A browser's largest message: a prompt of a few thousand words, sealed. */
const CLIENT_MESSAGE_BYTES = 96 * 1024;
/** A desktop's largest message: one page of a chat's history, sealed. */
const HOST_MESSAGE_BYTES = 2 * 1024 * 1024;
const CLIENT_MESSAGES_PER_WINDOW = 240;
const WINDOW_MS = 10_000;
const MCP_BODY_BYTES = 256 * 1024;
const MAX_BOT_CALLS = 8;
const BOT_CALL_MS = 55_000;

const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "auracode runs coding agents (Claude Code, Codex and others) on a person's computer. These tools reach the chats on that computer while auracode is open there with remote access on. Start with list_chats. After send_message or start_chat, call wait_for_chat until the agent finishes or asks for something, and answer waiting requests with respond_to_request. Agents there can edit files and run commands, so send only what the person asked for.";
const OFFLINE =
  "The computer is not reachable: auracode is closed there, remote access is off, or it is offline. Ask its owner to open auracode and try again.";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json", ...headers },
  });
}

const notFound = (headers: Record<string, string> = {}) =>
  json(404, { error: "not_found" }, headers);

function isUpgrade(request: Request): boolean {
  return request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return notFound();
    const [kind, hostId] = url.pathname.slice(PREFIX.length).split("/");
    if (kind === "health" && hostId === undefined)
      return json(200, {
        ok: true,
        protocol: 1,
        tools: CHAT_TOOLS.length,
        full_tools: FULL_TOOLS.length,
      });
    if (!hostId || !HOST_ID.test(hostId)) return notFound();
    const origin = request.headers.get("Origin");
    if (kind === "host") {
      // Only the desktop app holds a host key, and it is not a browser.
      if (!isUpgrade(request) || origin !== null) return json(400, { error: "invalid_request" });
    } else if (kind === "client") {
      if (!isUpgrade(request)) return json(400, { error: "invalid_request" });
      if (origin !== env.APP_ORIGIN) return json(403, { error: "forbidden" });
    } else if (kind === "mcp") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    } else {
      return notFound();
    }
    return env.ROOMS.get(env.ROOMS.idFromName(hostId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

type Attachment =
  | { readonly role: "host" }
  | {
      readonly role: "client";
      readonly cid: string;
      /** When the socket opened, and the address it came from. */
      readonly since: number;
      readonly from: string;
      /** The desktop accepted its session. */
      readonly proven: boolean;
      /** Set when the desktop reconnected: accepted only until then unless it accepts again. */
      readonly until?: number;
      /** This side ended the socket and the desktop already knows. */
      readonly told?: boolean;
    };
type ClientAttachment = Extract<Attachment, { role: "client" }>;

interface BotReply {
  readonly text: string;
  readonly error: boolean;
}

interface RpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

function randomId(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Whether the desktop's current socket accepted a browser, or still may within its grace time. */
function accepted(is: ClientAttachment): boolean {
  return is.proven && (is.until === undefined || is.until > Date.now());
}

/** Compares two hashes without stopping at the first difference. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1)
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export class Room extends DurableObject<Env> {
  /** Bot calls waiting for the desktop's answer. A waiting call keeps this object awake. */
  readonly #calls = new Map<string, (reply: BotReply) => void>();
  /** Messages each browser sent in the current window. Lost on hibernation, which only helps. */
  readonly #rates = new Map<string, { since: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const [kind, , reference] = new URL(request.url).pathname.slice(PREFIX.length).split("/");
    if (kind === "host") return this.#acceptHost(request);
    if (kind === "client") return this.#acceptClient(request);
    if (kind === "mcp") return this.#mcp(request, reference ?? "");
    return notFound();
  }

  #host(): WebSocket | null {
    return (
      this.ctx.getWebSockets("host").find((socket) => socket.readyState === WebSocket.OPEN) ?? null
    );
  }

  #clients(): WebSocket[] {
    return this.ctx
      .getWebSockets("client")
      .filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  /** The desktop proves it is the one that first claimed this id by presenting the same key. */
  async #acceptHost(request: Request): Promise<Response> {
    const key = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
    if (!SECRET.test(key)) return json(401, { error: "unauthorized" });
    const hash = await sha256(key);
    const known = await this.ctx.storage.get<string>("host");
    if (known === undefined) await this.ctx.storage.put("host", hash);
    else if (!same(known, hash)) return json(401, { error: "unauthorized" });

    const earlier = this.ctx.getWebSockets("host");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["host"]);
    pair[1].serializeAttachment({ role: "host" } satisfies Attachment);
    for (const socket of earlier) end(socket, 4000, "replaced");
    // The new socket knows none of the open browsers: each starts its session again.
    for (const client of this.#clients()) {
      const attachment = client.deserializeAttachment() as Attachment;
      if (attachment.role !== "client") continue;
      // A browser accepted before keeps its place while it starts again, for a short time:
      // the new socket has to accept it too.
      if (attachment.proven)
        client.serializeAttachment({
          ...attachment,
          until: Date.now() + REPROVE_MS,
        } satisfies Attachment);
      if (earlier.length > 0) client.send("h0");
      client.send("h1");
      pair[1].send(`o${attachment.cid}`);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async #acceptClient(request: Request): Promise<Response> {
    // An id no desktop ever claimed has nothing behind it.
    if ((await this.ctx.storage.get<string>("host")) === undefined) return notFound();
    const from = request.headers.get("CF-Connecting-IP") ?? "";
    const waiting = this.#clients()
      .map((socket) => ({ socket, is: socket.deserializeAttachment() as ClientAttachment }))
      .filter((entry) => !accepted(entry.is))
      .sort((a, b) => a.is.since - b.is.since);
    const fromHere = waiting.filter((entry) => entry.is.from === from);
    const leaving =
      fromHere.length >= MAX_WAITING_PER_ADDRESS
        ? fromHere[0]
        : waiting.length >= MAX_WAITING
          ? waiting[0]
          : undefined;
    if (leaving) {
      end(leaving.socket, 4002, "unproven");
      this.#host()?.send(`c${leaving.is.cid}`);
    }
    const cid = randomId(12);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["client", `c:${cid}`]);
    pair[1].serializeAttachment({
      role: "client",
      cid,
      since: Date.now(),
      from,
      proven: false,
    } satisfies Attachment);
    const host = this.#host();
    pair[1].send(host ? "h1" : "h0");
    host?.send(`o${cid}`);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return socket.close(1003, "text only");
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.role === "host") return this.#fromHost(socket, message);
    if (message.length > CLIENT_MESSAGE_BYTES) return socket.close(1009, "too large");
    if (!message.startsWith("m")) return socket.close(1008, "unexpected");
    if (!this.#allowed(attachment.cid)) return socket.close(1008, "too many messages");
    const host = this.#host();
    if (host) host.send(`m${attachment.cid} ${message.slice(1)}`);
    else socket.send("h0");
  }

  #allowed(cid: string): boolean {
    const now = Date.now();
    const rate = this.#rates.get(cid);
    if (!rate || now - rate.since > WINDOW_MS) {
      this.#rates.set(cid, { since: now, count: 1 });
      return true;
    }
    rate.count += 1;
    return rate.count <= CLIENT_MESSAGES_PER_WINDOW;
  }

  async #fromHost(socket: WebSocket, message: string) {
    if (message.length > HOST_MESSAGE_BYTES) return socket.close(1009, "too large");
    const kind = message[0];
    if (kind === "m" || kind === "c" || kind === "a") {
      const cid = message.slice(1, 1 + CID_LENGTH);
      const client = this.ctx.getWebSockets(`c:${cid}`)[0];
      if (!client || client.readyState !== WebSocket.OPEN) {
        if (kind !== "c") socket.send(`c${cid}`);
      } else if (kind === "a") {
        // The desktop opened a sealed message from this browser: it holds a key.
        const is = client.deserializeAttachment() as ClientAttachment;
        if (is.proven && is.until === undefined) return;
        const proven = this.#clients().filter(
          (other) =>
            other !== client && accepted(other.deserializeAttachment() as ClientAttachment),
        ).length;
        if (proven >= MAX_PROVEN) {
          end(client, 4003, "too many");
          socket.send(`c${cid}`);
        } else {
          client.serializeAttachment({
            ...is,
            proven: true,
            until: undefined,
          } satisfies Attachment);
        }
      } else if (kind === "m") {
        client.send(`m${message.slice(2 + CID_LENGTH)}`);
      } else {
        end(client, 4001, "closed");
      }
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(message.slice(1));
    } catch {
      return socket.close(1008, "unexpected");
    }
    if (kind === "l") return this.#saveBots(body);
    if (kind === "b") {
      const reply = body as { rid?: unknown; text?: unknown; error?: unknown };
      if (typeof reply.rid !== "string") return;
      this.#calls.get(reply.rid)?.({
        text: typeof reply.text === "string" ? reply.text : "",
        error: reply.error === true,
      });
      return;
    }
    socket.close(1008, "unexpected");
  }

  /**
   * The desktop's current bot links, as `[{ id, hash, full }]`: what a bot's URL is checked
   * against, and whether it is shown the full-control tools. The desktop checks each call's level
   * itself; the mark here only keeps the list a bot is shown honest.
   */
  async #saveBots(body: unknown) {
    const bots: Record<string, string> = {};
    const full: string[] = [];
    if (Array.isArray(body))
      for (const entry of body.slice(0, MAX_BOTS)) {
        const {
          id,
          hash,
          full: wide,
        } = (entry ?? {}) as {
          id?: unknown;
          hash?: unknown;
          full?: unknown;
        };
        if (
          typeof id === "string" &&
          BOT_ID.test(id) &&
          typeof hash === "string" &&
          SECRET.test(hash)
        ) {
          bots[id] = hash;
          if (wide === true) full.push(id);
        }
      }
    await this.ctx.storage.put({ bots, full });
  }

  override async webSocketClose(socket: WebSocket, code: number, reason: string) {
    this.#left(socket);
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(socket: WebSocket) {
    this.#left(socket);
  }

  #left(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (attachment?.role === "client") {
      this.#rates.delete(attachment.cid);
      if (!attachment.told) this.#host()?.send(`c${attachment.cid}`);
      return;
    }
    // A replaced host socket closes after its successor opened: the desktop is still here.
    const successor = this.ctx
      .getWebSockets("host")
      .some((other) => other !== socket && other.readyState === WebSocket.OPEN);
    if (successor) return;
    for (const client of this.#clients()) client.send("h0");
    for (const finish of [...this.#calls.values()]) finish({ text: OFFLINE, error: true });
  }

  async #mcp(request: Request, reference: string): Promise<Response> {
    const [id = "", inPath = ""] = reference.split(".");
    const token =
      inPath || (/^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "");
    const bots = (await this.ctx.storage.get<Record<string, string>>("bots")) ?? {};
    const known = BOT_ID.test(id) ? bots[id] : undefined;
    // A wrong or removed link does not exist; nothing here invites a sign-in flow.
    if (!known || !SECRET.test(token) || !same(known, await sha256(token))) return notFound(CORS);
    if (request.method !== "POST")
      return json(405, { error: "method_not_allowed" }, { ...CORS, Allow: "POST, OPTIONS" });
    const text = await request.text();
    if (text.length > MCP_BODY_BYTES) return json(413, { error: "too_large" }, CORS);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, rpcError(null, -32700, "Parse error"), CORS);
    }
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as RpcMessage[];
    if (messages.length === 0 || messages.length > 16)
      return json(400, rpcError(null, -32600, "Invalid request"), CORS);
    const wide = ((await this.ctx.storage.get<string[]>("full")) ?? []).includes(id);
    const replies: unknown[] = [];
    for (const message of messages) {
      const reply = await this.#rpc(message, id, token, wide ? FULL_TOOLS : CHAT_TOOLS);
      if (reply !== null) replies.push(reply);
    }
    // Notifications and responses get no body.
    if (replies.length === 0) return new Response(null, { status: 202, headers: CORS });
    return json(200, batch ? replies : replies[0], CORS);
  }

  async #rpc(
    message: RpcMessage,
    bot: string,
    token: string,
    tools: readonly { readonly name: string }[],
  ): Promise<unknown> {
    if (message === null || typeof message !== "object" || message.jsonrpc !== "2.0")
      return rpcError(null, -32600, "Invalid request");
    const id = message.id;
    if (typeof message.method !== "string") return null;
    const wantsReply = typeof id === "string" || typeof id === "number";
    if (!wantsReply) return null;
    const params = (message.params ?? {}) as Record<string, unknown>;
    switch (message.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return rpcResult(id, {
          protocolVersion:
            typeof asked === "string" && MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "auracode", title: "auracode", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools });
      case "tools/call": {
        const name = params.name;
        const args = params.arguments ?? {};
        // A tool outside this link's level does not exist for it.
        if (typeof name !== "string" || !tools.some((tool) => tool.name === name))
          return rpcError(id, -32602, "Unknown tool");
        if (args === null || typeof args !== "object" || Array.isArray(args))
          return rpcError(id, -32602, "Tool arguments must be an object");
        const reply = await this.#call({ bot, token, tool: name, args });
        return rpcResult(id, {
          content: [{ type: "text", text: reply.text }],
          isError: reply.error,
        });
      }
      default:
        return rpcError(id, -32601, "Method not found");
    }
  }

  /** One tool call, answered by the desktop. */
  #call(request: { bot: string; token: string; tool: string; args: unknown }): Promise<BotReply> {
    const host = this.#host();
    if (!host) return Promise.resolve({ text: OFFLINE, error: true });
    if (this.#calls.size >= MAX_BOT_CALLS)
      return Promise.resolve({
        text: "Too many calls are waiting on this computer. Wait for one to finish.",
        error: true,
      });
    const rid = randomId(9);
    return new Promise<BotReply>((resolve) => {
      const finish = (reply: BotReply) => {
        clearTimeout(timer);
        this.#calls.delete(rid);
        resolve(reply);
      };
      const timer = setTimeout(
        () => finish({ text: "The computer did not answer in time. Try again.", error: true }),
        BOT_CALL_MS,
      );
      this.#calls.set(rid, finish);
      try {
        host.send(`b${JSON.stringify({ rid, ...request })}`);
      } catch {
        finish({ text: OFFLINE, error: true });
      }
    });
  }
}

/**
 * Ends a socket from this side. The last message says so in words, because a peer can see the
 * closing code late or not at all.
 */
function end(socket: WebSocket, code: number, reason: string) {
  try {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (attachment?.role === "client")
      socket.serializeAttachment({ ...attachment, told: true } satisfies Attachment);
    socket.send("x");
    socket.close(code, reason);
  } catch {
    // Already closed.
  }
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
