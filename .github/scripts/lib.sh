# Helpers shared by the CI scripts in this directory. Sourced, never run on its own.
#
# Written for bash 3.2 (macOS's /bin/bash, where test.sh also runs) as well as the bash 5 on the
# Linux and Windows runners: no associative arrays, no mapfile, and no "${array[@]}" on arrays
# that may be empty.
# shellcheck shell=bash

# GitHub Actions annotations. Outside Actions they are plain, readable lines.
notice() { printf '::notice::%s\n' "$*"; }
warning() { printf '::warning::%s\n' "$*"; }
error() { printf '::error::%s\n' "$*"; }
die() {
  error "$*"
  exit 1
}

# Records a step output. Also echoed, so the log (and a local run) shows the decision.
set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
  fi
  printf '%s=%s\n' "$1" "$2"
}

# Fails with the variable's name if any of the named environment variables is unset or empty.
require_env() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is not set"
  done
}

# Percent-encodes one query-string value.
uri_encode() {
  jq -rn --arg value "$1" '$value | @uri'
}

# `gh api <path>` with retries. The API fails transiently now and then, and a run that gives up on
# the first error decides nothing. Waits CI_GH_RETRY_DELAY seconds times the attempt number between
# CI_GH_ATTEMPTS tries (the tests set the delay to 0). gh prints its own errors on stderr.
gh_api() {
  local attempts=${CI_GH_ATTEMPTS:-3} delay=${CI_GH_RETRY_DELAY:-5} attempt=1 body
  while :; do
    if body="$(gh api "$1")"; then
      printf '%s\n' "$body"
      return 0
    fi
    if [ "$attempt" -ge "$attempts" ]; then
      return 1
    fi
    sleep $((attempt * delay))
    attempt=$((attempt + 1))
  done
}

# Cargo and jq on Windows print Windows paths (D:\a\...), which Git Bash tools read best as
# /d/a/...; native Windows programs want the Windows form back, in arguments and the environment.
# cygpath only exists in Git Bash, so elsewhere both are the identity.
to_unix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}

to_native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}
