# Windows, macOS and Linux packaging

The owner deferred public signing on 2026-10-26 and resumed it with the plan of 2026-11-04: the
`Release` workflow below builds signed releases once the owner's signing credentials are set up.

The manual `Build` workflow produces unsigned acceptance artifacts for four explicit targets:

| Target | Installer | Native acceptance still required |
|---|---|---|
| `universal-apple-darwin` | Universal DMG | Apple Silicon and Intel installation, launch and upgrade |
| `x86_64-pc-windows-msvc` | x64 NSIS | Windows x64 install, upgrade and uninstall |
| `aarch64-pc-windows-msvc` | arm64 NSIS | Windows arm64 install, upgrade and uninstall |
| `x86_64-unknown-linux-gnu` | deb, rpm and AppImage, built on Ubuntu 22.04 | Debian or Ubuntu, Fedora and AppImage install, launch and upgrade |

The Windows arm64 installer is cross-compiled on the Windows runner. This verifies compilation,
not execution on an arm64 device. The runner needs the MSVC arm64 build tools. Both macOS Rust
targets are installed before the universal build. The Linux packages link Ubuntu 22.04's glibc, so
they run there and on newer distributions; the runner installs WebKitGTK 4.1, the AppIndicator,
librsvg, ALSA, libxdo, patchelf and rpm first. WSL agent hosts are separate from these packages.

These artifacts are labeled `auracode-unsigned-<target>-<SHA>`, expire after seven days, and are
never published automatically. macOS uses an explicit ad-hoc signature. Neither an ad-hoc signature
nor an unsigned Windows installer establishes a trusted public release. No platform security
settings are changed to make a development installer run.

`pnpm bundle` forwards the requested Tauri target and formats and remaps source paths from the
build home, Cargo registry, Rust toolchain and checkout. It preserves existing encoded Rust flags
and uses encoded arguments so Windows paths containing spaces remain intact. This is build tooling;
runtime update and release validation logic remain Rust. Existing macOS local-signing behavior is
preserved, while CI explicitly selects its ad-hoc identity.

When public distribution resumes, it needs a backed-up Tauri updater key, trusted public key
configuration, macOS Developer ID signing and notarization, the selected Windows signing mechanism,
signed updater artifacts, the public release-only R2 route, and an old-build update dry run. No
signing key is fabricated or recovered from credentials.

## Preview builds on the website

Until signed releases exist, the download page offers the `Build` workflow's unsigned installers.
They are the files of a GitHub release on this repository, and the page lists them from
`apps/web/app/release-catalog.json`. Owner's rule (18 November 2026): whenever a new build is
made, and for every merge that changes the app, the installers on the website are updated.

1. Build every target from main: `gh workflow run build.yml --ref main`. First run
   `cargo check --release -p auracode-desktop --locked`, since every other build is a debug build.
2. Download the run into a new, empty folder: `gh run download <run id> --dir <folder>`.
3. Gather it (on Linux or in WSL, from the commit that was built):

   ```sh
   cargo run --locked -p aura-release -- preview <folder> <new folder> build-YYYY-MM-DD \
     YYYY-MM-DDTHH:MM:SSZ "Preview build of main through #N."
   ```

   The tag's day and the date are the same UTC day; a later build that day is
   `build-YYYY-MM-DD.2`. The command finds the six installers, refuses a missing or doubled one, a
   link, or a filename that does not carry the workspace version, copies them to `assets/` with
   their `SHA256SUMS`, and writes `downloads.json` last. It checks no signature, because there is
   none: the catalog says `signed: false`, and the page then says the builds are unsigned, that
   they do not update themselves, and how each system treats one.
4. Publish the files: `gh release create build-YYYY-MM-DD <new folder>/assets/* --target <commit>
   --title "auracode <version>, preview build of D Month YYYY" --notes-file <notes>`. The notes
   say what the page says: unsigned, not notarized, no updates, and which builds have been run.
