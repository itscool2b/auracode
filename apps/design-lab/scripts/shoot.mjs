#!/usr/bin/env node
/**
 * Screenshots and a video of design-lab directions in real engines (WebKit first: the app's
 * webview is WKWebView), so every direction can be reviewed side by side.
 *
 *   node scripts/shoot.mjs --direction <id|all> --port <n> [options]
 *
 *   --direction, -d <id|all>   a direction id (aurora, noir, halo, ...) or "all"
 *   --port, -p <n>             where to serve the lab while shooting (never 1420: the desktop app's)
 *   --engines <list>           comma-separated: webkit, chromium, firefox (default webkit,chromium)
 *   --server <url>             shoot an already running lab (a dev or preview server) instead
 *   --dev                      serve with the Vite dev server instead of a build: a direction that
 *                              is broken mid-edit then breaks only its own pages
 *   --only <names>             comma-separated shot names (see SHOTS below, or "video")
 *   --no-video                 skip the streaming video
 *   --out <dir>                output folder (default: shots)
 *   --settle <ms>              extra wait before each shot, after the page is ready (default 600)
 *
 * For each direction and engine it writes, at 1440x900 and deviceScaleFactor 2,
 * shots/<direction>/<engine>-<shot>.png, plus <engine>-streaming.webm: 14 s of the streaming state
 * from t=0 at 1x (where the engine can record video). Before each shot it waits for the direction
 * to mount, fonts to load, live orbs to show, finite animations to finish, and two animation frames.
 *
 * Without --server it builds the lab into node_modules/.cache/shoot-<pid> (private to this run, so
 * parallel runs never collide) and serves it with `vite preview` on the port. The server, the
 * browsers and that folder go away on every exit path: the normal end, an error, Ctrl-C, a kill
 * signal, and even SIGKILL (a watchdog child stops the server when this script disappears).
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "playwright";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT = { width: 1440, height: 900 };
const DESKTOP_DEV_PORT = 1420;
const VIDEO_MS = 14_000;

/**
 * The shots, by name: `#/<direction>/<path>?<query>`. `reducedMotion` also emulates the OS setting,
 * so CSS media queries and the lab's `?motion=reduce` agree.
 */
const SHOTS = [
  { name: "streaming-t7.5", path: "streaming", query: "t=7.5" },
  { name: "streaming-t24", path: "streaming", query: "t=24" },
  { name: "settled", path: "settled", query: "" },
  { name: "empty", path: "empty", query: "" },
  { name: "permission", path: "permission", query: "" },
  { name: "picker", path: "picker", query: "" },
  { name: "settled-reduced-motion", path: "settled", query: "motion=reduce", reducedMotion: true },
];

const ENGINES = { chromium, webkit, firefox };

function fail(message) {
  console.error(`shoot: ${message}`);
  process.exit(2);
}

function parseOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        direction: { type: "string", short: "d" },
        port: { type: "string", short: "p" },
        engines: { type: "string", default: "webkit,chromium" },
        server: { type: "string" },
        dev: { type: "boolean", default: false },
        only: { type: "string" },
        "no-video": { type: "boolean", default: false },
        out: { type: "string", default: "shots" },
        settle: { type: "string", default: "600" },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    fail(`${error.message}. Run with --help for usage.`);
  }
  if (parsed.help) {
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const usage = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
    console.log(usage.replace(/^ \* ?/gm, "").trim());
    process.exit(0);
  }
  if (!parsed.direction) fail("--direction is required (an id, or all).");
  if (!parsed.server && !parsed.port) fail("--port is required unless --server is given.");
  const port = parsed.port === undefined ? null : Number(parsed.port);
  if (port !== null && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
    fail(`--port must be a whole number from 1024 to 65535, not "${parsed.port}".`);
  }
  if (port === DESKTOP_DEV_PORT) fail("port 1420 belongs to the desktop app's dev server.");
  const engines = parsed.engines
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const engine of engines) {
    if (!(engine in ENGINES)) fail(`unknown engine "${engine}" (webkit, chromium, firefox).`);
  }
  if (engines.length === 0) fail("--engines lists no engine.");
  const only = parsed.only
    ? new Set(
        parsed.only
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      )
    : null;
  if (only) {
    const known = new Set([...SHOTS.map((shot) => shot.name), "video"]);
    for (const name of only) if (!known.has(name)) fail(`unknown shot "${name}".`);
  }
  const settle = Number(parsed.settle);
  if (!Number.isFinite(settle) || settle < 0) fail("--settle must be a number of ms.");
  let server = null;
  if (parsed.server) {
    try {
      server = new URL(parsed.server);
    } catch {
      fail(`--server is not a URL: "${parsed.server}".`);
    }
  }
  return {
    direction: parsed.direction,
    port,
    engines,
    server,
    dev: parsed.dev,
    only,
    video: !parsed["no-video"] && (only === null || only.has("video")),
    out: resolve(APP_DIR, parsed.out),
    settle,
  };
}

/* ---------------------------------------------------------------- cleanup on every exit path */

