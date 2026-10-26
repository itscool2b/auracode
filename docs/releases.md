# Windows and macOS packaging

The owner deferred public signing on 2026-10-26. Complete source and unsigned qualification first.
The signing and signed-update requirements below apply when public distribution is resumed; they
do not block the current implementation work.

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
artifacts, the public release-only R2 route, and an old-build update dry run. The private
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

## Offline artifact preparation

`aura-release` is a Rust release tool, not a publisher or a signer. It accepts an explicit plan and
directory containing exactly the four named package roles: a universal DMG, a universal
`.app.tar.gz` updater, Windows x64 NSIS and Windows ARM64 NSIS. The three updater packages need
their Tauri `.sig` files. The DMG checksum does not establish its code-signing or notarization status.
The tool cannot determine whether a file's declared architecture matches the executable inside it;
native package inspection and installation remain separate gates.

Copy [the example plan](../crates/aura-release/release-plan.example.json) into an owned scratch
directory. Replace its public key, filenames, version, date and release notes with the reviewed
build metadata. The example deliberately contains no valid release key. Never include a private key
in the plan. Run from the repository root:

```sh
cargo run --locked -p aura-release -- prepare path/to/release-plan.json path/to/artifacts path/to/new-stage
cargo run --locked -p aura-release -- verify path/to/new-stage
```

Preparation refuses existing output directories. It bounds each artifact at 512 MiB and metadata at
64 KiB, rejects leaf links and filenames outside the explicit directory, verifies prehashed Minisign
signatures using the supplied public key, and requires the signed version to equal the advertised
version. It streams the exact verified bytes into the new stage. Missing or invalid artifacts leave
`PREPARATION_INCOMPLETE` and no public manifests. Partial output is retained for inspection, never
deleted automatically. A valid stage contains:

- `latest.json`, with both macOS architectures pointing to the universal updater and distinct Windows
  architecture entries, including the NSIS-specific target keys.
- `downloads.json`, the website's version, notes, requirements, architecture links and per-file hashes.
- `SHA256SUMS` and `releases/<version>/SHA256SUMS`, covering package and detached-signature bytes.
- `releases/<version>/`, with copied packages and signatures.
- `release-plan.json` and `COMPLETE`, local preparation records that are not public release objects.

Before verification, set `AURACODE_UPDATER_PUBLIC_KEY` from the independently trusted release
configuration, using the same public key embedded in the application. Never derive that trust input
from the stage being checked. Missing or mismatched pins fail verification. The website build uses
this same environment variable when verifying `AURACODE_RELEASE_STAGE`.

`verify` reads the staged bytes again and compares every generated manifest and checksum. Artifact
opens refuse leaf symlinks atomically, including a link substituted after the initial path checks. A later
change to the original build directory cannot change the copied stage. It does not establish
platform trust, provenance or authorization to publish. Do not upload a whole scratch directory.
Only the reviewed public object list above belongs in the release bucket. Upload immutable versioned
objects first, fetch and verify them, then publish the channel's `latest.json` last. Do not overwrite
the private encrypted blob bucket or an already published version.

The website remains honestly unpublished by default through `app/release-catalog.json`. For a
qualified build, set `AURACODE_RELEASE_STAGE` to the absolute stage directory and run
`pnpm --filter @auracode/web build`. Vite invokes Rust `verify` before reading the generated catalog;
invalid bytes stop the build. The resulting `/download` is prerendered with all architecture links,
checksums and notes, so it works without JavaScript. No runtime browser request activates downloads.
The public catalog types are generated by `cargo run -p aura-release -- export-types`; a Rust parity
test checks the committed TypeScript contract.

## Separate staging qualification

Build the old and candidate qualification applications with `AURACODE_UPDATER_CHANNEL=staging`,
alongside the explicitly supplied updater signing environment described above. Other nonempty
channel values are rejected at build time. These applications read only
`https://download.auracode.si/staging/latest.json`, accept package URLs only below
`/staging/releases/`, and show a staging label in update settings and startup version diagnostics.
Normal builds default to `stable`, read `/latest.json`, and reject staging package URLs. Neither
channel accepts arbitrary runtime endpoints, redirects, credentials, query strings or fragments.

Use `"channel": "staging"` in the corresponding release plan. Its local stage has the same layout,
but every public URL has the `/staging` prefix. The generated website also labels this catalog as a
staging preview. Publish only to that prefix for the old-build upgrade test. A stable application
cannot use that manifest; do not temporarily replace the production manifest for a test. Use an
isolated test data directory and owned fixtures, never a real user's profile, for installer trials.

