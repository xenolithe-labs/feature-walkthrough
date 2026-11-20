#!/usr/bin/env bash
# Owner-only: use credentials kept in 1Password without writing them anywhere.
#
#   scripts/secrets/with-op.sh check                    which secrets resolve (names only, never values)
#   scripts/secrets/with-op.sh github-sync [--dry-run]  push the "github" secrets into the GitHub environment
#   scripts/secrets/with-op.sh -- <command...>          run one command with every secret in its environment
#
# The list of secrets is scripts/secrets/mapping.tsv, which git ignores: copy mapping.example.tsv and fill it in.
# No value is written to the repository, printed, or put on the clipboard. `op run` passes values to the one
# command it starts and masks them in that command's output.
#
# GitHub environment: $FW_GITHUB_ENV (default: npm). Requires: op (1Password CLI, integrated with the desktop
# app so it unlocks with Touch ID), jq, and gh for github-sync.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$here/../.." && pwd)
mapping="${FW_SECRETS_MAPPING:-$here/mapping.tsv}"
github_env="${FW_GITHUB_ENV:-npm}"

die() { echo "with-op: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed ($2)"; }

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

setup() {
  need op "brew install 1password-cli, then 1Password app > Settings > Developer > Integrate with 1Password CLI"
  need jq "brew install jq"
  [ -r "$mapping" ] || die "no $mapping: copy scripts/secrets/mapping.example.tsv to it and fill in your references"
  local bad
  bad=$(rows | awk -F '\t' 'NF != 4 || $1 !~ /^[A-Z][A-Z0-9_]*$/ || $2 !~ /^(github|local)$/ || $3 !~ /^(yes|opt)$/ || $4 !~ /^op:\/\/[^\/]+\/[^\/]+\/.+$/ { print "  line: " $1 }')
  [ -z "$bad" ] || die "these rows of mapping.tsv are not 'NAME<TAB>github|local<TAB>yes|opt<TAB>op://vault/item/field':
$bad"
}

# rows: name where required ref (tab-separated; comments and blank lines skipped)
rows() { grep -vE '^[[:space:]]*(#|$)' "$mapping" || true; }
ref_vault() { printf '%s' "$1" | sed -E 's#^op://([^/]+)/.*$#\1#'; }
ref_item() { printf '%s' "$1" | sed -E 's#^op://[^/]+/([^/]+)/.*$#\1#'; }
ref_field() { printf '%s' "$1" | sed -E 's#^op://[^/]+/[^/]+/(.*)$#\1#'; }

# The field and attachment names of an item, cached for this run. The item passes through a pipe only: nothing
# but names reaches the terminal or the disk.
work=$(mktemp -d "${TMPDIR:-/tmp}/with-op.XXXXXX")
trap 'rm -rf "$work"' EXIT
item_labels() { # $1 = vault, $2 = item
  local f
  f="$work/$(printf '%s/%s' "$1" "$2" | tr -c 'A-Za-z0-9_' '_')"
  if [ ! -e "$f" ]; then
    op item get "$2" --vault "$1" --format json 2>/dev/null \
      | jq -r '[(.fields // [])[] | select(.label != null) | .label] + [(.files // [])[] | .name] | .[]' > "$f" || : > "$f"
  fi
  cat "$f"
}
resolves() { item_labels "$(ref_vault "$1")" "$(ref_item "$1")" | grep -qxF -- "$(ref_field "$1")"; }

# Writes NAME=op://... lines (references, not values) for the rows that resolve. Prints the names it wrote.
# $1 = file to write, $2 = "all" or "github"
write_env() {
  local file="$1" want="$2" name where required ref
  : > "$file"; chmod 600 "$file"
  while IFS=$'\t' read -r name where required ref; do
    [ "$want" = all ] || [ "$where" = "$want" ] || continue
    if resolves "$ref"; then
      printf '%s=%s\n' "$name" "$ref" >> "$file"
      echo "$name"
    elif [ "$required" = yes ]; then
      die "$name does not resolve; run: scripts/secrets/with-op.sh check"
    else
      echo "  skip     $name (optional, not in 1Password)" >&2
    fi
  done < <(rows)
}

cmd_check() {
  setup
  local missing=0 name where required ref
  while IFS=$'\t' read -r name where required ref; do
    if resolves "$ref"; then printf '  OK       %-28s %-7s %s\n' "$name" "$where" "$ref"
    elif [ "$required" = yes ]; then printf '  MISSING  %-28s %-7s %s\n' "$name" "$where" "$ref"; missing=$((missing + 1))
    else printf '  optional %-28s %-7s %s\n' "$name" "$where" "$ref"
    fi
  done < <(rows)
  [ "$missing" -eq 0 ] || die "$missing required secret(s) missing: the vault, item and field names must match exactly"
  echo "with-op: every required reference resolves"
}

cmd_run() {
  setup
  local names
  names=$(write_env "$work/env" all | tr '\n' ' ')
  echo "with-op: loading: ${names:-nothing}" >&2
  op run --env-file="$work/env" -- "$@"
}

cmd_github_sync() {
  local dry=0
  [ "${1:-}" = --dry-run ] && dry=1
  setup
  need gh "brew install gh, then gh auth login"
  local repo names
  repo=$(cd "$root" && gh repo view --json nameWithOwner -q .nameWithOwner)
  names=$(write_env "$work/env" github | tr '\n' ' ')
  [ -n "$names" ] || die "mapping.tsv has no 'github' secret that resolves"
  echo "with-op: to $repo, environment \"$github_env\": $names"
  if [ "$dry" -eq 1 ]; then echo "(dry run: nothing set)"; return 0; fi
  # Creates the environment if it is not there; leaves an existing one as it is.
  gh api "repos/$repo/environments/$github_env" >/dev/null 2>&1 \
    || gh api -X PUT "repos/$repo/environments/$github_env" >/dev/null
  # The values exist only inside this one `op run`, and go from its environment straight into gh's input.
  SYNC_NAMES="$names" SYNC_REPO="$repo" SYNC_ENV="$github_env" op run --env-file="$work/env" -- bash -c '
    set -euo pipefail
    for n in $SYNC_NAMES; do
      printenv "$n" | gh secret set "$n" --env "$SYNC_ENV" --repo "$SYNC_REPO" >/dev/null
      echo "  set      $n"
    done'
  echo "with-op: done. GitHub shows only the names: gh secret list --env $github_env"
}

case "${1:-}" in
  check) cmd_check ;;
  github-sync) shift; cmd_github_sync "${1:-}" ;;
  --) shift; [ $# -ge 1 ] || die "no command given after --"; cmd_run "$@" ;;
  -h | --help | "") usage ;;
  *) die "unknown argument '$1' (try --help)" ;;
esac
