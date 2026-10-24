#!/usr/bin/env bash
# Tests for the CI scripts in this directory: `bash .github/scripts/test.sh [name filter]`.
#
# CI's lint job runs them. They need bash 3.2 or later and jq, and touch neither the network nor
# the repository: GitHub's API is a fake `gh` answering from canned responses (a test that has not
# set one up gets a `gh` that fails), apps and cargo builds are small fakes, and every test runs in
# a subshell inside its own temporary folder.
set -uo pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_JQ="$(command -v jq)" || {
  echo "test.sh needs jq" >&2
  exit 1
}
export REAL_JQ
suite="$(mktemp -d)"
trap 'rm -rf "$suite"' EXIT

SHA=0123456789abcdef0123456789abcdef01234567

# Set per test by the runner at the bottom; declared here for shellcheck and readers.
tmp=""
status=0

# --- Assertions. Each test runs in a subshell, so a failed assertion exits only that test. -----

fail() {
  printf '    %s\n' "$@" >&2
  printf '    --- output ---\n' >&2
  sed 's/^/    | /' "$tmp/out" >&2 2>/dev/null || true
  exit 1
}

# run <script> [args...]: runs a script from this directory with the test's fakes first on PATH.
# Sets $status; stdout and stderr go to $tmp/out, step outputs to $tmp/github_output.
run() {
  local script=$1
  shift
  : >"$tmp/github_output"
  PATH="$tmp/bin:$PATH" GITHUB_OUTPUT="$tmp/github_output" CI_GH_RETRY_DELAY=0 \
    bash "$scripts/$script" "$@" >"$tmp/out" 2>&1
  status=$?
}

assert_status() {
  [ "$status" -eq "$1" ] || fail "expected exit status $1, got $status"
}

assert_out() {
  grep -Fq -- "$1" "$tmp/out" || fail "expected the output to contain: $1"
}

refute_out() {
  if grep -Fq -- "$1" "$tmp/out"; then fail "expected the output not to contain: $1"; fi
}

assert_step_output() { # <name> <value>: the value recorded last for <name>
  local got
  got="$(grep "^$1=" "$tmp/github_output" | tail -n 1 | cut -d= -f2-)"
  [ "$got" = "$2" ] || fail "expected step output $1=$2, got \"$got\""
}

assert_file() {
  [ -f "$1" ] || fail "expected a file at $1"
}

refute_path() {
  [ ! -e "$1" ] || fail "expected nothing at $1"
}

assert_eq() { # <expected> <actual> <what>
  [ "$1" = "$2" ] || fail "expected $3 to be \"$1\", got \"$2\""
}

# The names in a folder, byte-sorted (glob order follows the locale), space-separated.
listing() {
  find "$1" -mindepth 1 -maxdepth 1 | sed 's#.*/##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//'
}

# --- Fakes. ------------------------------------------------------------------------------------

# A `gh` that answers `gh api <path>` from $tmp/routes, one "glob<TAB>body file<TAB>exit code" per
# line (first match wins; exit code "once:N" fails with N on the first call, then answers). Every
# call is logged to $tmp/gh.log.
fake_gh() {
  : >"$tmp/routes"
  : >"$tmp/gh.log"
  cat >"$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_GH_LOG"
if [ "${1:-}" != api ] || [ "$#" -ne 2 ]; then
  echo "fake gh: unexpected arguments: $*" >&2
  exit 2
fi
while IFS=$'\t' read -r pattern body code; do
  # shellcheck disable=SC2254 # a glob on purpose
  case $2 in
  $pattern)
    case $code in
    once:*)
      if [ ! -e "$body.failed" ]; then
        : >"$body.failed"
        echo "fake gh: HTTP 502 (once)" >&2
        exit "${code#once:}"
      fi
      code=0
      ;;
    esac
    if [ "$code" -ne 0 ]; then
      echo "fake gh: HTTP 502" >&2
      exit "$code"
    fi
    cat "$body"
    exit 0
    ;;
  esac
done <"$FAKE_GH_ROUTES"
echo "fake gh: no route for $2" >&2
exit 3
EOF
  chmod +x "$tmp/bin/gh"
  export FAKE_GH_ROUTES="$tmp/routes" FAKE_GH_LOG="$tmp/gh.log"
}

