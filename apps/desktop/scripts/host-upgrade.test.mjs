import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  backupsSince,
  cancel,
  cleanEnv,
  EXIT,
  folders,
  hostProcesses,
  install,
  newestInstaller,
  restoreApp,
  rollback,
  stampOf,
  toPrune,
  waiterCommandLine,
} from "./host-upgrade.mjs";

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "host-upgrade-"));
  temps.push(dir);
  return dir;
}

function write(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** An installed app, its data folder and the state folder, all under a temporary folder. */
function machine(build = "old") {
  const root = temp();
  const paths = {
    installDir: join(root, "auracode"),
    dataDir: join(root, "si.auracode.desktop"),
    stateDir: join(root, "auracode-upgrades"),
  };
  write(join(paths.installDir, "auracode.exe"), build);
  write(join(paths.installDir, "uninstall.exe"), "uninstaller");
  write(join(paths.installDir, "resources", "notices.txt"), build);
  const installer = join(root, "bundle", "auracode_0.1.0_x64-setup.exe");
  write(installer, "installer");
  return { root, paths, installer };
}

/**
 * A fake machine. `running` says whether the app runs; `install` stands for the installer, and
 * `launch` for starting the app (which runs unless `staysUp` is false).
 */
function fakeSystem(
  paths,
  { running = false, installCode = 0, staysUp = true, helpers = [] } = {},
) {
  const calls = [];
  const state = { running, helpers: [...helpers], times: 0 };
  const exe = join(paths.installDir, "auracode.exe");
  return {
    calls,
    state,
    processes() {
      const list = state.helpers.map((pid) => ({
        ProcessId: pid,
        ExecutablePath: exe,
        CommandLine: `"${exe}" --aura-memory-helper --mcp`,
      }));
      if (state.running)
        list.push({ ProcessId: 100, ExecutablePath: exe, CommandLine: `"${exe}"` });
      return list.concat(state.extra ?? []);
    },
    stop(pid) {
      calls.push(["stop", pid]);
      state.helpers = state.helpers.filter((helper) => helper !== pid);
      if (state.extra) state.extra = state.extra.filter((p) => p.ProcessId !== pid);
    },
    install(installer) {
      calls.push(["install", installer]);
      if (installCode === 0) {
        writeFileSync(exe, "new");
        writeFileSync(join(paths.installDir, "resources", "notices.txt"), "new");
      } else {
        writeFileSync(exe, "half");
      }
      return installCode;
    },
    launch(path) {
      calls.push(["launch", path, readFileSync(path, "utf8")]);
      state.running = staysUp || readFileSync(path, "utf8") === "old";
    },
    startOutsideJob(commandLine, cwd) {
      calls.push(["startOutsideJob", commandLine, cwd]);
      state.extra = [{ ProcessId: 4242, ExecutablePath: "node.exe", CommandLine: commandLine }];
      return 4242;
    },
    sleep: async () => {
      state.times++;
      // The app quits once, while the waiter waits.
      if (state.times === state.quitAfter) state.running = false;
    },
    now: () => new Date(2026, 10, 1, 13, 5, 54),
  };
}

const options = (extra = {}) => ({
  installer: undefined,
  afterExit: false,
  wait: 0,
  keep: 3,
  healthSeconds: 20,
  snapshot: undefined,
  restoreDatabase: false,
  ...extra,
});

function recorder() {
  const lines = [];
  const log = (line) => lines.push(line);
  log.lines = lines;
  return log;
}

test("the folders come from LOCALAPPDATA unless overridden", () => {
  const paths = folders({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" });
  assert.equal(paths.installDir, join("C:\\Users\\a\\AppData\\Local", "auracode"));
  assert.equal(paths.dataDir, join("C:\\Users\\a\\AppData\\Local", "si.auracode.desktop"));
  assert.equal(paths.stateDir, join("C:\\Users\\a\\AppData\\Local", "auracode-upgrades"));
  // AURACODE_DATA_DIR belongs to development launches, never to the installed app here.
  assert.equal(
    folders({ LOCALAPPDATA: "C:\\L", AURACODE_DATA_DIR: "C:\\scratch" }).dataDir,
    join("C:\\L", "si.auracode.desktop"),
  );
  assert.throws(() => folders({}), /LOCALAPPDATA/u);
});

test("only the installed app's processes count, and helpers apart", () => {
  const install = "C:\\Users\\a\\AppData\\Local\\auracode";
  const { app, helpers } = hostProcesses(
    [
      { ProcessId: 1, ExecutablePath: `${install}\\auracode.exe`, CommandLine: "auracode.exe" },
      {
        ProcessId: 2,
        ExecutablePath: `${install.toUpperCase()}\\AURACODE.EXE`,
        CommandLine: "auracode.exe --aura-memory-helper --mcp",
      },
      // A development build is never the host.
      { ProcessId: 3, ExecutablePath: "C:\\src\\target\\debug\\auracode.exe", CommandLine: "" },
      { ProcessId: 4, ExecutablePath: `${install}-old\\auracode.exe`, CommandLine: "" },
      { ProcessId: 5, ExecutablePath: null, CommandLine: null },
    ],
    install,
  );
  assert.deepEqual(
    app.map((p) => p.ProcessId),
    [1],
  );
  assert.deepEqual(
    helpers.map((p) => p.ProcessId),
    [2],
  );
});

test("the newest installer wins across target layouts", () => {
  const root = temp();
  const older = join(root, "release", "bundle", "nsis", "auracode_0.1.0_x64-setup.exe");
  const newer = join(
    root,
    "x86_64-pc-windows-msvc",
    "release",
    "bundle",
    "nsis",
    "auracode_0.1.0_x64-setup.exe",
  );
  write(older, "a");
  write(newer, "b");
  write(join(root, "release", "bundle", "nsis", "notes.txt"), "c");
  utimesSync(older, new Date(2026, 0, 1), new Date(2026, 0, 1));
  assert.equal(newestInstaller([undefined, join(root, "missing"), root]), newer);
  assert.equal(newestInstaller([join(root, "missing")]), undefined);
});

test("snapshot names sort by time and the newest are kept", () => {
  assert.equal(stampOf(new Date(2026, 10, 1, 9, 5, 4)), "20261101-090504");
  assert.deepEqual(toPrune(["20261101-090504", "20261102-000000", "20261031-235959"], 2), [
    "20261031-235959",
  ]);
  assert.deepEqual(toPrune(["a"], 3), []);
});

test("the backup to restore is the first made after the snapshot, per database", () => {
  const profiles = join(temp(), "profiles");
  const backups = join(profiles, "local", "backups");
  mkdirSync(backups, { recursive: true });
  for (const name of [
    "aura.db.v13-1000.bak",
    "aura.db.v15-3000.bak",
    "aura.db.v18-5000.bak",
    "aura.encrypted.db.v4-4000.bak",
    "aura.db.corrupt-6000",
    "notes.txt",
  ]) {
    writeFileSync(join(backups, name), name);
  }
  mkdirSync(join(profiles, "empty"));
  const restores = backupsSince(profiles, 2000).sort((a, b) => a.backup.localeCompare(b.backup));
  assert.deepEqual(
    restores.map((r) => [r.database, r.backup, r.schema]),
    [
      [join(profiles, "local", "aura.db"), join(backups, "aura.db.v15-3000.bak"), 15],
      [
        join(profiles, "local", "aura.encrypted.db"),
        join(backups, "aura.encrypted.db.v4-4000.bak"),
        4,
      ],
    ],
  );
  assert.deepEqual(backupsSince(profiles, 9000), []);
  assert.deepEqual(backupsSince(join(profiles, "missing"), 0), []);
});

test("the relaunch and the waiter never inherit an agent session's variables", () => {
  assert.deepEqual(
    cleanEnv({
      PATH: "p",
      LOCALAPPDATA: "l",
      AURACODE_DATA_DIR: "x",
      AURACODE_SMOKE: "1",
      AURA_MCP_0_env_1: "token",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_PID: "1",
      CLAUDE_CONFIG_DIR: "kept",
    }),
    { PATH: "p", LOCALAPPDATA: "l", CLAUDE_CONFIG_DIR: "kept" },
  );
});

test("the waiter's command line quotes every argument", () => {
  assert.equal(
    waiterCommandLine("C:\\Program Files\\nodejs\\node.exe", "C:\\s\\host-upgrade.mjs", [
      "install",
      "--wait",
      "30",
    ]),
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\s\\host-upgrade.mjs" "install" "--wait" "30"',
  );
  assert.throws(() => waiterCommandLine("node", "s", ['a"b']), /quote/u);
});

test("an install keeps the old app, installs, starts the new one and keeps it", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths);
  const log = recorder();
  assert.equal(await install(options({ installer }), paths, system, log), EXIT.done);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "new");
  const [name] = readdirSync(join(paths.stateDir, "snapshots"));
  assert.equal(name, "20261101-130554");
  const kept = join(paths.stateDir, "snapshots", name);
  assert.equal(readFileSync(join(kept, "app", "auracode.exe"), "utf8"), "old");
  assert.equal(readFileSync(join(kept, "app", "resources", "notices.txt"), "utf8"), "old");
  const record = JSON.parse(readFileSync(join(kept, "snapshot.json"), "utf8"));
  assert.equal(record.replacedBy, installer);
  assert.equal(record.created, new Date(2026, 10, 1, 13, 5, 54).getTime());
  assert.deepEqual(
    system.calls.map((call) => call[0]),
    ["install", "launch"],
  );
  assert.match(log.lines.at(-1), /Undo with: rollback --snapshot 20261101-130554/u);
});

