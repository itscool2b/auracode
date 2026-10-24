#!/usr/bin/env bash
# CI's `plan` job, for pushes to milestone branches: does this branch have an open pull request?
# If it does, the pull request's own run tests the same commit (merged with main), so the branch
# run skips rather than bill Linux and Windows a second time.
#
# Fails open: when GitHub cannot be asked, CI runs, since a duplicate run costs minutes and a
# skipped one hides results. A missing variable is a broken workflow, so that fails the job.
#
# Env: GITHUB_REPOSITORY (owner/repo), GITHUB_REPOSITORY_OWNER, BRANCH (the pushed branch),
# GH_TOKEN (needs pull-requests: read). Output: open=true|false.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

require_env GITHUB_REPOSITORY GITHUB_REPOSITORY_OWNER BRANCH

head="$(uri_encode "$GITHUB_REPOSITORY_OWNER:$BRANCH")"
if ! response="$(gh_api "repos/$GITHUB_REPOSITORY/pulls?state=open&head=$head&per_page=1")"; then
  warning "Could not ask GitHub whether $BRANCH has an open pull request; running CI anyway."
  set_output open false
  exit 0
fi

if ! count="$(printf '%s\n' "$response" | jq -r 'if type == "array" then length else error("not a list") end' 2>/dev/null)"; then
  warning "GitHub's answer about open pull requests for $BRANCH was not a list; running CI anyway."
  set_output open false
  exit 0
fi
count=${count%$'\r'}

if [ "$count" = 0 ]; then
  notice "$BRANCH has no open pull request, so this push runs CI."
  set_output open false
  exit 0
fi

pr="$(printf '%s\n' "$response" | jq -r '.[0] | "#\(.number) (\(.html_url))"')"
notice "$BRANCH has open pull request ${pr%$'\r'}: its run covers this commit, so this push skips CI."
set_output open true
