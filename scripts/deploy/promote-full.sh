#!/usr/bin/env bash
# promote-full.sh — route 100% of traffic to a canary-validated revision.
#
# Usage:
#   scripts/deploy/promote-full.sh <revision> [--execute]
#
#   <revision>  Full Cloud Run revision name (e.g. studio-00042-abc).
#               Find it with scripts/deploy/status.sh.
#   --execute   Actually run the command (DRY-RUN is the default).
#
# Env overrides: SERVICE (studio), REGION (europe-west1), PROJECT.
#
# NO rebuild — the same image that served the canary serves production.
# Keep the previous revision around: it is your one-step rollback target.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

parse_common_args "$@"

if [ "${#POSITIONAL[@]}" -ne 1 ]; then
  err "Expected exactly one argument: <revision>."
  usage
  exit 2
fi

REVISION="${POSITIONAL[0]}"
validate_revision_name "$REVISION"
require_gcloud

banner "Promote to 100%: ${REVISION}"

say "Plan:"
note "1. Route 100% of live traffic to ${REVISION}."
note "2. Previous revision(s) keep running at 0% — instant rollback targets."
say ""

run gcloud run services update-traffic "$SERVICE" \
  "${GCLOUD_COMMON[@]}" \
  --to-revisions "${REVISION}=100"

post_change_monitoring_hint
say ""
say "Record the release: note '${REVISION}' as the new known-good revision"
say "(docs/DEPLOYMENT.md → release log). Rollback, if ever needed:"
note "scripts/deploy/rollback.sh <previous-known-good> --execute"

if [ "$EXECUTE" -eq 0 ]; then
  say ""
  say "(dry-run: traffic was NOT changed — re-run with --execute)"
fi