route() { # <glob> <body> [exit code]
  local body
  body="$tmp/body.$(wc -l <"$tmp/routes" | tr -d ' ')"
  printf '%s' "$2" >"$body"
  printf '%s\t%s\t%s\n' "$1" "$body" "${3:-0}" >>"$tmp/routes"
}

gh_calls() {
  grep -c '' "$tmp/gh.log" || true
}

# Git Bash's cygpath, mapping C:\fake\... to and from $FAKE_ROOT/....
fake_cygpath() {
  cat >"$tmp/bin/cygpath" <<'EOF'
#!/usr/bin/env bash
case $1 in
-u)
  path="$(printf '%s\n' "$2" | tr '\\' '/')"
  case $path in C:/fake*) path="$FAKE_ROOT${path#C:/fake}" ;; esac
  printf '%s\n' "$path"
  ;;
-w)
  path=$2
  case $path in "$FAKE_ROOT"*) path="C:/fake${path#"$FAKE_ROOT"}" ;; esac
  printf '%s\n' "$path" | tr '/' '\\'
  ;;
*)
  echo "fake cygpath: unsupported $*" >&2
  exit 2
  ;;
esac
EOF
  chmod +x "$tmp/bin/cygpath"
  export FAKE_ROOT="$tmp"
}

# A jq that ends its lines with CRLF, like jq.exe on the Windows runners.
crlf_jq() {
  cat >"$tmp/bin/jq" <<'EOF'
#!/usr/bin/env bash
"$REAL_JQ" "$@" | awk '{ printf "%s\r\n", $0 }'
EOF
  chmod +x "$tmp/bin/jq"
}

# --- lint-workflows.sh ---------------------------------------------------------------------------

workflow() { # <file> <content>
  printf '%s\n' "$2" >"$tmp/$1"
}

test_lint_accepts_pinned_actions() {
  local digest
  digest="sha256:$(printf 'a%.0s' {1..64})"
  workflow ok.yml "jobs:
  steps-job:
    steps:
      - uses: actions/checkout@$SHA # v7.0.1
      - name: quoted, with a two-part version
        uses: \"pnpm/action-setup@$SHA\" # 6.1
      - uses: ./.github/actions/local
      - uses: docker://alpine@$digest
      # uses: commented/out@v1
  reusable-job:
    uses: owner/repo/.github/workflows/build.yml@$SHA # v1"
  run lint-workflows.sh "$tmp/ok.yml"
  assert_status 0
  assert_out "Checked 1 workflow file(s)"
}

test_lint_rejects_refs_that_can_move() {
  workflow bad.yml "jobs:
  a:
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@d1527c8 # v2.9.3
      - uses: docker://alpine:3.20
      - uses: docker://alpine@sha256:abc
      - uses: actions/checkout"
  run lint-workflows.sh "$tmp/bad.yml"
  assert_status 1
  assert_out "::error file=$tmp/bad.yml,line=4::actions/checkout is pinned to \"v7\", which can be moved"
  assert_out "line=5::dtolnay/rust-toolchain is pinned to \"stable\""
  assert_out "line=6::Swatinem/rust-cache is pinned to \"d1527c8\""
  assert_out "line=7::docker://alpine:3.20 can change under the same tag"
  assert_out "line=8::docker://alpine@sha256:abc is not pinned by a sha256 digest"
  assert_out "line=9::unrecognised action reference \"actions/checkout\""
  assert_out "6 problem(s) in 1 workflow file(s)."
}

test_lint_wants_the_version_as_a_bare_comment() {
  workflow c.yml "steps:
  - uses: actions/checkout@$SHA
  - uses: actions/setup-node@$SHA # v7.1.0, pinned by hand
  - uses: actions/upload-artifact@$SHA # latest
  - uses: actions/cache@$SHA #v5.0.0"
  run lint-workflows.sh "$tmp/c.yml"
  assert_status 1
  assert_out "line=2::actions/checkout@$SHA needs the version it pins as its only trailing comment"
  assert_out "line=3::actions/setup-node@$SHA needs the version"
  assert_out "line=4::actions/upload-artifact@$SHA needs the version"
  refute_out "line=5"
  assert_out "3 problem(s)"
}