test("an install never runs while the app runs", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { running: true });
  const log = recorder();
  assert.equal(await install(options({ installer }), paths, system, log), EXIT.running);
  assert.deepEqual(system.calls, []);
  assert.equal(existsSync(join(paths.stateDir, "snapshots")), false);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "old");
  assert.match(log.lines.at(-1), /Quit it first, or arm the install with --after-exit/u);
});

test("a waiting install starts when the app quits and stops helpers it left", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { running: true, helpers: [7] });
  system.state.quitAfter = 3;
  const log = recorder();
  assert.equal(await install(options({ installer, wait: 30 }), paths, system, log), EXIT.done);
  assert.deepEqual(system.calls[0], ["stop", 7]);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "new");
});

test("a waiting install gives up when the app does not quit in time", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { running: true });
  // A sleep that lets the wait run out at once.
  system.sleep = async () => {
    const now = Date.now;
    Date.now = () => now() + 31 * 60_000;
  };
  const realNow = Date.now;
  try {
    const log = recorder();
    assert.equal(await install(options({ installer, wait: 30 }), paths, system, log), EXIT.running);
    assert.match(log.lines.at(-1), /did not quit within 30 minutes; nothing was installed/u);
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(system.calls, []);
});

test("a build that does not stay up is replaced by the snapshot", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { staysUp: false });
  const log = recorder();
  assert.equal(await install(options({ installer }), paths, system, log), EXIT.failed);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "old");
  assert.equal(readFileSync(join(paths.installDir, "resources", "notices.txt"), "utf8"), "old");
  assert.deepEqual(
    system.calls.map((call) => call.slice(0, 1).concat(call[2] ?? [])),
    [["install"], ["launch", "new"], ["launch", "old"]],
  );
  assert.match(log.lines.join("\n"), /did not stay up for 20 seconds; restoring snapshot/u);
  assert.equal(
    readdirSync(join(paths.installDir, "..")).filter((n) => n.includes(".replaced-")).length,
    0,
  );
});

