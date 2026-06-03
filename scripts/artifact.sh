#!/bin/bash
# Publish and list gated wiki artifacts from the command line.
#
# A thin wrapper over the artifact API (`/api/artifacts`) so scripts and
# agents can share an HTML/Markdown/text file behind the wiki's auth
# boundary without opening the UI.
#
# Auth: set WIKI_TOKEN to a personal API token (looks like `wt_…`; mint
# one from the wiki under Settings → API tokens). The API base defaults
# to the local dev backend; override with WIKI_API_BASE.
#
#   export WIKI_TOKEN=wt_xxxxxxxxxxxxxxxx
#   scripts/artifact.sh publish report.html --name "Q2 report" --wiki
#   scripts/artifact.sh publish notes.md --private      # → private share link
#   scripts/artifact.sh list
#
# Usage:
#   artifact.sh publish <file> [--name NAME]
#                              [--private | --wiki | --public | --visibility X]
#                              [--expires YYYY-MM-DD]
#   artifact.sh list [--limit N]
#
# Visibility (default: wiki):
#   private  only you can view
#   wiki     anyone signed in to this wiki can view
#   public   anyone with the link (only if the instance allows it)
set -euo pipefail

API_BASE="${WIKI_API_BASE:-http://localhost:8000/api}"
HAS_JQ=$(command -v jq >/dev/null 2>&1 && echo 1 || echo 0)

die() { echo "error: $*" >&2; exit 1; }

require_token() {
  [ -n "${WIKI_TOKEN:-}" ] || die "WIKI_TOKEN is not set (need a wt_ API token)."
}

# Pull a top-level string field out of a JSON blob. Uses jq when present,
# else a portable grep/sed fallback (good enough for flat API responses).
json_field() {
  local key="$1" body="$2"
  # `|| true`: a no-match grep returns non-zero which, under `set -o
  # pipefail`, would kill the script before the caller can report the
  # real API error. Tolerate it and let the caller handle an empty value.
  if [ "$HAS_JQ" = "1" ]; then
    printf '%s' "$body" | jq -r --arg k "$key" '.[$k] // empty' || true
  else
    { printf '%s' "$body" \
      | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -n1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"; } || true
  fi
}

cmd_publish() {
  require_token
  local file="" name="" visibility="" expires=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --name)       name="$2"; shift 2 ;;
      --visibility) visibility="$2"; shift 2 ;;
      # Shorthands: `--private` / `--wiki` / `--public` instead of
      # `--visibility <x>`.
      --private)    visibility="private"; shift ;;
      --wiki)       visibility="wiki"; shift ;;
      --public)     visibility="public"; shift ;;
      --expires)    expires="$2"; shift 2 ;;
      -*)           die "unknown flag: $1" ;;
      *)            [ -z "$file" ] && file="$1" || die "unexpected arg: $1"; shift ;;
    esac
  done
  [ -n "$file" ] || die "publish needs a file path."
  [ -f "$file" ] || die "no such file: $file"
  if [ -n "$visibility" ]; then
    case "$visibility" in private|wiki|public) ;; *) die "visibility must be private|wiki|public" ;; esac
  fi

  # curl guesses application/octet-stream for .md/.html, which the API
  # rejects (it only accepts text/html|markdown|plain). Set the type
  # explicitly from the extension.
  local mime
  case "$file" in
    *.html|*.htm)     mime="text/html" ;;
    *.md|*.markdown)  mime="text/markdown" ;;
    *.txt|*)          mime="text/plain" ;;
  esac

  local args=(-sS -X POST "$API_BASE/artifacts"
              -H "Authorization: Bearer $WIKI_TOKEN"
              -F "file=@${file};type=${mime}")
  [ -n "$name" ]       && args+=(-F "name=${name}")
  [ -n "$visibility" ] && args+=(-F "visibility=${visibility}")
  # The API expects an ISO-8601 timestamp; expand a bare date to end-of-day UTC.
  [ -n "$expires" ]    && args+=(-F "expires_at=${expires}T23:59:59Z")

  local resp; resp="$(curl "${args[@]}")" || die "request failed"
  local url; url="$(json_field url "$resp")"
  [ -n "$url" ] || die "publish failed: $resp"
  echo "$url"
}

cmd_list() {
  require_token
  local limit=50
  while [ $# -gt 0 ]; do
    case "$1" in
      --limit) limit="$2"; shift 2 ;;
      *)       die "unknown arg: $1" ;;
    esac
  done

  local resp
  resp="$(curl -sS "$API_BASE/artifacts?limit=${limit}&offset=0" \
           -H "Authorization: Bearer $WIKI_TOKEN")" || die "request failed"

  if [ "$HAS_JQ" = "1" ]; then
    local total; total="$(printf '%s' "$resp" | jq -r '.total')"
    printf '%-12s  %-9s  %-3s  %s\n' "SHORT_ID" "VIS" "VER" "NAME"
    printf '%s' "$resp" | jq -r \
      '.items[] | [.short_id, .visibility, ("v"+(.current_version|tostring)), .name] | @tsv' \
      | while IFS=$'\t' read -r sid vis ver name; do
          printf '%-12s  %-9s  %-3s  %s\n' "$sid" "$vis" "$ver" "$name"
        done
    echo "($total total)"
  else
    # No jq — emit the raw JSON so the caller can still parse it.
    printf '%s\n' "$resp"
  fi
}

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    publish) cmd_publish "$@" ;;
    list)    cmd_list "$@" ;;
    ""|-h|--help|help) usage ;;
    *)       die "unknown command: $sub (try: publish, list)" ;;
  esac
}

main "$@"