test_lint_rejects_uppercase_or_short_shas() {
  workflow u.yml "steps:
  - uses: actions/checkout@0123456789ABCDEF0123456789ABCDEF01234567 # v7.0.1
  - uses: actions/checkout@${SHA%?} # v7.0.1"
  run lint-workflows.sh "$tmp/u.yml"
  assert_status 1
  assert_out "line=2::actions/checkout is pinned to"
  assert_out "line=3::actions/checkout is pinned to"
}

test_lint_reads_crlf_files() {
  printf 'steps:\r\n  - uses: actions/checkout@%s # v7.0.1\r\n  - uses: actions/setup-node@v7\r\n' "$SHA" >"$tmp/crlf.yml"
  run lint-workflows.sh "$tmp/crlf.yml"
  assert_status 1
  assert_out "line=3::actions/setup-node is pinned to \"v7\""
  refute_out "line=2"
}

test_lint_checks_schedule_comparisons_against_the_crons() {
  workflow s.yml "on:
  schedule:
    - cron: \"17 6 * * 0,2-6\"
    - cron: '17 6 * * 1' # weekly
jobs:
  a:
    if: github.event.schedule == '17 6 * * 1'
    runs-on: \${{ github.event.schedule != '17 6 * * 0,2-6' && 'x' || 'y' }}
  b:
    if: github.event.schedule == '17 7 * * 1'"
  run lint-workflows.sh "$tmp/s.yml"
  assert_status 1
  assert_out "line=10::github.event.schedule is compared with '17 7 * * 1', but this file schedules no such cron"
  assert_out "1 problem(s)"
}

test_lint_reports_every_file() {
  workflow one.yml "steps:
  - uses: actions/checkout@v7"
  workflow two.yml "steps:
  - uses: actions/checkout@$SHA # v7.0.1"
  run lint-workflows.sh "$tmp/one.yml" "$tmp/two.yml"
  assert_status 1
  assert_out "::error file=$tmp/one.yml,line=2::"
  assert_out "1 problem(s) in 2 workflow file(s)."
}

test_lint_fails_on_a_missing_file() {
  run lint-workflows.sh "$tmp/nope.yml"
  assert_status 1
  assert_out "no such file: $tmp/nope.yml"
}

test_lint_passes_this_repositorys_workflows() {
  run lint-workflows.sh
  assert_status 0
  assert_out "every action is pinned"
}

# --- check-open-pr.sh ----------------------------------------------------------------------------

open_pr_env() {
  export GITHUB_REPOSITORY=itscool2b/auracode GITHUB_REPOSITORY_OWNER=itscool2b BRANCH=m0-scaffold
  fake_gh
}

# The route is the exact request, so these tests also pin the query: open PRs whose head is
# owner:branch, URL-encoded.
PULLS='repos/itscool2b/auracode/pulls?state=open&head=itscool2b%3Am0-scaffold&per_page=1'

test_open_pr_found_means_the_push_skips() {
  open_pr_env
  route "$PULLS" '[{"number":7,"html_url":"https://github.com/itscool2b/auracode/pull/7"}]'
  run check-open-pr.sh
  assert_status 0
  assert_step_output open true
  assert_out "m0-scaffold has open pull request #7 (https://github.com/itscool2b/auracode/pull/7)"
}

test_open_pr_none_means_the_push_runs() {
  open_pr_env
  route "$PULLS" '[]'
  run check-open-pr.sh
  assert_status 0
  assert_step_output open false
  assert_out "m0-scaffold has no open pull request"
}

test_open_pr_fails_open_when_github_cannot_be_asked() {
  open_pr_env
  route 'repos/*' '' 1
  run check-open-pr.sh
  assert_status 0
  assert_step_output open false
  assert_out "::warning::Could not ask GitHub whether m0-scaffold has an open pull request; running CI anyway."
  assert_eq 3 "$(gh_calls)" "the number of attempts"
}

test_open_pr_retries_a_transient_failure() {
  open_pr_env
  route "$PULLS" '[{"number":7,"html_url":"https://github.com/itscool2b/auracode/pull/7"}]' once:1
  run check-open-pr.sh
  assert_status 0
  assert_step_output open true
  assert_eq 2 "$(gh_calls)" "the number of attempts"
}

