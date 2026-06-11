#!/usr/bin/env bash
# canary-promote.sh — send a percentage of live traffic to a revision
# (stepwise canary: 5 → 25 → 50 → promote-full.sh).
#
# Usage:
#   scripts/deploy/canary-promote.sh <revision> <percent> [--execute]
#
#   <revision>  Full Cloud Run revision name (e.g. studio-00042-abc).
#               Find it with scripts/deploy/status.sh.
#   <percent>   Integer 1-100 — traffic share for the canary revision.
#   --execute   Actually run the command (DRY-RUN is the default).
#
# Env overrides: SERVICE (studio), REGION (europe-west1), PROJECT.
#
# Remaining traffic stays with the currently-serving revision(s),
# redistributed proportionally by Cloud Run. NO rebuild happens — this only
# re-routes traffic between existing revisions.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

parse_common_args "$@"

if [ "${#POSITIONAL[@]}" -ne 2 ]; then
  err "Expected exactly two arguments: <revision> <percent>."
  usage
  exit 2
fi

REVISION="${POSITIONAL[0]}"
PERCENT="${POSITIONAL[1]}"

validate_revision_name "$REVISION"
validate_percent "$PERCENT"
require_gcloud

banner "Canary: route ${PERCENT}% of traffic to ${REVISION}"

say "Plan:"
note "1. Set ${REVISION} to receive ${PERCENT}% of live traffic."
note "2. The remaining $((100 - PERCENT))% stays on the current revision(s) (proportional)."
note "3. No image is built or deployed — traffic routing only."
say ""

run gcloud run services update-traffic "$SERVICE" \
  "${GCLOUD_COMMON[@]}" \
  --to-revisions "${REVISION}=${PERCENT}"

post_change_monitoring_hint
say ""
say "If healthy after 30-60 min: increase % (re-run me) or promote:"
note "scripts/deploy/promote-full.sh ${REVISION} --execute"
say "If NOT healthy: roll back in one step:"
note "scripts/deploy/rollback.sh <known-good-revision> --execute"

if [ "$EXECUTE" -eq 0 ]; then
  say ""
  say "(dry-run: traffic was NOT changed — re-run with --execute)"
fi
