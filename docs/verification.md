# Deliberate Windows and macOS verification

CI is manual. Routine commits do not dispatch checks. Reserve the planned integration runs and
the final run for a coherent source checkpoint, then rerun affected gates when fixing failures.
Linux and WSL acceptance are deferred.

## Recovering generated bindings

The `CI` workflow has one optional boolean, `refresh_bindings`, defaulting to `false`.

- Normal runs generate TypeScript bindings independently on Windows and macOS and fail if the
  result differs from the committed `apps/desktop/src/bindings.ts`.
- An explicit refresh first compiles the real desktop Rust library on macOS and runs its
  `export_bindings` test. Frontend checks wait for that job, download its exact output, and use it
  for lint, typechecking and browser tests. A failed exporter prevents these frontend checks.
- Windows still exports independently. The parity job compares its bytes with the macOS bootstrap
  output. Platform-dependent output fails this gate and must be fixed in Rust before integration.
- Download `bindings-bootstrap-<full commit SHA>` from that run. Review and commit its exact
  `bindings.ts` at the generated path. Do not reconstruct types manually or copy partial sections.
  Confirm the artifact belongs to the source revision being integrated.
- Final verification must use `refresh_bindings: false` after that commit. A refresh run does not
  prove that the repository contains current bindings and is not the final drift gate.

Independent exports are also retained as `bindings-Windows-<SHA>` and `bindings-macOS-<SHA>`.
The script publishes output only after observing a passing exporter test, including when a normal
run then detects drift. Compiler failure, zero selected tests or an untracked output path fail
without publishing an artifact. Generated artifacts expire after seven days.

## Native smoke coverage

Both native Rust jobs build the app with its frontend embedded and run the existing stream and
chat smoke scenarios. Chat smoke quits with a running demo turn, checks cleanup, reopens its owned
profile and verifies stored history and resume. These scenarios use the mock agent and refuse real
agent smoke under CI. macOS uses an ad-hoc development signature; this does not verify notarization.
Stdout evidence is retained as `native-smoke-<OS>-<SHA>`. No real agent credentials are needed.

Chromium and WebKit additionally exercise the Orbit transcript and setup fixtures. Browser checks
do not replace native acceptance for titlebar/materials, notification activation, terminal sign-in,
window suspension, packaging or macOS visible-window power measurements. A native runner that cannot
present a webview must fail its smoke, rather than silently skip that acceptance gate.

## Local script checks

`bash .github/scripts/test-export-bindings.sh` verifies exporter success, drift, refresh, zero tests,
compiler failure, untracked output and invalid mode using fake tools in an owned temporary directory.
It needs no compiler, network or credentials. The existing workflow pin checks run through
`bash .github/scripts/lint-workflows.sh`; CI also applies ShellCheck and the existing script suite.