test_open_pr_fails_open_on_an_unexpected_answer() {
  open_pr_env
  route "$PULLS" '{"message":"Bad credentials"}'
  run check-open-pr.sh
  assert_status 0
  assert_step_output open false
  assert_out "was not a list; running CI anyway"
}

test_open_pr_encodes_the_branch() {
  open_pr_env
  export BRANCH='m1a/core+acp'
  route 'repos/itscool2b/auracode/pulls?state=open&head=itscool2b%3Am1a%2Fcore%2Bacp&per_page=1' '[]'
  run check-open-pr.sh
  assert_status 0
  assert_step_output open false
}

test_open_pr_needs_the_branch() {
  open_pr_env
  unset BRANCH
  run check-open-pr.sh
  assert_status 1
  assert_out "BRANCH is not set"
  assert_eq 0 "$(gh_calls)" "the number of API calls"
}

# --- plan-nightly-bundle.sh ----------------------------------------------------------------------

nightly_env() {
  export GITHUB_REPOSITORY=itscool2b/auracode GITHUB_SHA=abcdef0123456789abcdef0123456789abcdef01 \
    GITHUB_RUN_ID=900 BRANCH=main WORKFLOW_FILE=build.yml BUNDLE_JOB_PREFIX='bundle ('
  fake_gh
}

runs_route() { # <json run objects, comma-separated>
  route "repos/itscool2b/auracode/actions/workflows/build.yml/runs?head_sha=$GITHUB_SHA&branch=main&per_page=100" \
    "{\"total_count\":9,\"workflow_runs\":[$1]}"
}

a_run() { # <id> <event> <status> <conclusion as JSON>
  printf '{"id":%s,"event":"%s","status":"%s","conclusion":%s,"html_url":"https://github.com/itscool2b/auracode/actions/runs/%s"}' \
    "$1" "$2" "$3" "$4" "$1"
}

jobs_route() { # <run id> <bundle conclusions as JSON: macOS, Windows, Linux>
  route "repos/itscool2b/auracode/actions/runs/$1/jobs?filter=latest&per_page=100" \
    "{\"total_count\":4,\"jobs\":[{\"name\":\"plan\",\"conclusion\":\"success\"},{\"name\":\"bundle (macos-latest)\",\"conclusion\":$2},{\"name\":\"bundle (windows-latest)\",\"conclusion\":$3},{\"name\":\"bundle (ubuntu-22.04)\",\"conclusion\":$4}]}"
}

SELF="$(a_run 900 schedule in_progress null)"

test_nightly_builds_a_commit_nothing_built() {
  nightly_env
  runs_route "$SELF"
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build true
  assert_out "No run has built the bundles for abcdef0 yet"
  assert_eq 1 "$(gh_calls)" "the number of API calls (its own run is not inspected)"
}

test_nightly_skips_a_commit_a_push_built() {
  nightly_env
  runs_route "$SELF,$(a_run 801 push completed '"success"')"
  jobs_route 801 '"success"' '"success"' '"success"'
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build false
  assert_out "Run https://github.com/itscool2b/auracode/actions/runs/801 (push) already built every bundle for abcdef0"
}

test_nightly_skips_a_commit_a_manual_run_built() {
  nightly_env
  runs_route "$SELF,$(a_run 802 workflow_dispatch completed '"success"')"
  jobs_route 802 '"success"' '"success"' '"success"'
  run plan-nightly-bundle.sh
  assert_step_output build false
  assert_out "(workflow_dispatch) already built every bundle"
}

test_nightly_skips_while_a_push_is_building() {
  nightly_env
  runs_route "$SELF,$(a_run 803 push in_progress null)"
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build false
  assert_out "Run https://github.com/itscool2b/auracode/actions/runs/803 (push) is building abcdef0 right now"
}

test_nightly_retries_after_a_nightly_that_only_skipped() {
  nightly_env
  runs_route "$SELF,$(a_run 700 schedule completed '"success"')"
  jobs_route 700 '"skipped"' '"skipped"' '"skipped"'
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build true
}

test_nightly_does_not_retry_a_commit_it_already_tried() {
  nightly_env
  runs_route "$SELF,$(a_run 700 schedule completed '"failure"')"
  jobs_route 700 '"failure"' '"success"' '"success"'
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build false
  assert_out "The nightly already tried abcdef0 in run https://github.com/itscool2b/auracode/actions/runs/700 (failure)"
}

