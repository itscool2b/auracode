#!/usr/bin/env bash
# CI's `plan` job, for pushes to milestone branches: does a pull request's run cover this push?
# GitHub runs an open pull request's workflows on each push to its branch, on the commit merged
# with the base branch, and then the branch run skips rather than bill Linux and Windows a second
# time. But GitHub runs no `pull_request` workflow while the pull request has a merge conflict, so
# the push counts as covered only when GitHub reports the pull request open, at this commit, and
# mergeable. Right after a push, GitHub reports mergeability as null while it works it out in the
# background, and can still report the previous commit as the head; either way it is asked again,
# with retry_wait's pauses (lib.sh).
#
# Fails open: when GitHub cannot be asked, answers in an unexpected shape, or has not settled by the
# last try, CI runs, since a duplicate run costs minutes and a skipped one hides results. A missing
# variable is a broken workflow, so that fails the job.
#
# Env: GITHUB_REPOSITORY (owner/repo), GITHUB_REPOSITORY_OWNER, GITHUB_SHA (the pushed commit),
# BRANCH (the pushed branch), GH_TOKEN (needs pull-requests: read). Output: covered=true|false.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

require_env GITHUB_REPOSITORY GITHUB_REPOSITORY_OWNER GITHUB_SHA BRANCH

# Ends the script with CI running: <annotation> is notice for a decision, warning for a failure.
run_ci() { # <annotation> <message>
  "$1" "$2"
  set_output covered false
  exit 0
}

head="$(uri_encode "$GITHUB_REPOSITORY_OWNER:$BRANCH")"
if ! response="$(gh_api "repos/$GITHUB_REPOSITORY/pulls?state=open&head=$head&per_page=1")"; then
  run_ci warning "Could not ask GitHub whether $BRANCH has an open pull request; running CI anyway."
fi

# "none", or the pull request's number and link. The list leaves mergeability out, so the pull
# request itself is asked for below.
if ! listed="$(printf '%s\n' "$response" | jq -r '
  if type != "array" then error("not a list")
  elif length == 0 then "none"
  elif (.[0] | type) == "object" and (.[0].number | type) == "number" then "\(.[0].number) \(.[0].html_url)"
  else "unnumbered" end' 2>/dev/null)"; then
  run_ci warning "GitHub's answer about open pull requests for $BRANCH was not a list; running CI anyway."
fi
listed=${listed%$'\r'}
case $listed in
none) run_ci notice "$BRANCH has no open pull request, so this push runs CI." ;;
unnumbered) run_ci warning "GitHub listed an open pull request for $BRANCH without its number; running CI anyway." ;;
esac
number=${listed%% *}
pr="#$number (${listed#* })"

tries=0
while :; do
  if ! response="$(gh_api "repos/$GITHUB_REPOSITORY/pulls/$number")"; then
    run_ci warning "Could not ask GitHub whether pull request $pr can be merged; running CI anyway."
  fi
  # A mergeable value that belongs to an earlier head says nothing about this commit, so the head
  # is compared first.
  verdict="$(printf '%s\n' "$response" | jq -r --arg sha "$GITHUB_SHA" '
    if type != "object" or (.state | type) != "string" or (.head | type) != "object"
      or (.head.sha | type) != "string" or (has("mergeable") | not) then "invalid"
    elif .state != "open" then "closed"
    elif .head.sha != $sha then "behind"
    elif .mergeable == true then "mergeable"
    elif .mergeable == false then "conflicted"
    elif .mergeable == null then "computing"
    else "invalid" end' 2>/dev/null)" || verdict=invalid
  verdict=${verdict%$'\r'}
  case $verdict in
  mergeable)
    notice "$BRANCH has open pull request $pr, which GitHub can merge: its run covers this commit, so this push skips CI."
    set_output covered true
    exit 0
    ;;
  conflicted)
    run_ci notice "$BRANCH has open pull request $pr, but it has a merge conflict with its base branch: GitHub runs no pull request workflow until that is resolved, so this push runs CI."
    ;;
  closed)
    run_ci notice "Pull request $pr is no longer open, so this push runs CI."
    ;;
  behind | computing) ;;
  *)
    run_ci warning "GitHub's answer about pull request $pr was not a pull request; running CI anyway."
    ;;
  esac
  tries=$((tries + 1))
  if retry_wait "$tries"; then
    continue
  fi
  if [ "$verdict" = behind ]; then
    run_ci warning "Pull request $pr was still not at this push's commit ${GITHUB_SHA:0:7} after $tries tries (GitHub has not caught up with the push, or the branch has moved on since); running CI anyway."
  fi
  run_ci warning "GitHub had still not worked out whether pull request $pr can be merged after $tries tries; running CI anyway."
done
