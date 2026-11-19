import assert from "node:assert/strict";
import test from "node:test";
import { artifacts, plan, workspaceVersion } from "./release-plan.mjs";

const NAMES = [
  "auracode_0.2.0_universal.dmg",
  "auracode.app.tar.gz",
  "auracode.app.tar.gz.sig",
  "auracode_0.2.0_x64-setup.exe",
  "auracode_0.2.0_x64-setup.exe.sig",
  "auracode_0.2.0_arm64-setup.exe",
  "auracode_0.2.0_arm64-setup.exe.sig",
  "auracode_0.2.0_amd64.AppImage",
  "auracode_0.2.0_amd64.AppImage.sig",
  "auracode_0.2.0_amd64.deb",
  "auracode_0.2.0_amd64.deb.sig",
  "auracode-0.2.0-1.x86_64.rpm",
  "auracode-0.2.0-1.x86_64.rpm.sig",
];
const CARGO = `[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.2.0"\nedition = "2024"\n\n[workspace.dependencies]\nserde = "1"\n`;

test("every role gets its one package, and every updater package its signature", () => {
  const found = artifacts(NAMES);
  assert.deepEqual(
    found.map(({ kind, file, signature }) => [kind, file, signature]),
    [
      ["macos_universal_dmg", "auracode_0.2.0_universal.dmg", null],
      ["macos_universal_updater", "auracode.app.tar.gz", "auracode.app.tar.gz.sig"],
      ["windows_x64_nsis", "auracode_0.2.0_x64-setup.exe", "auracode_0.2.0_x64-setup.exe.sig"],
      [
        "windows_arm64_nsis",
        "auracode_0.2.0_arm64-setup.exe",
        "auracode_0.2.0_arm64-setup.exe.sig",
      ],
      ["linux_x64_appimage", "auracode_0.2.0_amd64.AppImage", "auracode_0.2.0_amd64.AppImage.sig"],
      ["linux_x64_deb", "auracode_0.2.0_amd64.deb", "auracode_0.2.0_amd64.deb.sig"],
      ["linux_x64_rpm", "auracode-0.2.0-1.x86_64.rpm", "auracode-0.2.0-1.x86_64.rpm.sig"],
    ],
  );
});

test("a missing, doubled, unsigned or unexpected file stops the plan", () => {
  assert.throws(() => artifacts(NAMES.filter((name) => !name.endsWith(".deb"))), /linux_x64_deb/u);
  assert.throws(() => artifacts([...NAMES, "auracode_0.1.0_amd64.deb"]), /found 2/u);
  assert.throws(
    () => artifacts(NAMES.filter((name) => name !== "auracode_0.2.0_x64-setup.exe.sig")),
    /no updater signature/u,
  );
  assert.throws(() => artifacts([...NAMES, "notes.txt"]), /Unexpected files/u);
});

test("the version is the workspace package's", () => {
  assert.equal(workspaceVersion(CARGO), "0.2.0");
  assert.throws(() => workspaceVersion('[package]\nversion = "1.0.0"\n'), /workspace\.package/u);
});

test("the plan carries the channel, trimmed notes and the trusted key", () => {
  const result = plan({
    names: NAMES,
    cargoToml: CARGO,
    channel: "staging",
    notes: "  Linux packages.\n",
    publicKey: " public-key-text \n",
    date: "2026-11-06T00:00:00Z",
  });
  assert.equal(result.channel, "staging");
  assert.equal(result.version, "0.2.0");
  assert.equal(result.notes, "Linux packages.");
  assert.equal(result.public_key, "public-key-text");
  assert.equal(result.artifacts.length, 7);
  const base = { names: NAMES, cargoToml: CARGO, notes: "n", publicKey: "k", date: "d" };
  assert.throws(() => plan({ ...base, channel: "beta" }), /staging or stable/u);
  assert.throws(() => plan({ ...base, channel: "stable", notes: " " }), /notes/u);
  assert.throws(() => plan({ ...base, channel: "stable", publicKey: "" }), /PUBLIC_KEY/u);
});

test("a numbered build's plan takes its version, and refuses a package built as another", () => {
  const base = {
    cargoToml: CARGO,
    channel: "stable",
    notes: "n",
    publicKey: "k",
    date: "2026-11-19T05:00:00Z",
  };
  const numbered = NAMES.map((name) => name.replaceAll("0.2.0", "0.1.1570"));
  const result = plan({ ...base, names: numbered, version: "0.1.1570" });
  assert.equal(result.version, "0.1.1570");
  assert.equal(result.publisher_signed, false, "no publisher signed it unless the plan says so");
  assert.equal(
    plan({ ...base, names: numbered, version: "0.1.1570", publisherSigned: true }).publisher_signed,
    true,
  );
  // The workspace's own version when the build was given none.
  assert.equal(plan({ ...base, names: NAMES }).version, "0.2.0");
  assert.equal(plan({ ...base, names: NAMES, version: "  " }).version, "0.2.0");
  // Packages of the workspace version are not this build's.
  assert.throws(
    () => plan({ ...base, names: NAMES, version: "0.1.1570" }),
    /was not built as version 0\.1\.1570/u,
  );
  for (const version of ["v0.1.1570", "0.1", "0.1.1570-beta", "0.1.1570+5", "latest"]) {
    assert.throws(
      () => plan({ ...base, names: numbered, version }),
      /three plain numbers/u,
      version,
    );
  }
});
