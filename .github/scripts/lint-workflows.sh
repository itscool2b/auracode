#!/usr/bin/env bash
# Checks GitHub does not make for us. CI's lint job runs this; test.sh covers it.
#
# 1. Every action from another repository is pinned to a full commit SHA with exactly its version
#    as a trailing comment: `uses: owner/repo@<40 hex characters> # v1.2.3`. A tag or a branch can
#    be moved by whoever controls the action's repository (tj-actions/changed-files, 2025), and
#    these workflows build the installers people download and run. Dependabot moves the pins
#    forward (.github/dependabot.yml), and it can only rewrite a comment that is a bare version.
#    Docker actions need a sha256 digest for the same reason.
# 2. Every `github.event.schedule == '<cron>'` (or `!=`) names a cron the same file schedules, so
#    editing a cron line cannot silently change what a scheduled run does.
# 3. No runner label that GitHub moves to a new OS version on its own schedule: ubuntu-latest,
#    windows-latest and macos-latest (with their -large and -xlarge forms), and ubuntu-slim. A move
#    rolls out over weeks, so the same commit can build on either image, and the Rust cache key does
#    not name the image, so each image restores the other's build. Workflows name the version
#    (ubuntu-24.04, windows-2025, macos-26) and move it on purpose. Comments are not checked, so
#    they can still say why.
#
# Usage: lint-workflows.sh [workflow file...]
# With no arguments it checks every workflow in .github/workflows, named relative to the repository
# root so the error annotations link to the right lines.
# shellcheck source-path=SCRIPTDIR
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

uses_re='^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*(.*)$'
sha_re='^[0-9a-f]{40}$'
version_re='^v?[0-9]+(\.[0-9]+)*$'
digest_re='^sha256:[0-9a-f]{64}$'
schedule_ref_re="github\\.event\\.schedule[[:space:]]*[!=]=[[:space:]]*'[^']*'"
# A floating label as a whole word: not part of a longer name such as ubuntu-latest-tools.
floating_label_re='(^|[^[:alnum:]_.-])((ubuntu|windows|macos)-latest[[:alnum:]-]*|ubuntu-slim[[:alnum:]-]*)([^[:alnum:]_.-]|$)'

problems=0
code="" # set by uncomment

problem() { # <file> <line> <message>
  printf '::error file=%s,line=%s::%s\n' "$1" "$2" "$3"
  problems=$((problems + 1))
}

trim() {
  local s=$1
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

unquote() {
  local s=$1
  case $s in
  \"*\") s=${s#\"} && s=${s%\"} ;;
  \'*\') s=${s#\'} && s=${s%\'} ;;
  esac
  printf '%s' "$s"
}

check_uses() { # <file> <line> <text after "uses:">
  local file=$1 line=$2 value=$3 ref comment="" pin
  ref=$value
  if [[ $value == *"#"* ]]; then
    ref=${value%%#*}
    comment=$(trim "${value#*#}")
  fi
  ref=$(unquote "$(trim "$ref")")
  pin=${ref##*@}
  case $ref in
  ./*) ;; # an action or reusable workflow in this repository
  docker://*@*)
    [[ $pin =~ $digest_re ]] ||
      problem "$file" "$line" "$ref is not pinned by a sha256 digest"
    ;;
  docker://*)
    problem "$file" "$line" "$ref can change under the same tag: pin it as docker://<image>@sha256:<digest>"
    ;;
  */*@*)
    if ! [[ $pin =~ $sha_re ]]; then
      problem "$file" "$line" "${ref%@*} is pinned to \"$pin\", which can be moved: pin the full 40-character commit SHA and put the version in a trailing comment (# v1.2.3)"
    elif ! [[ $comment =~ $version_re ]]; then
      problem "$file" "$line" "${ref%@*}@$pin needs the version it pins as its only trailing comment (# v1.2.3), so people and Dependabot can read and update it"
    fi
    ;;
  *)
    problem "$file" "$line" "unrecognised action reference \"$ref\": expected owner/repo@<commit SHA> # <version>, ./<path>, or docker://<image>@sha256:<digest>"
    ;;
  esac
}

# Sets $code to <line> without its YAML comment, which starts at a # that begins the line or follows
# whitespace. A # inside a quoted string also ends it, which can only hide a label, never invent
# one.
uncomment() { # <line>
  local rest=$1 head=""
  code=$1
  while [[ $rest == *"#"* ]]; do
    head+=${rest%%#*}
    rest=${rest#*#}
    if [[ -z $head || $head =~ [[:space:]]$ ]]; then
      code=$head
      return
    fi
    head+="#"
  done
}

# Runner labels ignore case (Ubuntu-Latest is ubuntu-latest), so the match does too.
check_labels() { # <file> <line> <line without its comment>
  local rest=$3
  shopt -s nocasematch
  while [[ $rest =~ $floating_label_re ]]; do
    problem "$1" "$2" "${BASH_REMATCH[2]} is a runner label GitHub moves to new OS versions on its own schedule: name the version instead (for example ubuntu-24.04, windows-2025, macos-26)"
    rest=${rest#*"${BASH_REMATCH[0]}"}
  done
  shopt -u nocasematch
}

check_schedule_refs() { # <file>
  local file=$1 crons line match cron
  crons=$(sed -n -E "s/^[[:space:]]*-?[[:space:]]*cron:[[:space:]]*[\"']?([^\"'#]*[^\"'#[:space:]])[\"']?[[:space:]]*(#.*)?\$/\\1/p" "$file" | tr -d '\r')
  while IFS=: read -r line match; do
    cron=$(printf '%s\n' "$match" | sed -E "s/.*'([^']*)'\$/\\1/")
    if ! printf '%s\n' "$crons" | grep -Fxq -- "$cron"; then
      problem "$file" "$line" "github.event.schedule is compared with '$cron', but this file schedules no such cron"
    fi
  done < <(grep -n -o -E "$schedule_ref_re" "$file" || true)
}

if [ "$#" -eq 0 ]; then
  cd "$here/../.."
  for file in .github/workflows/*.yml .github/workflows/*.yaml; do
    if [ -e "$file" ]; then
      set -- "$@" "$file"
    fi
  done
  [ "$#" -gt 0 ] || die "no workflow files in .github/workflows"
fi

for file in "$@"; do
  [ -f "$file" ] || die "no such file: $file"
  line_number=0
  # shellcheck disable=SC2094 # the checks only name the file in their messages; nothing writes it
  while IFS= read -r text || [ -n "$text" ]; do
    line_number=$((line_number + 1))
    if [[ $text =~ $uses_re ]]; then
      # An action's name may contain a label's words (owner/ubuntu-latest-tools); rule 1 covers it.
      check_uses "$file" "$line_number" "${BASH_REMATCH[2]}"
    else
      uncomment "$text"
      check_labels "$file" "$line_number" "$code"
    fi
  done <"$file"
  check_schedule_refs "$file"
done

if [ "$problems" -gt 0 ]; then
  printf '%s problem(s) in %s workflow file(s).\n' "$problems" "$#"
  exit 1
fi
printf 'Checked %s workflow file(s): every action is pinned, no runner label floats, and every schedule comparison names a scheduled cron.\n' "$#"