test("a failed installer is undone", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { installCode: 2 });
  const log = recorder();
  assert.equal(await install(options({ installer }), paths, system, log), EXIT.failed);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "old");
  assert.match(log.lines.join("\n"), /installer exited with code 2/u);
});

test("an install without an installer or an install to keep changes nothing", async () => {
  const { paths, root } = machine();
  const log = recorder();
  const missing = join(root, "nope-setup.exe");
  assert.equal(
    await install(options({ installer: missing }), paths, fakeSystem(paths), log),
    EXIT.usage,
  );
  rmSync(join(paths.installDir, "uninstall.exe"));
  await assert.rejects(
    install(
      options({ installer: join(root, "bundle", "auracode_0.1.0_x64-setup.exe") }),
      paths,
      fakeSystem(paths),
      log,
    ),
    /holds no installed auracode/u,
  );
});

test("arming starts one waiter outside the job, from copies", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths, { running: true });
  const log = recorder();
  assert.equal(
    await install(options({ installer, afterExit: true, wait: 30 }), paths, system, log),
    EXIT.done,
  );
  const [call] = system.calls;
  assert.equal(call[0], "startOutsideJob");
  const staged = join(paths.stateDir, "pending", "20261101-130554-auracode_0.1.0_x64-setup.exe");
  const runner = join(paths.stateDir, "host-upgrade.mjs");
  assert.ok(existsSync(staged) && existsSync(runner));
  assert.ok(call[1].includes(`"${runner}" "install" "--installer" "${staged}" "--wait" "30"`));
  assert.ok(call[1].includes(`"--install-dir" "${paths.installDir}"`));
  assert.equal(call[2], paths.stateDir);
  assert.equal(JSON.parse(readFileSync(join(paths.stateDir, "armed.json"), "utf8")).pid, 4242);
  // Nothing was installed yet, and the app was not touched.
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "old");

  assert.equal(
    await install(options({ installer, afterExit: true, wait: 30 }), paths, system, log),
    EXIT.running,
  );
  assert.match(log.lines.at(-1), /already armed \(PID 4242\)/u);
  assert.equal(cancel(paths, system, log), EXIT.done);
  assert.deepEqual(system.calls.at(-1), ["stop", 4242]);
  assert.equal(existsSync(join(paths.stateDir, "armed.json")), false);
});