/*
 * Everything this run starts is tracked here, so every way out removes it: the normal end, an error,
 * Ctrl-C or a kill signal (async cleanup, then exit), and, as a last resort, the synchronous `exit`
 * hook, which runs even when something calls process.exit mid-cleanup. Playwright's own signal
 * handlers are switched off at launch (they exit the process the moment the browsers close, which
 * would leave the server running); Playwright still kills its browsers on exit.
 */
const children = new Set();
const tempDirs = new Set();
const browsers = new Set();
let cleaning = null;
let aborting = false;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function cleanup() {
  cleaning ??= (async () => {
    await Promise.all(
      [...browsers].map((browser) => Promise.race([browser.close().catch(() => {}), pause(5000)])),
    );
    await Promise.all([...children].map(stopProcess));
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  })();
  return cleaning;
}

process.on("exit", () => {
  for (const child of children) kill(child, "SIGKILL");
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: the process is ending.
    }
  }
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
]) {
  // Once: a second Ctrl-C falls through to the default handler and exits at once, and the exit
  // hook above still stops the server.
  process.once(signal, () => {
    aborting = true;
    console.error(`\nshoot: ${signal}, shutting down`);
    cleanup().finally(() => process.exit(code));
  });
}
process.on("uncaughtException", (error) => {
  console.error(`shoot: ${error.stack ?? error.message}`);
  cleanup().finally(() => process.exit(1));
});
process.on("unhandledRejection", (error) => {
  console.error(`shoot: ${error?.stack ?? error}`);
  cleanup().finally(() => process.exit(1));
});

/* ----------------------------------------------------------------------------- the server */

function viteBin() {
  const require = createRequire(join(APP_DIR, "package.json"));
  const manifest = require.resolve("vite/package.json");
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  return join(dirname(manifest), typeof bin === "string" ? bin : bin.vite);
}

/*
 * Every child runs under this watchdog, which polls this script's pid: when the script is gone, even
 * by SIGKILL (which no handler can catch), it stops its command and removes the run's temp folder.
 * Without a command it only does the second part (a janitor, for --server runs). Signals it gets are
 * passed on to its command.
 */
const WATCHDOG = `
const { spawn } = require("node:child_process");
const { rmSync } = require("node:fs");
const [parent, runDir, ...command] = process.argv.slice(1);
let orphaned = false;
const finish = (code) => {
  if (orphaned) { try { rmSync(runDir, { recursive: true, force: true }); } catch {} }
  process.exit(code);
};
const child = command.length > 0 ? spawn(process.execPath, command, { stdio: "inherit" }) : null;
child?.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
const stop = (signal) => {
  if (!child) return finish(0);
  try { child.kill(signal); } catch {}
};
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(signal));
setInterval(() => {
  if (orphaned) return;
  try { process.kill(Number(parent), 0); } catch {
    orphaned = true;
    stop("SIGTERM");
    setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} finish(1); }, 3000);
  }
}, 500);
`;

/** This run's temp files (the built site, video takes): one folder, removed on every way out. */
const RUN_DIR = join(APP_DIR, "node_modules", ".cache", `shoot-${process.pid}`);

