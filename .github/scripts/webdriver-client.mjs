import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

/** Small W3C client for the external native gate; no injected UI event handlers. */
export class WebDriver {
  constructor(origin, { timeout = 10_000 } = {}) {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    this.origin = origin;
    this.timeout = timeout;
    this.session = null;
  }

  async request(method, path, body, timeout = this.timeout) {
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      assert(size <= 16 * 1024 * 1024, "WebDriver response exceeds 16 MiB");
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok || payload.value?.error) {
      const error = new Error(
        `${method} ${path}: ${payload.value?.message ?? response.statusText}`,
      );
      error.code = payload.value?.error;
      throw error;
    }
    return payload.value;
  }

  async open(application) {
    const result = await this.request(
      "POST",
      "/session",
      {
        capabilities: {
          alwaysMatch: {
            "tauri:options": { application, args: [] },
            timeouts: { implicit: 0, pageLoad: 30_000, script: 20_000 },
          },
        },
      },
      60_000,
    );
    assert.equal(typeof result?.sessionId, "string", "native session was not created");
    this.session = result.sessionId;
    return result.capabilities;
  }

  command(method, path, body) {
    assert(this.session, "WebDriver has no session");
    return this.request(method, `/session/${encodeURIComponent(this.session)}${path}`, body);
  }

  async close() {
    if (!this.session) return;
    try {
      await this.command("DELETE", "");
    } finally {
      this.session = null;
    }
  }

  async elements(selector, using = "css selector") {
    return (await this.command("POST", "/elements", { using, value: selector })).map((element) => {
      assert.equal(typeof element[ELEMENT], "string");
      return element[ELEMENT];
    });
  }

  element(id, method, action, body) {
    return this.command(method, `/element/${encodeURIComponent(id)}/${action}`, body);
  }

  async visible(selector, using = "css selector") {
    for (const id of await this.elements(selector, using)) {
      if (await this.element(id, "GET", "displayed")) return id;
    }
    return null;
  }

  async click(selector, using = "css selector") {
    const id = await until(`enabled ${selector}`, async () => {
      const found = await this.visible(selector, using);
      return found && (await this.element(found, "GET", "enabled")) ? found : null;
    });
    await this.element(id, "POST", "click", {});
  }

  async type(selector, text) {
    const id = await until(`input ${selector}`, () => this.visible(selector));
    await this.element(id, "POST", "clear", {});
    await this.element(id, "POST", "value", { text });
    assert.equal(await this.element(id, "GET", "property/value"), text);
  }

  script(script, args = [], asynchronous = false) {
    return this.command("POST", `/execute/${asynchronous ? "async" : "sync"}`, { script, args });
  }

  async scroll(selector, deltaY) {
    const id = await until(`scroll region ${selector}`, () => this.visible(selector));
    await this.command("POST", "/actions", {
      actions: [
        {
          type: "wheel",
          id: "transcript-wheel",
          actions: [
            {
              type: "scroll",
              x: 0,
              y: 0,
              deltaX: 0,
              deltaY,
              duration: 200,
              origin: { [ELEMENT]: id },
            },
          ],
        },
      ],
    });
  }
}

export async function until(label, read, { timeout = 30_000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      // A rerender can replace a previously found node. Protocol/transport errors are failures.
      if (!["stale element reference", "no such element"].includes(error.code)) throw error;
    }
    await delay(interval);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

export function verifyRuntime(capabilities, expected) {
  assert.match(expected ?? "", /^\d+\.\d+\.\d+\.\d+$/, "EXPECTED_WEBVIEW_VERSION is required");
  const actual = capabilities?.browserVersion;
  assert.match(actual ?? "", /^\d+\.\d+\.\d+\.\d+$/, "driver omitted WebView2 version");
  assert.equal(actual.split(".").slice(0, 3).join("."), expected.split(".").slice(0, 3).join("."));
  return actual;
}
