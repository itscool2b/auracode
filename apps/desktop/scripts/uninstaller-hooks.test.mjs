/**
 * The Windows uninstaller's contract with Tauri's NSIS template, checked without building an
 * installer: the hooks rely on the pinned template's variables and order, and the custom English
 * file must define every string the template uses. Reads the pinned CLI's embedded template when
 * its Windows binary is installed (it is only on Windows).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = resolve(app, "src-tauri");
const config = JSON.parse(readFileSync(resolve(tauri, "tauri.conf.json"), "utf8"));
const nsis = config.bundle.windows.nsis;
const hooks = readFileSync(resolve(tauri, nsis.installerHooks), "utf8");
const english = readFileSync(resolve(tauri, nsis.customLanguageFiles.English), "utf8");

/** The pinned Tauri CLI's Windows binary, which embeds the installer template and its strings. */
function cliBinary() {
  try {
    const cli = createRequire(resolve(app, "package.json")).resolve("@tauri-apps/cli/package.json");
    const native = createRequire(cli).resolve("@tauri-apps/cli-win32-x64-msvc/package.json");
    const binary = resolve(dirname(native), "cli.win32-x64-msvc.node");
    return existsSync(binary) ? readFileSync(binary) : null;
  } catch {
    return null;
  }
}
const binary = process.platform === "win32" ? cliBinary() : null;

/** The installer template embedded in the CLI: from its first line to its last function. */
function template(bytes) {
  const uninstall = bytes.indexOf("Section Uninstall");
  const start = bytes.lastIndexOf("Unicode true", uninstall);
  return bytes.subarray(start, bytes.indexOf(0, start)).toString("utf8");
}

const keys = (text) =>
  [...text.matchAll(/^LangString (\w+) \$\{LANG_ENGLISH\}/gmu)].map((m) => m[1]);

test("the bundle builds only the NSIS installer on Windows, with the hooks and strings", () => {
  assert.deepEqual(config.bundle.targets, ["app", "dmg", "nsis"], "no MSI without the cleanup");
  assert.deepEqual(nsis.languages, ["English"]);
  assert.match(hooks, /^!macro NSIS_HOOK_PREUNINSTALL$/mu);
  assert.match(hooks, /^!macro NSIS_HOOK_POSTUNINSTALL$/mu);
  assert.doesNotMatch(hooks, /—/u, "no em dashes");
  assert.doesNotMatch(english, /—/u, "no em dashes");
});

test("the hooks run the Rust cleanup and keep Tauri from deleting the data folder whole", () => {
  assert.match(hooks, /"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe" --uninstall-cleanup \$R8/u);
  assert.match(hooks, /StrCpy \$DeleteAppDataCheckboxState 0/u);
  // Updates and the uninstall an installer runs before installing keep the data.
  assert.match(hooks, /\$\{If\} \$UpdateMode = 1\s+StrCpy \$AuracodeDeleteData 0/u);
  assert.match(hooks, /\$\{If\} \$EXEDIR == \$INSTDIR\s+StrCpy \$AuracodeDeleteData 0/u);
  assert.match(hooks, /"\/KEEPDATA"/u);
  // A quiet uninstall never shows a dialog.
  assert.match(hooks, /\$\{OrIf\} \$\{Silent\}\s+StrCpy \$R8 ""/u);
  // The exit codes the hooks read are the Rust ones.
  const rust = readFileSync(resolve(tauri, "src/uninstall.rs"), "utf8");
  assert.match(rust, /pub const RUNNING: i32 = 3;/u);
  assert.match(rust, /pub const INCOMPLETE: i32 = 4;/u);
  assert.match(hooks, /\$\{If\} \$R9 = 3/u);
  assert.match(hooks, /\$\{ElseIf\} \$R9 = 4/u);
});

test("the checkbox keeps the data, and every other string is Tauri's", () => {
  assert.match(english, /LangString deleteAppData \$\{LANG_ENGLISH\} "Keep my auracode data/u);
  assert.ok(keys(english).length >= 20);
});

test("the pinned template still inserts the hooks where they rely on it", { skip: !binary }, () => {
  const text = template(binary);
  assert.match(text, /!include "\{\{installer_hooks\}\}"/u);
  assert.match(text, /^Var DeleteAppDataCheckboxState$/mu);
  assert.match(text, /^Var UpdateMode$/mu);
  assert.match(text, /^Var PassiveMode$/mu);
  const section = text.slice(text.indexOf("Section Uninstall"));
  const hook = section.indexOf("!insertmacro NSIS_HOOK_PREUNINSTALL");
  const running = section.indexOf("!insertmacro CheckIfAppIsRunning");
  const removal = section.indexOf(`\${If} $DeleteAppDataCheckboxState = 1`);
  const post = section.indexOf("!insertmacro NSIS_HOOK_POSTUNINSTALL");
  assert.ok(hook >= 0 && hook < running, "the cleanup runs before the app check and file removal");
  assert.ok(running < removal && removal < post, "Tauri's data step reads the reset checkbox");
  assert.match(section.slice(removal, post), /RmDir \/r "\$LOCALAPPDATA\\\$\{BUNDLEID\}"/u);
  assert.match(section.slice(removal, post), /DeleteRegKey SHCTX "\$\{MANUPRODUCTKEY\}"/u);
  // The checkbox is created unticked: ours reads "Keep", so deleting is the default.
  assert.doesNotMatch(text, /DeleteAppDataCheckbox \$\{BM_SETCHECK\}/u);
});

test("the custom English file defines every string the pinned CLI's does", {
  skip: !binary,
}, () => {
  const text = binary.toString("utf8");
  const start = text.indexOf(`LangString addOrReinstall \${LANG_ENGLISH}`);
  const end = text.indexOf("\n", text.indexOf(`LangString deleteAppData \${LANG_ENGLISH}`, start));
  assert.deepEqual(keys(english).sort(), keys(text.slice(start, end)).sort());
});
