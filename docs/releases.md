# Windows and macOS packaging

The manual `Build` workflow produces unsigned acceptance artifacts for three explicit targets:

| Target | Installer | Native acceptance still required |
|---|---|---|
| `universal-apple-darwin` | Universal DMG | Apple Silicon and Intel installation, launch and upgrade |
| `x86_64-pc-windows-msvc` | x64 NSIS | Windows x64 install, upgrade and uninstall |
| `aarch64-pc-windows-msvc` | arm64 NSIS | Windows arm64 install, upgrade and uninstall |

The Windows arm64 installer is cross-compiled on the Windows runner. This verifies compilation,
not execution on an arm64 device. The runner needs the MSVC arm64 build tools. Both macOS Rust
targets are installed before the universal build. Linux and WSL packages are deferred.

These artifacts are labeled `auracode-unsigned-<target>-<SHA>`, expire after seven days, and are
never published automatically. macOS uses an explicit ad-hoc signature. Neither an ad-hoc signature
nor an unsigned Windows installer establishes a trusted public release. No platform security
settings are changed to make a development installer run.

`pnpm bundle` forwards the requested Tauri target and formats and remaps source paths from the
build home, Cargo registry, Rust toolchain and checkout. It preserves existing encoded Rust flags
and uses encoded arguments so Windows paths containing spaces remain intact. This is build tooling;
runtime update and release validation logic remain Rust. Existing macOS local-signing behavior is
preserved, while CI explicitly selects its ad-hoc identity.

The release milestone still needs a backed-up Tauri updater key, trusted public key configuration,
macOS Developer ID signing and notarization, the selected Windows signing mechanism, signed updater
artifacts and checksums, the public release-only R2 route, and an old-build update dry run. The private
encrypted blob bucket must stay private. No signing key is fabricated or recovered from credentials.

## Signed updater preparation

`pnpm bundle --signed-updater --target <target> --bundles <format>` adds the checked-in updater
artifact configuration. It refuses to start without both `AURACODE_UPDATER_PUBLIC_KEY` and
`TAURI_SIGNING_PRIVATE_KEY`. Supply these through the release environment, with optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; never put private material on a command line or in source.
The public key is embedded at compile time. Key creation, safe backup and deployment are explicit
release prerequisites, not operations performed by this command. Platform code signing and
notarization remain separate from the Tauri updater signature.

The pinned CLI binds updater signatures to the app version automatically during `tauri build`.
Manual artifact signing must use its `--app-version` option. The client rejects a valid signature
for a different advertised version, as well as modified bytes and older release versions.

## Rust application update contract

- `app_update_status` reads in-memory state without network access. Builds with no embedded public
  key report `disabled`. There are no startup update requests.
- `app_update_check` explicitly reads the fixed HTTPS manifest at `download.auracode.si/latest.json`.
  Metadata is limited to 64 KiB. Target and newer-version selection use the pinned Tauri updater.
- `app_update_download` explicitly downloads at most 512 MiB from the same host under `/releases/`,
  with no redirects, URL credentials, query parameters or plaintext transport. It verifies the
  package and signed version before retaining bytes in memory. Interrupted downloads can be retried.
- `app_update_install` requires a verified download and reserves idle admission atomically. It
  returns `waiting_for_idle` while any agent process, terminal reservation, owned folder mutation or
  vendor update runs. Stop agents and close terminals, then retry; parked prompts stay persisted.
  The command never stops active work merely to create an update opportunity.
- Installation flushes drafts and confirms store shutdown through the existing quit machinery.
  Updates refuse the ordinary quit option to discard unsaved work. The task survives a lost IPC
  caller. Only after confirmed cleanup does Tauri verify again and install; Windows then exits
  itself, while macOS restarts. A cleanup or installer failure after closing storage reports
  `restart_required` and asks the user to restart before retrying.

No updater plugin permissions are granted to the webview. All decisions, network traffic, bounds,
verification and cleanup run in Rust. The thin interface should poll status while an explicit
operation runs, show returned errors, and require an Install action. A signed staging upgrade and
signature-mismatch fixture using the actual installer remain required before public distribution.

Source references checked for this implementation:
[Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[universal macOS builds](https://v2.tauri.app/distribute/app-store/),
[updater artifacts and signatures](https://v2.tauri.app/plugin/updater/), and
[Windows code signing](https://tauri.app/distribute/sign/windows/).
