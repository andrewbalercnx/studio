#!/usr/bin/env bash
# rollback.sh — EMERGENCY: route 100% of traffic to a named known-good
# revision. One step, no rebuild, takes effect in seconds.
#
# Usage:
#   scripts/deploy/rollback.sh <known-good-revision> [--execute]
#
#   <known-good-revision>  Full Cloud Run revision name that was previously
#                          serving healthily (e.g. studio-00041-xyz).
#                          Find candidates with scripts/deploy/status.sh.
#   --execute              Actually run the command (DRY-RUN is the default).
#
# Env overrides: SERVICE (studio), REGION (europe-west1), PROJECT.
#
# See docs/DEPLOYMENT.md → "Rollback in anger" for the full one-pager
# (including the feature-flag kill switch, which is faster when the problem
# is a flagged feature rather than the build).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

parse_common_args "$@"

if [ "${#POSITIONAL[@]}" -ne 1 ]; then
  err "Expected exactly one argument: <known-good-revision>."
  usage
  exit 2
fi

REVISION="${POSITIONAL[0]}"
validate_revision_name "$REVISION"
require_gcloud

banner "ROLLBACK: route 100% of traffic to ${REVISION}"

say "Plan:"
note "1. Route 100% of live traffic to ${REVISION} immediately."
note "2. The bad revision keeps running at 0% for post-mortem inspection."
note "3. No build, no deploy — routing change only (seconds, not minutes)."
say ""

run gcloud run services update-traffic "$SERVICE" \
  "${GCLOUD_COMMON[@]}" \
  --to-revisions "${REVISION}=100"

say ""
say "Verify the rollback took effect:"
note "curl -fsS https://<service-host>/api/health | jq '.version'   # must be the OLD sha"
note "scripts/deploy/status.sh"

if [ "$EXECUTE" -eq 0 ]; then
  say ""
  say "(dry-run: traffic was NOT changed — re-run with --execute)"
fi