test_nightly_rebuilds_after_a_failed_push() {
  nightly_env
  runs_route "$SELF,$(a_run 804 push completed '"failure"')"
  jobs_route 804 '"success"' '"failure"' '"success"'
  run plan-nightly-bundle.sh
  assert_status 0
  assert_step_output build true
}

test_nightly_rebuilds_after_a_cancelled_push() {
  nightly_env
  runs_route "$SELF,$(a_run 805 push completed '"cancelled"')"
  jobs_route 805 '"cancelled"' '"cancelled"' '"success"'
  run plan-nightly-bundle.sh
  assert_step_output build true
}

test_nightly_fails_loudly_when_github_cannot_be_asked() {
  nightly_env
  route 'repos/*' '' 1
  run plan-nightly-bundle.sh
  assert_status 1
  assert_out "::error::Could not list build.yml runs for abcdef0"
  assert_eq 3 "$(gh_calls)" "the number of attempts"
  refute_out "build="
}

test_nightly_fails_when_a_runs_jobs_cannot_be_read() {
  nightly_env
  runs_route "$SELF,$(a_run 801 push completed '"success"')"
  route 'repos/itscool2b/auracode/actions/runs/801/jobs*' '' 1
  run plan-nightly-bundle.sh
  assert_status 1
  assert_out "Could not list the jobs of run https://github.com/itscool2b/auracode/actions/runs/801"
}

test_nightly_fails_on_an_unexpected_answer() {
  nightly_env
  route 'repos/*' '{"message":"Not Found"}'
  run plan-nightly-bundle.sh
  assert_status 1
  assert_out "was not in the expected shape"
}

test_nightly_needs_its_settings() {
  nightly_env
  unset WORKFLOW_FILE
  run plan-nightly-bundle.sh
  assert_status 1
  assert_out "WORKFLOW_FILE is not set"
}

# --- stage-spawn-spike.sh ------------------------------------------------------------------------

artifact_message() { # <target name> <kind> <profile.test> <executable as JSON>
  printf '{"reason":"compiler-artifact","package_id":"windows-spawn","target":{"name":"%s","kind":["%s"]},"profile":{"test":%s},"executable":%s,"fresh":true}\n' \
    "$1" "$2" "$3" "$4"
}

# A fake spike build in $tmp/target/debug and cargo's JSON messages for it in $tmp/messages.jsonl,
# with the decoys a real `cargo test --no-run` produces: the lib's and the bins' unit-test
# executables. <ext> is "" or ".exe".
spike_build() {
  local ext=$1 d="$tmp/target/debug" file
  mkdir -p "$d/deps"
  for file in "deps/spawn-1234$ext" "spawn-probe$ext" "gui-host$ext" "deps/spawn_probe-aaaa$ext" \
    "deps/gui_host-bbbb$ext" "deps/windows_spawn-cccc$ext"; do
    printf 'built %s\n' "$file" >"$d/$file"
    chmod +x "$d/$file"
  done
  {
    printf '{"reason":"build-script-executed","package_id":"tokio"}\n'
    artifact_message windows_spawn lib false null
    artifact_message windows_spawn lib true "\"$d/deps/windows_spawn-cccc$ext\""
    artifact_message spawn-probe bin true "\"$d/deps/spawn_probe-aaaa$ext\""
    artifact_message spawn-probe bin false "\"$d/spawn-probe$ext\""
    artifact_message gui-host bin true "\"$d/deps/gui_host-bbbb$ext\""
    artifact_message gui-host bin false "\"$d/gui-host$ext\""
    artifact_message spawn test true "\"$d/deps/spawn-1234$ext\""
    printf '{"reason":"build-finished","success":true}\n'
  } >"$tmp/messages.jsonl"
}

