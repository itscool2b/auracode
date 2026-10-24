# auracode desktop

The Tauri v2 app: the Rust shell in `src-tauri/` and the React UI in `src/`. Run these from the
repository root:

| Command | What it does |
|---|---|
| `pnpm dev` | The app with hot reload (Vite for the UI, Cargo for the shell). |
| `pnpm bundle` | Release bundles (`tauri build`), signed on macOS as described below. Extra arguments go to `tauri build`. |
| `pnpm signing create` / `pnpm signing status` | The local macOS signing identity (below). |
| `pnpm --filter @auracode/desktop test` | UI tests (Vitest). |
| `cargo test -p auracode-desktop` | Shell tests; also regenerates `src/bindings.ts`. |

## Signing on macOS

### Why

macOS stores privacy grants, such as access to `~/Desktop` where your projects live, against an
app's *designated requirement*. A build with the default ad-hoc signature has the requirement
`cdhash H"…"`, the hash of that exact build, which no other build satisfies: after every rebuild
macOS treats auracode as a new app, asks for access again, and leaves the old entries behind in
System Settings. Signed with one stable identity, every build has the requirement
`identifier "si.auracode.desktop" and certificate root = H"<certificate SHA-1>"`, so grants carry
over from build to build.

The identity is a self-signed certificate named **auracode Local Signing**, kept in your login
keychain. It is for builds on your own Mac; distributing auracode to other people needs an Apple
Developer ID and notarization, which come with releases (M5).

### Create it (once per Mac)

```sh
pnpm signing create
```

This generates an RSA 2048 key and a code-signing certificate valid for ten years, and imports
both into the login keychain, with `codesign` allowed to use the key. It prints the certificate's
SHA-1 and expiry date. It never replaces an identity that already exists. Nothing leaves your Mac:
the private key exists outside the keychain only in a private temporary folder that is deleted
right after the import.

`security find-identity -v -p codesigning` keeps reporting `0 valid identities`. "Valid" there
means vouched for by a certificate authority, which a self-signed certificate never is, and
`codesign` does not need it. `pnpm signing status`, or the same command without `-v`, shows the
identity (marked `CSSMERR_TP_NOT_TRUSTED`, which is expected).

### How builds use it

- **Bundles:** `pnpm bundle` passes the identity's SHA-1 to `tauri build` as
  `APPLE_SIGNING_IDENTITY`. On a Mac without the identity it signs ad hoc (`-`, as CI does) and
  warns, so the build still works. If you set `APPLE_SIGNING_IDENTITY` yourself, it wins. Check a
  bundle with `codesign -d -r- target/release/bundle/macos/auracode.app`.
- **Dev builds:** `src-tauri/.cargo/config.toml` makes `scripts/macos-signing.sh` Cargo's runner on
  macOS, so `pnpm dev` signs `target/debug/auracode` with the identity (and the bundle's
  identifier) just before it starts. Without the identity the build runs as before, with a hint.
  Note that macOS charges a program started from a terminal to that terminal, so while auracode
  runs under `pnpm dev`, folder-access prompts name your terminal app.
- **CI** builds sign ad hoc (`APPLE_SIGNING_IDENTITY=-` in `.github/workflows/build.yml`) and never
  read the runner config, which Cargo only loads for commands run inside `src-tauri/`.
- **Windows and Linux** need nothing: the scripts only sign on macOS.

To keep the identity in another keychain, set `AURACODE_SIGNING_KEYCHAIN` to its path for
`create`, `status` and builds. `codesign` only finds identities in keychains on your search list
(`security list-keychains`), which the login keychain always is.

### Back it up

Losing the identity means a new one, and a new one makes macOS ask for auracode's permissions
again. To back it up:

1. Open Keychain Access, choose the **login** keychain and the **My Certificates** tab.
2. Select **auracode Local Signing** (its private key, named "Imported Private Key", is listed
   under it) and choose **File > Export Items…** as a `.p12` file with a strong password.
3. Keep the file and its password in your password manager.

To restore it on a new or reinstalled Mac:

```sh
security import auracode-signing.p12 -f pkcs12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign
pnpm signing status
```

A restored identity has the same SHA-1, so existing grants stay valid.

### Rotate it

Rotate when the certificate nears its expiry date (`pnpm signing status`) or if its key may have
leaked:

```sh
pnpm signing status                                   # note the SHA-1
security delete-identity -Z <SHA-1> ~/Library/Keychains/login.keychain-db
pnpm signing create
```

The next build has a new designated requirement, so macOS asks for folder access once more. Clear
the stale grant with `tccutil reset SystemPolicyDesktopFolder si.auracode.desktop`, or in System
Settings > Privacy & Security > Files and Folders.

### Troubleshooting

- **"N signing identities are named auracode Local Signing":** builds refuse to guess between them
  (dev builds run unsigned, `pnpm bundle` stops). Keep one and delete the others with
  `security delete-identity -Z <SHA-1>`.
- **"codesign wants to sign using key Imported Private Key":** the key's access list was changed
  (for example by restoring it without `-T /usr/bin/codesign`). Choose **Always Allow**.
- **"could not sign this dev build":** the run continues unsigned; the message carries `codesign`'s
  reason, usually a locked keychain.
