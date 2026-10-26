// Windows-only external full-app gate. Build the frontend into the native binary first.
// Setup invokes only project_create for our disposable folder. All chat input and assertions use
// W3C WebDriver endpoints against the actual desktop window, never an embedded smoke report.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { until, verifyRuntime, WebDriver } from "./webdriver-client.mjs";

export function isolatedEnvironment(source, root) {
  assert(isAbsolute(root));
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (
      /^(AURACODE_|WEBVIEW2_|TAURI_|CLAUDE_CONFIG_DIR$|CODEX_HOME$|PI_CODING_AGENT_DIR$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|XDG_CONFIG_HOME$)/i.test(
        name,
      )
    )
      delete env[name];
  }
  return {
    ...env,
    AURACODE_DATA_DIR: join(root, "data"),
    WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    APPDATA: join(root, "home", "AppData", "Roaming"),
    LOCALAPPDATA: join(root, "home", "AppData", "Local"),
    XDG_CONFIG_HOME: join(root, "home", ".config"),
    CLAUDE_CONFIG_DIR: join(root, "home", ".claude"),
    CODEX_HOME: join(root, "home", ".codex"),
    PI_CODING_AGENT_DIR: join(root, "home", ".pi"),
    CI: "true",
  };
}

const byTest = (name) => `[data-testid="${name}"]`;
const ECHO = "External native WebDriver hello";
const PROMPT = `/echo ${ECHO}`;

export async function exerciseApp(driver, folder, save, checks = []) {
  const passed = (name) => {
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  const windows = await driver.command("GET", "/window/handles");
  assert.equal(windows.length, 1, "expected exactly one native app window");
  await driver.command("POST", "/window", { handle: windows[0] });
  await driver.command("POST", "/window/rect", { width: 1200, height: 900 });
  await until("visible native document", () =>
    driver.script("return document.visibilityState === 'visible' && !!window.__TAURI_INTERNALS__"),
  );
  const url = await driver.command("GET", "/url");
  assert.match(
    url,
    /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)(\/|$)/,
    "use an embedded build, not Vite",
  );
  passed("native-window");

  // Real native project validation and persistence, but only within the test's freshly created path.
  const project = await driver.script(
    `const done = arguments[arguments.length - 1];
     window.__TAURI_INTERNALS__.invoke('project_create', {request: {
       project: {name: 'WebDriver project', color: null, default_agent: 'mock', default_model: null},
       folder: arguments[0]
     }}).then(value => done({value}), error => done({error: JSON.stringify(error)}));`,
    [folder],
    true,
  );
  assert(!project.error, `disposable project setup failed: ${project.error}`);
  const folderId = project.value?.folders?.[0]?.id;
  assert.match(folderId ?? "", /^[a-zA-Z0-9-]+$/);
  await driver.command("POST", "/refresh", {});
  await until("setup intro finished", () =>
    driver.script(
      "return !!document.querySelector('.setup-shell') && !document.querySelector('[data-cinematic]')",
    ),
  );
  await driver.click("//button[normalize-space(.)='Skip setup']", "xpath");
  await until("new chat form", () => driver.visible(byTest("new-chat")));
  await driver.click(`select[aria-label="Project folder"] option[value="${folderId}"]`);
  await driver.click(`${byTest("new-chat-agent")} option[value="mock"]`);
  const selected = await driver.visible(byTest("new-chat-agent"));
  assert.equal(await driver.element(selected, "GET", "property/value"), "mock");
  await driver.click(byTest("new-chat-create"));
  await until("ready demo session", () =>
    driver.visible(`${byTest("chat-status")}[data-test-status="ready"]`),
  );
  passed("create-demo-chat");

  await driver.type(byTest("composer-input"), PROMPT);
  await driver.click(byTest("composer-send"));
  await assertTranscript(driver, PROMPT, ECHO, "end_turn");
  await save("echo");
  passed("typed-prompt-visible-reply");

  await driver.type(byTest("composer-input"), "/slow");
  await driver.click(byTest("composer-send"));
  await driver.click(byTest("composer-stop"));
  await until("cancelled turn", () =>
    driver.visible('[data-test-prompt="/slow"][data-test-stop-reason="cancelled"]'),
  );
  passed("interrupt-active-turn");
  await driver.click('summary[aria-label="Chat details and controls"]');
  await driver.click(byTest("chat-stop-session"));
  await until("stopped demo session", () =>
    driver.visible(`${byTest("chat-status")}[data-test-status="stopped"]`),
  );
  await save("stopped");

  await driver.command("POST", "/refresh", {});
  await driver.click(byTest("chat-row"));
  await until("reopened stopped chat", () =>
    driver.visible(`${byTest("chat-status")}[data-test-status="stopped"]`),
  );
  await driver.scroll(byTest("transcript"), -2000);
  await assertTranscript(driver, PROMPT, ECHO, "end_turn");
  const prompts = await driver.elements(byTest("prompt-text"));
  assert.equal(prompts.length, 2, "reload must retain both turns without sending another prompt");
  await save("reopened");
  passed("reload-retains-history-without-starting-agent");
  return checks;
}