test_stage_collects_the_spike_build() {
  spike_build ""
  export GITHUB_SHA="$SHA"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 0
  assert_eq "built deps/spawn-1234" "$(cat "$tmp/staged/windows-spawn-tests")" "the staged test executable"
  assert_eq "built spawn-probe" "$(cat "$tmp/staged/spawn-probe")" "the staged spawn-probe"
  assert_eq "built gui-host" "$(cat "$tmp/staged/gui-host")" "the staged gui-host"
  [ -x "$tmp/staged/windows-spawn-tests" ] || fail "the staged test executable lost its executable bit"
  # Moved, so the baked-in build paths no longer exist and the staged run must use the fallback.
  refute_path "$tmp/target/debug/spawn-probe"
  refute_path "$tmp/target/debug/gui-host"
  refute_path "$tmp/target/debug/deps/spawn-1234"
  assert_file "$tmp/target/debug/deps/spawn_probe-aaaa"
  assert_eq "README.txt gui-host spawn-probe windows-spawn-tests" "$(listing "$tmp/staged")" "the staged files"
  grep -Fq -- "--skip control_" "$tmp/staged/README.txt" || fail "the README lacks the checklist command"
  grep -Fq -- "commit $SHA" "$tmp/staged/README.txt" || fail "the README lacks the commit"
  assert_step_output test_exe "$tmp/staged/windows-spawn-tests"
}

test_stage_keeps_windows_file_names() {
  spike_build ".exe"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 0
  assert_eq "README.txt gui-host.exe spawn-probe.exe windows-spawn-tests.exe" "$(listing "$tmp/staged")" "the staged files"
  grep -Fq -- '.\windows-spawn-tests.exe --skip control_' "$tmp/staged/README.txt" ||
    fail "the README lacks the Windows command"
  assert_step_output test_exe "$tmp/staged/windows-spawn-tests.exe"
}

test_stage_converts_windows_paths() {
  fake_cygpath
  spike_build ".exe"
  # cargo.exe reports Windows paths; the fake cygpath maps C:\fake to $tmp.
  sed -e "s#$tmp#C:\\\\\\\\fake#g" -e 's#/#\\\\#g' "$tmp/messages.jsonl" >"$tmp/windows.jsonl"
  grep -Fq 'C:\\fake\\target\\debug\\deps\\spawn-1234.exe' "$tmp/windows.jsonl" ||
    fail "the fixture does not hold Windows paths" "$(cat "$tmp/windows.jsonl")"
  run stage-spawn-spike.sh "$tmp/windows.jsonl" "$tmp/staged"
  assert_status 0
  assert_file "$tmp/staged/windows-spawn-tests.exe"
  assert_file "$tmp/staged/gui-host.exe"
  assert_file "$tmp/staged/spawn-probe.exe"
}

test_stage_accepts_windows_paths_as_arguments() {
  fake_cygpath
  spike_build ".exe"
  cp "$tmp/messages.jsonl" "$tmp/m.jsonl"
  run stage-spawn-spike.sh 'C:\fake\m.jsonl' 'C:\fake/staged'
  assert_status 0
  assert_file "$tmp/staged/windows-spawn-tests.exe"
  assert_step_output test_exe "$tmp/staged/windows-spawn-tests.exe"
}

test_stage_ignores_crlf_from_jq() {
  crlf_jq
  spike_build ".exe"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 0
  assert_eq "README.txt gui-host.exe spawn-probe.exe windows-spawn-tests.exe" "$(listing "$tmp/staged")" "the staged files"
}

test_stage_reports_a_missing_artifact() {
  spike_build ""
  grep -v '"name":"spawn"' "$tmp/messages.jsonl" >"$tmp/partial.jsonl"
  run stage-spawn-spike.sh "$tmp/partial.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "expected 1 test artifact for the test target \"spawn\""
  assert_out "found 0"
  assert_file "$tmp/target/debug/spawn-probe"
  refute_path "$tmp/staged"
}

test_stage_rejects_ambiguous_artifacts() {
  spike_build ""
  grep '"name":"gui-host".*"test":false' "$tmp/messages.jsonl" >"$tmp/again.jsonl"
  cat "$tmp/again.jsonl" >>"$tmp/messages.jsonl"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "expected 1 build artifact for the bin target \"gui-host\""
  assert_out "found 2"
  assert_file "$tmp/target/debug/spawn-probe"
}

test_stage_reports_a_vanished_file() {
  spike_build ""
  rm "$tmp/target/debug/gui-host"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "cargo reported $tmp/target/debug/gui-host, but there is no such file"
  assert_file "$tmp/target/debug/spawn-probe"
}

