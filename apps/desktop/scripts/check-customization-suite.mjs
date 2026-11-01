/** Run customization fixtures on an owned server, including both browser engines and themes. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { server: { type: "string" } } });
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const require = createRequire(import.meta.url);
const url = values.server ?? "http://127.0.0.1:1475";
let server;
let output = "";
try {
  if (!values.server) {
    const vite = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
    server = spawn(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", "1475", "--strictPort"],
      {
        cwd: app,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (data) => {
        output = (output + data).slice(-8192);
      });
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    if (server?.exitCode != null) throw new Error(`Fixture server exited: ${output}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`Fixture server did not become ready: ${output}`);
    await new Promise((done) => setTimeout(done, 150));
  }
  for (const [script, args, cwd] of [
    ["check-customization.mjs", [url], root],
    ["check-new-chat-selection.mjs", [url], root],
    ["check-project-memory.mjs", [url], root],
    ["check-shared-mcp.mjs", ["--server", url], app],
  ]) {
    await new Promise((complete, reject) => {
      const check = spawn(process.execPath, [resolve(app, "scripts", script), ...args], {
        cwd,
        windowsHide: true,
        stdio: "inherit",
      });
      check.once("error", reject);
      check.once("exit", (code, signal) =>
        code === 0 ? complete() : reject(new Error(`${script} failed (${code ?? signal})`)),
      );
    });
  }
} finally {
  server?.kill();
}
