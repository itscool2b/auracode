#!/usr/bin/env bash
# Build both revisions from source and compare identical fixtures on one native runner.
set -euo pipefail

die() {
  printf 'checkpoint benchmark: %s\n' "$*" >&2
  exit 1
}

native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"
cd "$repo"

counts=${AURA_CHECKPOINT_BENCH_COUNTS:-1000,10000,20000}
warm=${AURA_CHECKPOINT_BENCH_WARM:-1}
baseline_ref=${CHECKPOINT_BASELINE_REF:-af499cd05684df8d2f08e48af21d268b522862f7}
[[ $counts =~ ^[1-9][0-9]*(,[1-9][0-9]*){0,2}$ ]] ||
  die 'fixture sizes must be one to three comma-separated positive integers'
IFS=, read -r -a sizes <<< "$counts"
for size in "${sizes[@]}"; do
  if [[ ${#size} -gt 5 ]] || ((size > 20000)); then
    die 'fixture sizes must not exceed 20000'
  fi
done
[[ $warm =~ ^([1-9]|10)$ ]] || die 'unchanged sample count must be from 1 to 10'
[[ -n ${RUNNER_TEMP:-} ]] || die 'RUNNER_TEMP is required for isolated baseline files and evidence'

temp_root=$RUNNER_TEMP
if command -v cygpath >/dev/null 2>&1; then
  temp_root=$(cygpath -u "$temp_root")
fi
temp_root="$(cd "$temp_root" && pwd -P)"
case "$temp_root/" in
  "$repo/"*) die 'RUNNER_TEMP must be outside the measured checkout' ;;
esac
[[ -z $(git status --porcelain=v1 --untracked-files=normal) ]] ||
  die 'the measured checkout must be clean before preparing the comparison'
git check-ignore --quiet -- target/ || die 'the shared build directory must be ignored by the measured checkout'
baseline_commit=$(git rev-parse --verify --end-of-options "${baseline_ref}^{commit}") ||
  die 'the baseline must resolve to a commit in the fetched history'
current_commit=$(git rev-parse HEAD)

run_dir=$(mktemp -d "$temp_root/checkpoint-performance.XXXXXX")
baseline_dir="$run_dir/baseline"
evidence="$temp_root/checkpoint-performance-evidence"
mkdir "$evidence"
git worktree add --detach "$baseline_dir" "$baseline_commit"

core=crates/aura-core/src/checkpoints
session=crates/aura-core/src/session/tests
[[ -f "$baseline_dir/$core/mod.rs" && -f "$baseline_dir/$session/checkpoints.rs" ]] ||
  die 'the baseline does not support these checkpoint benchmark fixtures'
cp "$repo/$core/benchmarks.rs" "$baseline_dir/$core/benchmarks.rs"
if ! grep -Eq '^[[:space:]]*mod benchmarks;' "$baseline_dir/$core/mod.rs"; then
  printf '\n#[cfg(test)]\nmod benchmarks;\n' >> "$baseline_dir/$core/mod.rs"
fi
cp "$repo/$session/checkpoint_benchmarks.rs" "$baseline_dir/$session/checkpoint_benchmarks.rs"
if grep -Eq '^[[:space:]]*mod benchmarks;' "$baseline_dir/$session/checkpoints.rs"; then
  grep -Fq '#[path = "checkpoint_benchmarks.rs"]' "$baseline_dir/$session/checkpoints.rs" ||
    die 'the baseline has a different native checkpoint benchmark module'
else
  printf '\n#[path = "checkpoint_benchmarks.rs"]\nmod benchmarks;\n' >> "$baseline_dir/$session/checkpoints.rs"
fi

export CARGO_TARGET_DIR
CARGO_TARGET_DIR=$(native_path "$repo/target")
export AURA_CHECKPOINT_BENCH_WORKSPACE
AURA_CHECKPOINT_BENCH_WORKSPACE=$(native_path "$repo")
export AURA_CHECKPOINT_BENCH_COUNTS=$counts
export AURA_CHECKPOINT_BENCH_WARM=$warm

{
  printf 'baseline_commit=%s\ncurrent_commit=%s\n' "$baseline_commit" "$current_commit"
  printf 'counts=%s\nwarm_samples=%s\nbuild_profile=test\nfeatures=account-sync\n' "$counts" "$warm"
  printf 'started_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'core_fixture_blob=%s\n' "$(git hash-object "$core/benchmarks.rs")"
  printf 'native_fixture_blob=%s\n' "$(git hash-object "$session/checkpoint_benchmarks.rs")"
  git --version
  cargo --version
  rustc -Vv
  uname -srv
} > "$evidence/environment.txt"

measure() {
  local revision=$1 directory=$2 fixture=$3 marker=$4
  local log="$evidence/$revision-$fixture.log"
  (
    cd "$directory"
    cargo test -p aura-core --features account-sync --lib --locked "$fixture" -- \
      --ignored --nocapture --test-threads=1
  ) 2>&1 | tee "$log"
  grep -Eq 'test result: ok[.] 1 passed; 0 failed;' "$log" ||
    die "$revision did not run exactly one successful $fixture test"
  grep -Fq "$marker" "$log" || die "$revision produced no $fixture measurements"
  if [[ $fixture == checkpoint_performance ]]; then
    grep -Fq 'CHECKPOINT_BENCH storage=account' "$log" ||
      die "$revision did not measure encrypted Account capture"
  fi
  awk -v revision="$revision" '/CHECKPOINT_/ { sub(/^.*CHECKPOINT_/, "CHECKPOINT_"); print revision " " $0 }' \
    "$log" >> "$evidence/measurements.txt"
}

# Builds finish before each test begins. Never run another build or measurement concurrently on
# this runner, and do not write evidence or baseline sources inside the measured checkout.
for revision in baseline current; do
  directory=$repo
  if [[ $revision == baseline ]]; then directory=$baseline_dir; fi
  measure "$revision" "$directory" checkpoint_workspace_performance 'CHECKPOINT_WORKSPACE storage=local'
  measure "$revision" "$directory" checkpoint_prompt_performance 'CHECKPOINT_PROMPT files=1000'
  measure "$revision" "$directory" checkpoint_performance 'CHECKPOINT_BENCH storage=local'
done

[[ -z $(git status --porcelain=v1 --untracked-files=normal) ]] ||
  die 'the measured checkout changed during the comparison'
printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$evidence/environment.txt"