test("a rollback restores the app and, when asked, the migrated databases", async () => {
  const { paths, installer } = machine();
  const system = fakeSystem(paths);
  await install(options({ installer }), paths, system, recorder());
  const snapshot = new Date(2026, 10, 1, 13, 5, 54).getTime();
  const local = join(paths.dataDir, "profiles", "local");
  write(join(local, "aura.db"), "migrated");
  write(join(local, "aura.db-wal"), "migrated wal");
  write(join(local, "backups", `aura.db.v15-${snapshot - 1000}.bak`), "older");
  write(join(local, "backups", `aura.db.v18-${snapshot + 1000}.bak`), "before the new build");

  system.state.running = true;
  const log = recorder();
  assert.equal(
    await rollback(options({ restoreDatabase: true }), paths, system, log),
    EXIT.running,
  );
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "new");

  system.state.running = false;
  assert.equal(await rollback(options({ restoreDatabase: true }), paths, system, log), EXIT.done);
  assert.equal(readFileSync(join(paths.installDir, "auracode.exe"), "utf8"), "old");
  assert.equal(readFileSync(join(local, "aura.db"), "utf8"), "before the new build");
  assert.equal(existsSync(join(local, "aura.db-wal")), false);
  const kept = readdirSync(join(local, "backups")).filter((n) => n.includes(".rolled-back-"));
  assert.deepEqual(kept.sort(), [
    `aura.db.rolled-back-${snapshot}`,
    `aura.db.rolled-back-${snapshot}-wal`,
  ]);
  assert.match(log.lines.join("\n"), /Restored .*aura\.db to schema 18/u);
  assert.deepEqual(system.calls.at(-1).slice(0, 1), ["launch"]);

  assert.equal(await rollback(options({ snapshot: "nope" }), paths, system, log), EXIT.usage);
});

test("a rollback never deletes a folder that is not an install", () => {
  const { paths, root } = machine();
  const snapshot = { dir: join(root, "snap") };
  write(join(snapshot.dir, "app", "auracode.exe"), "old");
  write(join(snapshot.dir, "app", "uninstall.exe"), "u");
  const elsewhere = join(root, "Documents");
  write(join(elsewhere, "thesis.docx"), "keep me");
  assert.throws(() => restoreApp(snapshot, elsewhere), /not an auracode install/u);
  assert.equal(readFileSync(join(elsewhere, "thesis.docx"), "utf8"), "keep me");
  assert.throws(() => restoreApp({ dir: join(root, "empty") }, paths.installDir), /no copy/u);
});