test_stage_refuses_a_folder_that_is_not_empty() {
  spike_build ""
  mkdir -p "$tmp/staged"
  : >"$tmp/staged/stale.exe"
  run stage-spawn-spike.sh "$tmp/messages.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "is not empty"
  assert_file "$tmp/target/debug/deps/spawn-1234"
}

test_stage_needs_the_messages_file() {
  run stage-spawn-spike.sh "$tmp/missing.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "no such file: $tmp/missing.jsonl"
}

test_stage_rejects_messages_that_are_not_json() {
  printf 'warning: unused variable\n' >"$tmp/text.jsonl"
  run stage-spawn-spike.sh "$tmp/text.jsonl" "$tmp/staged"
  assert_status 1
  assert_out "could not read cargo's JSON messages"
}

test_stage_needs_both_arguments() {
  run stage-spawn-spike.sh "$tmp/messages.jsonl"
  assert_status 1
  assert_out "usage: stage-spawn-spike.sh"
}

# --- run-smoke.sh --------------------------------------------------------------------------------

fake_app() { # <shell code>
  printf '#!/usr/bin/env bash\n%s\n' "$1" >"$tmp/app"
  chmod +x "$tmp/app"
}

PASSING='AURACODE_SMOKE_RESULT {"ok":true,"events_received":120,"frames_received":40,"seq_gaps":0,"rendered_chars":900,"fps_min":55.5,"fps_avg":59.8,"errors":[]}'
FAILING='AURACODE_SMOKE_RESULT {"ok":false,"events_received":3,"frames_received":1,"seq_gaps":2,"rendered_chars":0,"fps_min":0,"fps_avg":0,"errors":["the demo answer did not render","the stream skipped sequence numbers 2 time(s)"]}'

smoke_env() {
  mkdir -p "$tmp/runner"
  export RUNNER_TEMP="$tmp/runner"
}

test_smoke_passes_on_a_clean_report() {
  smoke_env
  fake_app "echo 'INFO auracode: main window created' >&2
echo 'some other stdout line'
echo '$PASSING'
exit 0"
  run run-smoke.sh "$tmp/app"
  assert_status 0
  assert_out "::notice::Smoke check passed: 120 events in 40 frames, 0 sequence gaps, 900 characters rendered, 55.5/59.8 fps (min/avg)."
  assert_out "INFO auracode: main window created"
}

test_smoke_runs_the_app_in_smoke_mode_with_fresh_data() {
  smoke_env
  fake_app "{
  echo \"smoke=\$AURACODE_SMOKE exit=\$AURACODE_SMOKE_EXIT\"
  echo \"data=\$AURACODE_DATA_DIR\"
  if [ -d \"\$AURACODE_DATA_DIR\" ] && [ -z \"\$(ls -A \"\$AURACODE_DATA_DIR\")\" ]; then echo fresh=yes; fi
  if read -r line; then echo stdin=open; else echo stdin=eof; fi
} >'$tmp/seen'
echo '$PASSING'"
  run run-smoke.sh "$tmp/app"
  assert_status 0
  grep -Fxq 'smoke=1 exit=1' "$tmp/seen" || fail "smoke mode was not switched on" "$(cat "$tmp/seen")"
  grep -Fxq 'fresh=yes' "$tmp/seen" || fail "the data directory was missing or not empty" "$(cat "$tmp/seen")"
  grep -Fxq 'stdin=eof' "$tmp/seen" || fail "the app's stdin was not closed" "$(cat "$tmp/seen")"
  grep -Fq "data=$tmp/runner/auracode-smoke." "$tmp/seen" || fail "the data directory is not under RUNNER_TEMP" "$(cat "$tmp/seen")"
}

test_smoke_gives_windows_apps_windows_paths() {
  smoke_env
  fake_cygpath
  export RUNNER_TEMP='C:\fake\runner'
  fake_app "echo \"\$AURACODE_DATA_DIR\" >'$tmp/seen'
echo '$PASSING'"
  run run-smoke.sh "$tmp/app"
  assert_status 0
  grep -Fq 'C:\fake\runner\auracode-smoke.' "$tmp/seen" || fail "AURACODE_DATA_DIR is not a Windows path" "$(cat "$tmp/seen")"
}

