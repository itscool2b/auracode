#!/usr/bin/env bash
# No compiler, network or real repository changes: test the export gate with fake cargo/git.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
scratch=$(cd "${TMPDIR:-/tmp}" && pwd -P)
suite=$(mktemp -d "$scratch/auracode-bindings-tests.XXXXXX")
cleanup() {
  # Verify the exact owned temporary directory before recursive removal, including on Git Bash.
  [ "$(dirname "$suite")" = "$scratch" ] || return 1
  case "$(basename "$suite")" in auracode-bindings-tests.*) rm -rf -- "$suite" ;; *) return 1 ;; esac
}
trap cleanup EXIT
mkdir -p "$suite/bin" "$suite/apps/desktop/src"
printf 'export type Fixture = string;\n' >"$suite/apps/desktop/src/bindings.ts"
cat >"$suite/bin/cargo" <<'EOF'
#!/usr/bin/env bash
[ "${FAKE_CARGO_FAIL:-0}" = 0 ] || exit 9
if [ "${FAKE_EMPTY:-0}" = 0 ]; then
  printf 'test bindings::tests::export_bindings ... ok\n'
else
  printf 'running 0 tests\n'
fi
EOF
cat >"$suite/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
ls-files) exit "${FAKE_UNTRACKED:-0}" ;;
diff) exit "${FAKE_DIFF:-0}" ;;
*) exit 99 ;;
esac
EOF
chmod +x "$suite/bin/cargo" "$suite/bin/git"
export PATH="$suite/bin:$PATH"
cd "$suite"
run_case() {
  local name=$1 mode=$2 expected=$3 artifact=$4 status=0
  GITHUB_OUTPUT="$suite/$name.output" bash "$here/export-bindings.sh" "$mode" "$suite/$name" >"$suite/$name.log" 2>&1 || status=$?
  [ "$status" -eq "$expected" ] || { cat "$suite/$name.log"; echo "$name: expected $expected, got $status"; exit 1; }
  if [ "$artifact" = yes ]; then
    cmp apps/desktop/src/bindings.ts "$suite/$name/bindings.ts"
    grep -q '^generated=true$' "$suite/$name.output"
  else
    [ ! -e "$suite/$name/bindings.ts" ] || { echo "$name published unverified output"; exit 1; }
  fi
  printf 'ok %s\n' "$name"
}
run_case committed check 0 yes
export FAKE_DIFF=1
run_case drift check 1 yes
run_case refresh refresh 0 yes
export FAKE_DIFF=0 FAKE_EMPTY=1
run_case no_test refresh 1 no
export FAKE_EMPTY=0 FAKE_CARGO_FAIL=1
run_case compiler_failure refresh 9 no
export FAKE_CARGO_FAIL=0 FAKE_UNTRACKED=1
run_case untracked refresh 1 no
export FAKE_UNTRACKED=0
run_case invalid_mode invalid 2 no
