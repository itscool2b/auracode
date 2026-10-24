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

# The pause between two tries at asking GitHub something: CI_GH_RETRY_DELAY seconds (default 5)
# times the number of tries so far, so 5 s, then 10 s. Returns 1 without waiting once that number
# reaches CI_GH_ATTEMPTS (default 3), since no try follows. The tests set the delay to 0. Shared by
# gh_api and by scripts that ask again while GitHub works an answer out in the background, so the
# same two settings tune both.
retry_wait() { # <tries so far>
  [ "$1" -lt "${CI_GH_ATTEMPTS:-3}" ] || return 1
  sleep $(($1 * ${CI_GH_RETRY_DELAY:-5}))
}

# `gh api <path>` with retries. The API fails transiently now and then, and a run that gives up on
# the first error decides nothing. Tries as often, and waits as long, as retry_wait says. gh prints
# its own errors on stderr.
gh_api() {
  local tries=0 body
  while :; do
    if body="$(gh api "$1")"; then
      printf '%s\n' "$body"
      return 0
    fi
    tries=$((tries + 1))
    retry_wait "$tries" || return 1
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
