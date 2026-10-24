#!/usr/bin/env bash
# The Build workflow's `plan` job, for scheduled runs: does main's head still need bundles?
#
# A push to main bundles its commit by itself, so on most nights there is nothing left to build,
# and rebuilding identical bundles bills macOS at 10x and Windows at 2x. The nightly therefore
# builds a commit at most once, and only when no other run is doing or has done it:
# - skip when a run of this workflow built every bundle for the commit;
# - skip when a push or manual run for the commit is still going (it will build them);
# - skip when an earlier nightly already built or tried the commit: retrying a broken commit every
#   night repeats the same failure at the same price. Push a fix, or run the workflow by hand.
# A run counts as having built or tried only through its bundle jobs (latest attempt), because a
# nightly that skipped still ends as a success.
#
# Unlike CI's open-PR check this fails closed, loudly: if GitHub cannot be asked after retries, the
# job fails and the run shows it, since a silent default would either drop bundles or rebuild
# every night unnoticed.
#
# Env: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, BRANCH (the default branch), WORKFLOW_FILE
# (this workflow's file name), BUNDLE_JOB_PREFIX (the bundle jobs' name up to the matrix value,
# "bundle ("), GH_TOKEN (needs actions: read). Output: build=true|false.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

require_env GITHUB_REPOSITORY GITHUB_SHA GITHUB_RUN_ID BRANCH WORKFLOW_FILE BUNDLE_JOB_PREFIX

commit=${GITHUB_SHA:0:7}

decide() { # <true|false> <reason>
  notice "$2"
  set_output build "$1"
  exit 0
}

runs_path="repos/$GITHUB_REPOSITORY/actions/workflows/$WORKFLOW_FILE/runs?head_sha=$GITHUB_SHA&branch=$(uri_encode "$BRANCH")&per_page=100"
runs_json="$(gh_api "$runs_path")" ||
  die "Could not list $WORKFLOW_FILE runs for $commit, so the nightly cannot tell whether it is needed."

# One line per other run of this workflow for this commit: id, event, status, conclusion, URL.
runs="$(printf '%s\n' "$runs_json" | jq -r --arg self "$GITHUB_RUN_ID" '
  .workflow_runs[]
  | select((.id | tostring) != $self)
  | [(.id | tostring), .event, .status, (.conclusion // "none"), .html_url]
  | @tsv' | tr -d '\r')" ||
  die "GitHub's list of $WORKFLOW_FILE runs for $commit was not in the expected shape."

tried=""
while IFS=$'\t' read -r id event status conclusion url; do
  [ -n "$id" ] || continue
  if [ "$status" != completed ] && [ "$event" != schedule ]; then
    decide false "Run $url ($event) is building $commit right now, so the nightly skips it."
  fi
  jobs_json="$(gh_api "repos/$GITHUB_REPOSITORY/actions/runs/$id/jobs?filter=latest&per_page=100")" ||
    die "Could not list the jobs of run $url."
  # Bundle jobs of the latest attempt: how many, how many succeeded, how many ran at all.
  counts="$(printf '%s\n' "$jobs_json" | jq -r --arg prefix "$BUNDLE_JOB_PREFIX" '
    [.jobs[] | select(.name | startswith($prefix))]
    | [length, (map(select(.conclusion == "success")) | length), (map(select(.conclusion != "skipped")) | length)]
    | @tsv' | tr -d '\r')" ||
    die "The jobs of run $url were not in the expected shape."
  read -r total succeeded ran <<<"$counts"
  if [ "$total" -gt 0 ] && [ "$succeeded" -eq "$total" ]; then
    decide false "Run $url ($event) already built every bundle for $commit, so the nightly skips it."
  fi
  if [ "$event" = schedule ] && [ "$ran" -gt 0 ] && [ -z "$tried" ]; then
    tried="$url ($conclusion)"
  fi
done <<<"$runs"

if [ -n "$tried" ]; then
  decide false "The nightly already tried $commit in run $tried and does not retry a commit. Push a fix or run Build by hand."
fi
decide true "No run has built the bundles for $commit yet, so the nightly builds them."