5. Check one link from the catalog downloads with the checksum it lists, then replace
   `apps/web/app/release-catalog.json` with `downloads.json` in a pull request. The site deploys
   from main, so the page changes within minutes of the merge. `pnpm --filter @auracode/web test`
   and `test:browser` read the committed catalog and check the page against it.

The release's links only work while the repository is public: a private repository's release
files need a sign-in. `{ "release": null }` puts the page back to "Installers are on the way".
An older preview release can be deleted once the page no longer points at it.

## Official releases

The manual `Release` workflow (`.github/workflows/release.yml`) builds every target signed, runs
the stage through `aura-release`, and publishes it. It runs from main only.

1. **preflight** stops at once when the run is not on main or any signing input below is missing,
   and when `APPLE_SIGNING_IDENTITY` is not a Developer ID Application identity.
2. **bundle** builds the four targets with `--signed-updater` and the chosen channel compiled in.
   It never uses a build cache.
   - macOS is signed with the Developer ID certificate, notarized with the App Store Connect key and
     stapled, then checked with `codesign`, `spctl` and `stapler`.
   - Windows is signed through Azure Artifact Signing (`artifact-signing-cli` as Tauri's
     `signCommand`). Each installer's Authenticode signature must read Valid.
   - Linux packages carry only their updater signatures.
3. **publish** collects the packages and writes the plan (`.github/scripts/release-plan.mjs`: the
   role of each file, the workspace version). It then runs `aura-release prepare` and `verify`, and
   keeps the manifests as an artifact.
   - With `publish` on, it uploads through `aura-release publish --upload`.
   - For a stable release it then commits the stage's `downloads.json` as
     `apps/web/app/release-catalog.json` to main. The site deploys from main, so the download page
     updates itself.

### One-time setup

Repository variables (Settings > Secrets and variables > Actions > Variables), public values:

| Variable | Value |
|---|---|
| `AURACODE_UPDATER_PUBLIC_KEY` | The Tauri updater public key: the contents of the `.pub` file `tauri signer generate` writes |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (<team ID>)`, as `security find-identity -v -p codesigning` lists it |
| `AZURE_SIGNING_ENDPOINT` | The Artifact Signing account's endpoint, such as `https://eus.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | The Artifact Signing account name |
| `AZURE_SIGNING_PROFILE` | Its certificate profile name |
| `CLOUDFLARE_ACCOUNT_ID` | `5feb14f2fe605875bcf1472f348cb7ed` (infra/README.md) |