test_smoke_fails_on_a_failing_report() {
  smoke_env
  fake_app "echo '$FAILING'
exit 1"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "::error::The smoke check failed (3 events in 1 frames, 2 sequence gaps, 0 characters rendered, 0/0 fps (min/avg)):"
  assert_out "  - the demo answer did not render"
  assert_out "  - the stream skipped sequence numbers 2 time(s)"
}

test_smoke_reads_the_minimal_fallback_report() {
  smoke_env
  fake_app "echo 'AURACODE_SMOKE_RESULT {\"ok\":false,\"errors\":[\"could not serialize the report: boom\"]}'
exit 1"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "The smoke check failed (? events in ? frames, ? sequence gaps, ? characters rendered, ?/? fps (min/avg)):"
  assert_out "  - could not serialize the report: boom"
}

test_smoke_fails_on_a_failing_report_even_with_exit_code_zero() {
  smoke_env
  fake_app "echo '$FAILING'
exit 0"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "The smoke check failed"
}

test_smoke_fails_without_a_result_line() {
  smoke_env
  fake_app "echo 'the window opened'
exit 0"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "The app exited with code 0 without printing an AURACODE_SMOKE_RESULT line"
}

test_smoke_reports_a_crash() {
  smoke_env
  fake_app "echo 'thread main panicked' >&2
exit 101"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "The app exited with code 101 without printing an AURACODE_SMOKE_RESULT line"
}

test_smoke_fails_when_a_pass_is_followed_by_a_crash() {
  smoke_env
  fake_app "echo '$PASSING'
exit 3"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "reported a pass (120 events in 40 frames"
  assert_out "but the app then exited with code 3"
}

test_smoke_rejects_two_reports() {
  smoke_env
  fake_app "echo '$PASSING'
echo '$PASSING'"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "The app printed 2 AURACODE_SMOKE_RESULT lines; it must report exactly once."
}

test_smoke_rejects_a_report_that_is_not_json() {
  smoke_env
  fake_app "echo 'AURACODE_SMOKE_RESULT {\"ok\":'"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "is not a JSON object with a boolean \"ok\""
}

test_smoke_rejects_a_report_without_a_boolean_ok() {
  smoke_env
  fake_app "echo 'AURACODE_SMOKE_RESULT {\"ok\":\"yes\",\"errors\":[]}'"
  run run-smoke.sh "$tmp/app"
  assert_status 1
  assert_out "is not a JSON object with a boolean \"ok\""
}

test_smoke_reads_crlf_output() {
  smoke_env
  fake_app "printf '%s\\r\\n' 'log line' '$PASSING'"
  run run-smoke.sh "$tmp/app"
  assert_status 0
  assert_out "Smoke check passed"
}

test_smoke_counts_only_lines_that_start_with_the_marker() {
  smoke_env
  fake_app "echo 'debug: will print AURACODE_SMOKE_RESULT {\"ok\":false} when done'
echo '$PASSING'"
  run run-smoke.sh "$tmp/app"
  assert_status 0
}

test_smoke_needs_an_executable() {
  smoke_env
  run run-smoke.sh "$tmp/missing-app"
  assert_status 1
  assert_out "$tmp/missing-app is not an executable file"
}

# --- Runner. -------------------------------------------------------------------------------------

filter=${1:-}
total=0
failures=0
for test_name in $(declare -F | awk '{ print $3 }' | grep '^test_'); do
  case $test_name in *"$filter"*) ;; *) continue ;; esac
  total=$((total + 1))
  tmp="$suite/$test_name"
  mkdir -p "$tmp/bin"
  : >"$tmp/out"
  # No test reaches the real GitHub API by accident.
  printf '#!/usr/bin/env bash\necho "test.sh: unexpected gh call: $*" >&2\nexit 99\n' >"$tmp/bin/gh"
  chmod +x "$tmp/bin/gh"
  if (
    set -e
    cd "$tmp"
    "$test_name"
  ); then
    printf 'ok    %s\n' "$test_name"
  else
    printf 'FAIL  %s\n' "$test_name"
    failures=$((failures + 1))
  fi
done

if [ "$total" -eq 0 ]; then
  echo "No test matches \"$filter\"." >&2
  exit 1
fi
if [ "$failures" -gt 0 ]; then
  printf '%s of %s tests failed.\n' "$failures" "$total"
  exit 1
fi
printf 'All %s tests passed.\n' "$total"