## Final verification commands and evidence

These commands are prepared for the final Windows/macOS integration checkpoint. They were not
dispatched to hosted CI by the release-readiness work. Run with the pinned pnpm and a qualified
native toolchain. On Windows, vendored OpenSSL needs the selected native Perl from the existing
build prerequisite process. Do not change platform policy if an executable is denied.

```sh
pnpm install --frozen-lockfile
node .github/scripts/check-instructions.mjs
cargo fmt --all --check
cargo test --workspace --all-features --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
bash .github/scripts/export-bindings.sh check target/final-bindings
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @auracode/desktop check:orbit
pnpm --filter @auracode/desktop check:settings
pnpm --filter @auracode/desktop check:setup
pnpm --filter @auracode/desktop exec node scripts/check-library.mjs
pnpm --filter @auracode/desktop exec node scripts/check-config-recovery.mjs
pnpm --filter @auracode/desktop exec node scripts/check-account-vault.mjs
pnpm --filter @auracode/web test:release
pnpm --filter @auracode/web test:browser
pnpm --filter @auracode/desktop tauri build --debug --no-bundle
```

With the frontend embedded, run the synthetic native app smoke on each target. `AURACODE_SMOKE_AGENT`
must be unset. The script uses owned temporary profiles and the built-in demo driver, not a paid
vendor account:

```sh
# macOS
bash .github/scripts/run-smoke.sh target/debug/auracode all
# Windows, from the existing Git Bash runner
bash .github/scripts/run-smoke.sh target/debug/auracode.exe all
```

The native harness covers real webview, IPC, actor, transcript, restart and quit paths. It does not
prove vendor compatibility, packaged installation or independent external WebDriver control. Keep
its result JSON and logs. The settings browser gate also runs Git reviews, setup, account/profile
controls, configuration sync, explicit steering and missing-transcript recovery in Chromium and
WebKit. Those use synthetic commands and do not replace native acceptance.

Unsigned package compilation uses the existing manual `Build` matrix. Individual qualified hosts can
use the same explicit targets locally:

```sh
pnpm bundle --target universal-apple-darwin --bundles dmg
pnpm bundle --target x86_64-pc-windows-msvc --bundles nsis
pnpm bundle --target aarch64-pc-windows-msvc --bundles nsis
```

For signed updater qualification add `--signed-updater` with the secret-store environment already
supplied. Do not put signing values in commands or logs. Verify the final packages after code signing,
notarization and stapling, then prepare the stage from those final bytes.

| Gate | Required evidence before calling it complete |
|---|---|
| macOS universal | Inspect both architecture slices, install and launch on Apple Silicon and Intel; verify configured minimum OS, signature, notarization and staple; retain existing Local and Account data across upgrade |
| Windows x64 and ARM64 | Install, launch, upgrade and uninstall on each architecture; verify Authenticode and WebView2 behavior, including missing-runtime behavior; retain user data and unrelated vendor processes |
| Actual updater | Older staging build downloads and installs a newer staged signed package; tampering and wrong-version signatures refuse installation; interrupted download retries; agents, PTYs, setup/Git work and unsaved drafts prevent unsafe install |
| Release route | Only the dedicated release bucket is public; stable and staging prefixes stay separate; content types, downloads, immutable version objects and short-lived latest manifests behave as reviewed |
| Final visuals and power | Real Windows/macOS screenshots, accessibility and keyboard review against the chosen references; unlocked native visible/minimized/background power measurements and warm-launch timing |

The true external prerequisites are protected updater-key creation and backup, the owner's platform
signing identities and chosen Windows signing service, permissions for the dedicated release route,
qualified Windows ARM64 and both Mac architecture environments, and an unlocked visible desktop for
manual performance/privacy checks. No credential, certificate or account configuration was read or
changed to prepare this tooling. Publication and native signed-upgrade acceptance remain pending.

The M2-M5 audit's reviewed non-Git initialization, project terminal/editor controls and
capability-qualified extra folder forwarding are implemented and have focused local verification.
Their final integrated Windows/macOS qualification remains pending. Account lifecycle recovery and
portable folder resolution are still being completed before that final batch. Exact older-message
native truncation/fork and Pi steering remain unsupported where the recorded protocol cannot safely
identify the requested boundary; the visible reviewed handoff keeps the source conversation intact.

Source references checked for this implementation:
[Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[universal macOS builds](https://v2.tauri.app/distribute/app-store/),
[updater artifacts and signatures](https://v2.tauri.app/plugin/updater/), and
[Windows code signing](https://tauri.app/distribute/sign/windows/).