Repository secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The updater private key (the file `tauri signer generate` writes). Keep a backup: losing it ends updates for every installed copy |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password, if it has one |
| `APPLE_CERTIFICATE` | The Developer ID Application certificate and its private key, exported as `.p12`, in base64 (`openssl base64 -A -in cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_API_ISSUER`, `APPLE_API_KEY` | The App Store Connect API key's issuer ID and key ID (Developer access) |
| `APPLE_API_PRIVATE_KEY` | The contents of its `AuthKey_<key ID>.p8` |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | The Entra app registration that holds the Artifact Signing Certificate Profile Signer role |
| `CLOUDFLARE_API_TOKEN` | An API token with Workers R2 Storage edit on the account, used only to write `auracode-releases` |

Before the first publish, connect `download.auracode.si` as the `auracode-releases` bucket's custom
domain (R2 > auracode-releases > Settings > Custom Domains). The bucket stays private until then,
and `auracode-blobs` must never get a public domain.

### Releasing

1. Bump `[workspace.package] version` in `Cargo.toml` in a pull request (the lockfile follows). Every
   signature carries the version, and a published version never changes.
2. Run `Release` with `channel: staging`, the notes, and `publish` on. Install the staging build.
   Release the next version to staging as well, and check that the installed build updates to it.
3. Run `Release` with `channel: stable` and `publish` on. Stable builds read only
   `/latest.json`, so nothing reaches users before this step.

A run with `publish` off builds, signs and verifies everything and uploads nothing. Use it to test
the signing setup.

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
  `restart_required` and asks the user to restart before retrying. On Linux an AppImage replaces
  its own file and a deb or rpm installs through `pkexec` (an administrator prompt); auracode then
  restarts.

No updater plugin permissions are granted to the webview. All decisions, network traffic, bounds,
verification and cleanup run in Rust. The thin interface should poll status while an explicit
operation runs, show returned errors, and require an Install action. A signed staging upgrade and
signature-mismatch fixture using the actual installer remain required before public distribution.

## Offline artifact preparation

`aura-release` is a Rust release tool, not a publisher or a signer. It accepts an explicit plan and
directory containing exactly the seven named package roles: a universal DMG, a universal
`.app.tar.gz` updater, Windows x64 NSIS, Windows ARM64 NSIS, and the Linux x64 AppImage, deb and
rpm. The six updater packages (all but the DMG) need their Tauri `.sig` files. The DMG checksum does not establish its code-signing or notarization status.
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

- `latest.json`, with both macOS architectures pointing to the universal updater, distinct Windows
  architecture entries including the NSIS-specific target keys, and Linux entries for the AppImage
  (`linux-x86_64-appimage` and the plain `linux-x86_64`, which the updater reads for an AppImage),
  the deb (`linux-x86_64-deb`) and the rpm (`linux-x86_64-rpm`).
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
an already published version.

`cargo run -p aura-release -- publish <stage>` does exactly that.
- **Dry run by default.** With `AURACODE_UPDATER_PUBLIC_KEY` set, it verifies the stage again, then
  prints the public object list with each object's content type and cache policy. It uploads
  nothing.
- **Upload order.** With `--upload`, it writes to `AURACODE_RELEASE_BUCKET` (default
  `auracode-releases`) through the repository's pinned Wrangler and the operator's own Cloudflare
  sign-in. The order is: the versioned files under `releases/<version>/` (cached as immutable), then
  `SHA256SUMS` and `downloads.json`, then `latest.json`. The manifests revalidate after 60 seconds.
- **Uploads exactly what verification accepted.** Expected hashes come only from the
  verification pass: manifests regenerated from the exact artifact bytes read. Before the first
  upload, every versioned file is read once more through the same no-follow helper and must match.
  Manifests upload from the regenerated bytes, and every object streams to Wrangler over stdin from
  memory. A file swapped or relinked after verification therefore fails before anything is written
  and can never be uploaded.
- **No overwrites.** Before writing anything, every versioned key is checked. A key that already
  holds identical bytes is skipped, so an interrupted run can be resumed. Different bytes stop the
  run untouched.
- **Read-back.** Each upload is read back and compared before the next, so a failure always stops
  before `latest.json`.
- **Staging.** Staging stages publish only under `staging/`.
- **Limits.** Each object must fit one 300 MiB Wrangler upload, and the whole release is held in
  memory during publication. Anything larger is refused before the first write.
- **Bucket guard.** `AURACODE_RELEASE_BUCKET` must be `auracode-releases` or an
  `auracode-releases-*` test bucket, so a mistyped override can never publish into the private
  blob bucket.

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
native toolchain. Do not change platform policy if an executable is denied.

```sh
pnpm install --frozen-lockfile
node .github/scripts/check-instructions.mjs
node --test .github/scripts/acceptance-gates.test.mjs
cargo fmt --all --check
cargo test --workspace --all-features --locked
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
bash .github/scripts/export-bindings.sh check target/final-bindings
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @auracode/desktop check:chat
pnpm --filter @auracode/desktop check:settings
pnpm --filter @auracode/desktop check:setup
pnpm --filter @auracode/desktop check:fixtures
pnpm --filter @auracode/desktop exec node scripts/check-setup-actions.mjs
pnpm --filter @auracode/desktop exec node scripts/check-profile-status.mjs
pnpm --filter @auracode/desktop exec node scripts/check-chat-auth.mjs
pnpm --filter @auracode/desktop exec node scripts/check-library.mjs
pnpm --filter @auracode/desktop exec node scripts/check-folder-resolution.mjs
pnpm --filter @auracode/desktop exec node scripts/check-repository-publication.mjs
pnpm --filter @auracode/desktop exec node scripts/check-workspace-removal.mjs
pnpm --filter @auracode/desktop exec node scripts/check-agent-installations.mjs
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
# Linux, on a virtual display when there is no desktop session
xvfb-run -a -s "-screen 0 1440x900x24" bash .github/scripts/run-smoke.sh target/debug/auracode all
```

The native harness covers real webview, IPC, actor, transcript, restart and quit paths. It does not
prove vendor compatibility, packaged installation or independent external WebDriver control. Keep
its result JSON and logs. The settings browser gate also runs Git reviews, setup, profile
controls, explicit steering and missing-transcript recovery in Chromium and WebKit. Those use synthetic commands and do not replace native acceptance.

The final CI keeps each browser gate bounded and checks that every desktop acceptance script is
reachable directly or through an aggregator. Leave `refresh_bindings` off for the final gate after
committing exact generated output. The unsigned Build workflow separately refuses stale bindings
before compiling the frontend and does not request updater signing material.

The same Windows Rust job then runs an independent external WebDriver check against its embedded
debug app, using the built-in mock agent and an isolated disposable profile. It pins `tauri-driver`
2.1.0 and downloads Microsoft Edge Driver for the installed WebView2 runtime, validates its Microsoft
signature and version, and records the version/hash evidence. Ambiguous or missing runtimes fail
qualification instead of installing or updating browser software. The test performs real external
clicks and typing, observes output, interrupts a turn and reopens persisted history; it retains bounded
logs, a result report and screenshots without uploading the profile. This follows the official
[Tauri WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/) and Microsoft's
[WebView2 driver requirement](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver).
The workflow is prepared, but only a successful hosted run qualifies that native gate. macOS remains
covered by the existing native app smoke and WebKit browser tests, with actual device acceptance
tracked separately.

Unsigned package compilation uses the existing manual `Build` matrix. Individual qualified hosts can
use the same explicit targets locally:

```sh
pnpm bundle --target universal-apple-darwin --bundles dmg
pnpm bundle --target x86_64-pc-windows-msvc --bundles nsis
pnpm bundle --target aarch64-pc-windows-msvc --bundles nsis
pnpm bundle --target x86_64-unknown-linux-gnu --bundles deb,rpm,appimage
```

For signed updater qualification add `--signed-updater` with the secret-store environment already
supplied. Do not put signing values in commands or logs. Verify the final packages after code signing,
notarization and stapling, then prepare the stage from those final bytes.

| Gate | Required evidence before calling it complete |
|---|---|
| macOS universal | Inspect both architecture slices, install and launch on Apple Silicon and Intel; verify configured minimum OS, signature, notarization and staple; retain existing profile data across upgrade |
| Windows x64 and ARM64 | Install, launch, upgrade and uninstall on each architecture; verify Authenticode and WebView2 behavior, including missing-runtime behavior; an upgrade retains user data, an uninstall deletes it as [uninstall.md](uninstall.md) describes, and both leave unrelated vendor processes running |
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
Readable chat export and portable folder resolution are also implemented with focused
verification; their final integrated Windows/macOS qualification remains pending. The account
lifecycle that stood here (recovery, passphrase storage, reset sync, device removal, Keep as Local
and Local import) was removed with auracode's accounts on 16 November 2026.
Exact older-message native truncation/fork and Pi steering remain unsupported where the recorded
protocol cannot safely identify the requested boundary; the visible reviewed handoff keeps the source
conversation intact.

Source references checked for this implementation:
[Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[universal macOS builds](https://v2.tauri.app/distribute/app-store/),
[updater artifacts and signatures](https://v2.tauri.app/plugin/updater/), and
[Windows code signing](https://tauri.app/distribute/sign/windows/).