/** Runs a Node command under the watchdog, in its own process group so the group stops together. */
function runWatched(args, label) {
  const child = spawn(process.execPath, ["-e", WATCHDOG, String(process.pid), RUN_DIR, ...args], {
    cwd: APP_DIR,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const output = [];
  const keep = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 200) output.shift();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.output = () => output.join("").trim();
  child.label = label;
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function runVite(args, label) {
  return runWatched([viteBin(), ...args], label);
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(() => {
      kill(child, "SIGKILL");
      done();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    kill(child, "SIGTERM");
  });
}

function kill(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

function exited(child) {
  return new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${child.label} exited early:\n${child.output()}`);
    }
    if (await responds(url)) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s.`);
}

async function startServer(options) {
  tempDirs.add(RUN_DIR);
  if (options.server) {
    const url = options.server.href;
    if (!(await responds(url))) throw new Error(`nothing answers at ${url}.`);
    runWatched([], "janitor");
    return url.endsWith("/") ? url : `${url}/`;
  }
  const url = `http://localhost:${options.port}/`;
  if (await responds(url)) {
    throw new Error(
      `port ${options.port} is already serving something. Pick a free port, or pass --server ${url} to shoot what runs there.`,
    );
  }
  let child;
  if (options.dev) {
    child = runVite(["--port", String(options.port), "--strictPort"], "vite dev");
  } else {
    const outDir = join(RUN_DIR, "site");
    console.log("building the lab...");
    const build = runVite(
      ["build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"],
      "vite build",
    );
    const result = await exited(build);
    if (result.code !== 0) throw new Error(`vite build failed:\n${build.output()}`);
    child = runVite(
      ["preview", "--outDir", outDir, "--port", String(options.port), "--strictPort"],
      "vite preview",
    );
  }
  await waitForServer(url, child, 60_000);
  return url;
}

/* --------------------------------------------------------------------------- the browser */

async function launch(engine) {
  const options = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
  let browser;
  if (engine === "chromium") {
    // The full Chromium in new headless mode renders like the real browser (GPU compositing,
    // backdrop-filter); the headless shell is the fallback.
    try {
      browser = await chromium.launch({ ...options, channel: "chromium" });
    } catch {
      browser = await chromium.launch(options);
    }
  } else {
    browser = await ENGINES[engine].launch(options);
  }
  browsers.add(browser);
  browser.once("disconnected", () => browsers.delete(browser));
  return browser;
}

/** Waits until the lab page is ready to be captured; throws when the direction crashed. */
async function settle(page, settleMs) {
  const handle = await page.waitForFunction(
    () => {
      const state = document.documentElement.dataset.labReady;
      return state === "true" || state === "error" ? state : false;
    },
    null,
    { timeout: 30_000 },
  );
  if ((await handle.jsonValue()) === "error") {
    const message = await page.evaluate(() => document.documentElement.dataset.labError ?? "");
    throw new Error(`the direction crashed: ${message}`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Live orbs fade in over their first frame; posters (no WebGL2) have no canvas to wait for.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("[data-aura-orb] canvas")].every(
          (canvas) => getComputedStyle(canvas).opacity === "1",
        ),
      null,
      { timeout: 6000 },
    )
    .catch(() => {});
  // Finite CSS and Web Animations (entrances, fades) finish; endless ones (drifts) do not count.
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((animation) => {
          const end = animation.effect?.getComputedTiming().endTime;
          return animation.playState !== "running" || end === undefined || !Number.isFinite(end);
        }),
      null,
      { timeout: 6000 },
    )
    .catch(() => {});
  await page.waitForTimeout(settleMs);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function directionIds(browser, base, wanted) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    // A page that is no direction: the lab boots (and lists its directions) without rendering one.
    await page.goto(`${base}#/-`);
    const known = await page.waitForFunction(
      () => window.__designLab?.directions.map((direction) => direction.id) ?? false,
      null,
      { timeout: 30_000 },
    );
    const ids = await known.jsonValue();
    if (wanted === "all") return ids;
    if (!ids.includes(wanted)) {
      throw new Error(`no direction "${wanted}" (known: ${ids.join(", ")}).`);
    }
    return [wanted];
  } finally {
    await context.close();
  }
}

async function shoot(browser, engine, base, direction, options, written, failures) {
  const folder = join(options.out, direction);
  mkdirSync(folder, { recursive: true });

  for (const shot of SHOTS) {
    if (options.only && !options.only.has(shot.name)) continue;
    const query = ["hud=0", shot.query].filter(Boolean).join("&");
    const url = `${base}#/${direction}/${shot.path}?${query}`;
    const file = join(folder, `${engine}-${shot.name}.png`);
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: "dark",
      reducedMotion: shot.reducedMotion ? "reduce" : "no-preference",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await settle(page, options.settle);
      await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
      written.push(file);
      console.log(`  ${file}${errors.length ? `  (page errors: ${errors.join("; ")})` : ""}`);
    } catch (error) {
      if (aborting) return;
      failures.push(`${engine} ${direction} ${shot.name}: ${error.message}`);
      console.error(`  failed: ${engine} ${shot.name}: ${error.message}`);
    } finally {
      await context.close().catch(() => {});
    }
  }

  if (!options.video) return;
  const videoDir = join(RUN_DIR, `video-${engine}-${direction}`);
  const file = join(folder, `${engine}-streaming.webm`);
  let context;
  try {
    context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: "dark",
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
  } catch (error) {
    console.log(`  (no video in ${engine}: ${error.message.split("\n")[0]})`);
    return;
  }
  try {
    const page = await context.newPage();
    // Frozen at t=0 until the page has settled, then played in real time from the start.
    await page.goto(`${base}#/${direction}/streaming?t=0&hud=0`);
    await settle(page, 0);
    await page.evaluate(() => {
      const player = window.__designLab?.player;
      if (!player) throw new Error("the stage exposed no player");
      player.seek(0);
      player.play();
    });
    await page.waitForTimeout(VIDEO_MS);
    const video = page.video();
    await context.close();
    context = null;
    if (!video) throw new Error("the engine produced no video");
    rmSync(file, { force: true });
    renameSync(await video.path(), file);
    written.push(file);
    console.log(`  ${file}`);
  } catch (error) {
    if (aborting) return;
    failures.push(`${engine} ${direction} video: ${error.message}`);
    console.error(`  failed: ${engine} video: ${error.message}`);
  } finally {
    await context?.close().catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
  }
}

/* ----------------------------------------------------------------------------------- main */

async function main() {
  const options = parseOptions();
  const base = await startServer(options);
  console.log(`shooting ${base}`);
  const written = [];
  const failures = [];

  for (const engine of options.engines) {
    if (aborting) break;
    const browser = await launch(engine);
    try {
      const ids = await directionIds(browser, base, options.direction);
      for (const direction of ids) {
        console.log(`${engine} / ${direction}`);
        await shoot(browser, engine, base, direction, options, written, failures);
      }
    } finally {
      await browser.close();
    }
  }

  console.log(`\nwrote ${written.length} file${written.length === 1 ? "" : "s"}:`);
  for (const file of written) console.log(file);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  if (!aborting) console.error(`shoot: ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