async function assertTranscript(driver, prompt, answer, reason) {
  await until("visible completed echo", async () => {
    const user = await driver.visible(byTest("prompt-text"));
    const message = await driver.visible('[data-testid="item"][data-test-kind="message"]');
    const ended = await driver.visible(`[data-test-stop-reason="${reason}"]`);
    return (
      user &&
      message &&
      ended &&
      (await driver.element(user, "GET", "text")) === prompt &&
      (await driver.element(message, "GET", "text")) === answer
    );
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export async function run(args) {
  assert.equal(process.platform, "win32", "this gate needs Windows WebView2");
  assert.equal(
    args.length,
    4,
    "usage: webdriver-smoke.mjs <app.exe> <tauri-driver.exe> <msedgedriver.exe> <artifacts>",
  );
  const [application, driverPath, nativePath, artifactRoot] = args.map((path) => resolve(path));
  for (const path of [application, driverPath, nativePath]) {
    assert(
      path.toLowerCase().endsWith(".exe") && (await stat(path)).isFile(),
      `not an executable: ${path}`,
    );
  }
  const expected = process.env.EXPECTED_WEBVIEW_VERSION;
  assert.match(expected ?? "", /^\d+\.\d+\.\d+\.\d+$/, "EXPECTED_WEBVIEW_VERSION is required");
  assert(
    !Object.keys(process.env).some((key) => /^WEBVIEW2_/i.test(key) && process.env[key]),
    "remove inherited WebView2 overrides before this gate",
  );
  await mkdir(artifactRoot, { recursive: true });
  const artifacts = await mkdtemp(join(artifactRoot, "run-"));
  const root = await mkdtemp(join(tmpdir(), "auracode-webdriver-"));
  const folder = join(root, "project with spaces");
  const env = isolatedEnvironment(process.env, root);
  for (const directory of [folder, env.HOME, env.APPDATA, env.LOCALAPPDATA])
    await mkdir(directory, { recursive: true });
  const port = await freePort();
  let nativePort = await freePort();
  while (nativePort === port) nativePort = await freePort();
  const child = spawn(
    driverPath,
    ["--port", String(port), "--native-port", String(nativePort), "--native-driver", nativePath],
    {
      env,
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const report = {
    ok: false,
    application,
    expected_runtime: expected,
    runtime: null,
    checks: [],
    error: null,
    cleanup: null,
  };
  let log = "";
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-1_048_576);
    });
  const driver = new WebDriver(`http://127.0.0.1:${port}`);
  const evidence = async (name) => {
    const source = await driver.command("GET", "/source");
    await writeFile(join(artifacts, `${name}.html`), source);
    const screenshot = await driver.command("GET", "/screenshot");
    await writeFile(join(artifacts, `${name}.png`), Buffer.from(screenshot, "base64"));
  };
  // tauri-driver 2.1.0 owns a Windows kill-on-close Job Object. Killing only this still-owned child
  // closes that job and its app/EdgeDriver descendants, including failed session startup.
  const watchdog = setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 240_000);
  const stopOnSignal = () => {
    if (child.exitCode === null) child.kill();
  };
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);
  try {
    await until("external driver", async () => {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, "tauri-driver exited before opening a session");
      try {
        return (await driver.request("GET", "/status", undefined, 2_000))?.ready;
      } catch (error) {
        // The proxy may bind before EdgeDriver does. Only startup transport failures retry;
        // a returned WebDriver protocol error remains actionable and fails immediately.
        if (
          ["ECONNREFUSED", "UND_ERR_SOCKET"].includes(error.cause?.code) ||
          error.name === "TimeoutError"
        )
          return false;
        throw error;
      }
    });
    report.runtime = verifyRuntime(await driver.open(application), expected);
    await exerciseApp(driver, folder, evidence, report.checks);
    report.ok = true;
  } catch (error) {
    report.error = error.stack ?? String(error);
    if (driver.session) await evidence("failure").catch(() => {});
  } finally {
    try {
      await driver.close();
    } catch (error) {
      report.cleanup = `session close: ${error.message}`;
      report.ok = false;
    }
    stopOnSignal();
    const deadline = Date.now() + 10_000;
    while (
      child.exitCode === null &&
      child.signalCode === null &&
      !spawnError &&
      Date.now() < deadline
    )
      await delay(50);
    if (child.exitCode === null && child.signalCode === null && !spawnError) {
      report.cleanup = "tauri-driver did not confirm exit; its owned job cleanup is unconfirmed";
      report.ok = false;
    }
    clearTimeout(watchdog);
    process.removeListener("SIGINT", stopOnSignal);
    process.removeListener("SIGTERM", stopOnSignal);
    await writeFile(join(artifacts, "driver.log"), log);
    await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`WebDriver evidence: ${artifacts}`);
  assert(report.ok, report.error ?? report.cleanup ?? "external smoke failed");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
