#!/usr/bin/env bash
# Runs the desktop app in smoke mode and fails unless it passed. The app (built with its frontend
# embedded, so no dev server is involved) streams a demo turn, a cancelled turn and a stress burst
# through the real typed command + Channel path and the real webview, then prints one
# `AURACODE_SMOKE_RESULT <json>` line and exits 0 on a pass or 1 on a failure
# (apps/desktop/src-tauri/src/smoke.rs). Its own 120 s watchdog reports a failure if the UI never
# reports, so a hang shorter than the CI step timeout still ends with a verdict.
#
# Both signals must agree: exactly one result line saying "ok": true, and exit code 0. A crash
# after a passing report, a report lost on the way out, or a doubled report all fail.
#
# Usage: run-smoke.sh <app executable>   (Linux needs a display: run it under xvfb-run)
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

[ "$#" -eq 1 ] || die "usage: run-smoke.sh <app executable>"
app=$1
if ! { [ -f "$app" ] && [ -x "$app" ]; }; then
  die "$app is not an executable file; build it first (pnpm --filter @auracode/desktop tauri build --debug --no-bundle)"
fi

# A fresh, empty data directory: the first-launch path (profile and database created from
# nothing), and nothing from an earlier run can leak in.
scratch="$(to_unix_path "${RUNNER_TEMP:-${TMPDIR:-/tmp}}")"
data_dir="$(mktemp -d "$scratch/auracode-smoke.XXXXXX")"
stdout_log="$data_dir.stdout"

printf 'Running %s in smoke mode (data directory %s)\n' "$app" "$data_dir"
set +e
AURACODE_SMOKE=1 AURACODE_SMOKE_EXIT=1 AURACODE_DATA_DIR="$(to_native_path "$data_dir")" \
  "$app" </dev/null | tee "$stdout_log"
status=${PIPESTATUS[0]}
set -e

results="$(grep -a '^AURACODE_SMOKE_RESULT ' "$stdout_log" | tr -d '\r' || true)"
count="$(printf '%s' "$results" | grep -c '' || true)"

if [ "$count" -eq 0 ]; then
  die "The app exited with code $status without printing an AURACODE_SMOKE_RESULT line (its log is above)."
fi
if [ "$count" -gt 1 ]; then
  die "The app printed $count AURACODE_SMOKE_RESULT lines; it must report exactly once."
fi

report=${results#AURACODE_SMOKE_RESULT }
# tostring: with -e, a bare false would read as jq failing.
if ! ok="$(printf '%s\n' "$report" | jq -er 'if type == "object" and (.ok | type) == "boolean" then (.ok | tostring) else error("no boolean ok") end' 2>/dev/null)"; then
  die "The smoke result is not a JSON object with a boolean \"ok\": $report"
fi
ok=${ok%$'\r'}

# "?" for a field the report lacks: smoke.rs falls back to a bare {"ok":false,"errors":[...]} if
# the full report cannot be serialized.
summary="$(printf '%s\n' "$report" | jq -r 'def n(f): f // "?"; "\(n(.events_received)) events in \(n(.frames_received)) frames, \(n(.seq_gaps)) sequence gaps, \(n(.rendered_chars)) characters rendered, \(n(.fps_min))/\(n(.fps_avg)) fps (min/avg)"' | tr -d '\r')"

if [ "$ok" != true ]; then
  error "The smoke check failed ($summary):"
  printf '%s\n' "$report" | jq -r '(.errors // [])[] | "  - \(.)"' | tr -d '\r'
  exit 1
fi
if [ "$status" -ne 0 ]; then
  die "The smoke check reported a pass ($summary), but the app then exited with code $status."
fi
notice "Smoke check passed: $summary."
