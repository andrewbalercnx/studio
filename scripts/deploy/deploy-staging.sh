#!/usr/bin/env bash
# deploy-staging.sh — deploy an already-built image as a ZERO-TRAFFIC Cloud
# Run revision, tagged rc-<sha7>, for staging smoke tests.
#
# Usage:
#   scripts/deploy/deploy-staging.sh <commit-sha> [--execute]
#
#   <commit-sha>  Full or short git SHA of an image already pushed by the
#                 build-once pipeline (gcr.io/<project>/studio:<sha>).
#   --execute     Actually run the commands (DRY-RUN is the default).
#
# Env overrides: SERVICE (studio), REGION (europe-west1), PROJECT.
#
# This NEVER moves traffic. Promote with canary-promote.sh afterwards.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

parse_common_args "$@"

if [ "${#POSITIONAL[@]}" -ne 1 ]; then
  err "Expected exactly one argument: the release commit SHA."
  usage
  exit 2
fi

SHA="${POSITIONAL[0]}"
SHA7="${SHA:0:7}"
IMAGE="gcr.io/${PROJECT:-<project>}/studio:${SHA}"

require_gcloud
banner "Deploy staging revision (ZERO traffic) — ${SHA7}"

say "Plan:"
note "1. Deploy image ${IMAGE}"
note "   as a new revision of '${SERVICE}' with --no-traffic and tag 'rc-${SHA7}'."
note "2. The tagged revision gets its own URL for smoke tests; live traffic is untouched."
say ""

if [ "$EXECUTE" -eq 1 ] && [ -z "$PROJECT" ]; then
  PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  if [ -z "$PROJECT" ]; then
    err "No PROJECT set and no gcloud default project configured."
    exit 1
  fi
  IMAGE="gcr.io/${PROJECT}/studio:${SHA}"
  gcloud_common_with_project
fi

run gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  "${GCLOUD_COMMON[@]}" \
  --allow-unauthenticated \
  --no-traffic \
  --tag "rc-${SHA7}" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars 'ENABLE_DEV_LOGS=true' \
  --set-secrets 'GEMINI_API_KEY=GEMINI_API_KEY:latest,ELEVENLABS_API_KEY=ELEVENLABS_API_KEY:latest,FIREBASE_SERVICE_ACCOUNT_KEY=FIREBASE_SERVICE_ACCOUNT_KEY:latest,MIXAM_USERNAME=MIXAM_USERNAME:latest,MIXAM_PASSWORD=MIXAM_PASSWORD:latest,MIXAM_WEBHOOK_URL=MIXAM_WEBHOOK_URL:latest,MIXAM_WEBHOOK_SECRET=MIXAM_WEBHOOK_SECRET:latest,AZURE_TENANT_ID=AZURE_TENANT_ID:latest,AZURE_CLIENT_ID=AZURE_CLIENT_ID:latest,AZURE_CLIENT_SECRET=AZURE_CLIENT_SECRET:latest,GETADDRESS_API_KEY=GETADDRESS_API_KEY:latest,INTERNAL_API_SECRET=INTERNAL_API_SECRET:latest,FAL_KEY=FAL_KEY:latest'

say ""
say "Smoke test (zero-traffic revision URL):"
note "curl -fsS https://rc-${SHA7}---<service-host>/api/health | jq"
note "Expect: status=ok, version=${SHA7}, checks.firestore.ok=true"
say ""
say "Then start the canary:"
note "scripts/deploy/canary-promote.sh ${SERVICE}-<revision-suffix> 5 --execute"

if [ "$EXECUTE" -eq 0 ]; then
  say ""
  say "(dry-run: nothing was deployed — re-run with --execute)"
fi
