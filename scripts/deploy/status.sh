#!/usr/bin/env bash
# status.sh — READ-ONLY: show the service's current traffic split, revisions,
# and which image SHA each revision serves. Safe to run any time; this is the
# tool that tells you the <revision> names the other scripts need.
#
# Usage:
#   scripts/deploy/status.sh
#
# Env overrides: SERVICE (studio), REGION (europe-west1), PROJECT.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

parse_common_args "$@"
# Read-only — always execute regardless of --execute.
EXECUTE=1

if ! command -v gcloud >/dev/null 2>&1; then
  err "gcloud CLI not found."
  exit 1
fi

banner "Status: ${SERVICE}"

say "Current traffic split:"
run gcloud run services describe "$SERVICE" \
  "${GCLOUD_COMMON[@]}" \
  --format 'table(status.traffic.revisionName, status.traffic.percent, status.traffic.tag, status.traffic.url)'

say ""
say "Recent revisions (newest first):"
run gcloud run revisions list \
  --service "$SERVICE" \
  "${GCLOUD_COMMON[@]}" \
  --limit 10 \
  --format 'table(metadata.name, status.imageDigest.scope(studio), metadata.creationTimestamp, status.conditions[0].status)'
