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

Source references checked for this implementation:
[Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/),
[universal macOS builds](https://v2.tauri.app/distribute/app-store/),
[updater artifacts and signatures](https://v2.tauri.app/plugin/updater/), and
[Windows code signing](https://tauri.app/distribute/sign/windows/).
