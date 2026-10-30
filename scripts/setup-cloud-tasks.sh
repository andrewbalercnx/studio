#!/usr/bin/env bash
#
# Set up Cloud Tasks for the server-side job runner (ADR-0002, src/server/jobs).
# Idempotent: safe to run again; it creates what is missing and updates queue
# settings in place. Needs gcloud, logged in as a project owner (or with the
# Cloud Tasks Admin, Service Account Admin, Project IAM Admin and Cloud Run
# Admin roles).
#
#   scripts/setup-cloud-tasks.sh                 # defaults below
#   BACKEND_ID=studio-1 REGION=europe-west1 scripts/setup-cloud-tasks.sh
#   DRY_RUN=1 scripts/setup-cloud-tasks.sh       # print the commands only
#
# What it does:
#   1. enables the Cloud Tasks API;
#   2. creates the queues ai-text, ai-image, tts, render, mixam (with an
#      optional prefix) with rate limits under each provider's quota;
#   3. creates the invoker service account whose OIDC token the job route
#      (/api/internal/jobs/run) accepts;
#   4. lets the app's runtime service account create tasks and mint tokens
#      as the invoker; lets the invoker call the App Hosting Cloud Run service;
#   5. prints the apphosting.yaml env values.
#
# Queue retries are kept short: the job runner retries failed work itself with
# its own backoff (new task per attempt). Queue retries only cover delivery:
# a 409 LEASE_HELD (another runner holds the job; leases last 6 minutes) or a
# 5xx before the runner recorded anything. Backoff 30 s → 10 min over 5
# attempts outlasts one lease.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-studio-6508342045-13669}"         # .firebaserc default project
REGION="${REGION:-europe-west1}"                             # Cloud Tasks location (JOBS_TASKS_LOCATION); no europe-west4
BACKEND_ID="${BACKEND_ID:-studio-1}"                         # App Hosting backend id = its Cloud Run service name
BACKEND_REGION="${BACKEND_REGION:-europe-west4}"             # region of the App Hosting backend
APP_URL="${APP_URL:-https://storypic.rcnx.io}"               # public URL the tasks call
QUEUE_PREFIX="${QUEUE_PREFIX:-}"                             # JOBS_QUEUE_PREFIX, e.g. "storypic-"
INVOKER_SA_NAME="${INVOKER_SA_NAME:-storypic-jobs-invoker}"
RUNTIME_SA="${RUNTIME_SA:-firebase-app-hosting-compute@${PROJECT_ID}.iam.gserviceaccount.com}"
DRY_RUN="${DRY_RUN:-}"

INVOKER_SA="${INVOKER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_URL="${APP_URL%/}/api/internal/jobs/run"

run() {
  echo "+ $*"
  if [[ -z "$DRY_RUN" ]]; then "$@"; fi
}

exists() {
  # Quietly test whether a describe command succeeds (always "no" in a dry run).
  [[ -z "$DRY_RUN" ]] && "$@" >/dev/null 2>&1
}

echo "Project:  $PROJECT_ID"
echo "Queues:   $REGION (prefix '${QUEUE_PREFIX}')"
echo "Run URL:  $RUN_URL"
echo "Invoker:  $INVOKER_SA"
echo "Runtime:  $RUNTIME_SA"
echo

# 1. API ----------------------------------------------------------------------
run gcloud services enable cloudtasks.googleapis.com --project="$PROJECT_ID"

# 2. Queues -------------------------------------------------------------------
# name  max-dispatches/s  max-concurrent
QUEUES=(
  "ai-text  5  10"   # Gemini text: pagination (one call per Manuscript)
  "ai-image 1  5"    # Gemini image: cast sheets and page art (tightest quota)
  "tts      2  3"    # ElevenLabs: 5 concurrent allowed; leave room for on-demand TTS
  "render   2  5"    # coordinators now; PDF renders in the print slice
  "mixam    1  2"    # print orders (print slice)
)
RETRY_FLAGS=(--max-attempts=5 --min-backoff=30s --max-backoff=600s --max-doublings=4)

for spec in "${QUEUES[@]}"; do
  read -r name rate concurrent <<<"$spec"
  queue="${QUEUE_PREFIX}${name}"
  if exists gcloud tasks queues describe "$queue" --location="$REGION" --project="$PROJECT_ID"; then
    run gcloud tasks queues update "$queue" --location="$REGION" --project="$PROJECT_ID" \
      --max-dispatches-per-second="$rate" --max-concurrent-dispatches="$concurrent" "${RETRY_FLAGS[@]}"
  else
    run gcloud tasks queues create "$queue" --location="$REGION" --project="$PROJECT_ID" \
      --max-dispatches-per-second="$rate" --max-concurrent-dispatches="$concurrent" "${RETRY_FLAGS[@]}"
  fi
done

# 3. Invoker service account ----------------------------------------------------
if ! exists gcloud iam service-accounts describe "$INVOKER_SA" --project="$PROJECT_ID"; then
  run gcloud iam service-accounts create "$INVOKER_SA_NAME" --project="$PROJECT_ID" \
    --display-name="StoryPic job runner invoker (Cloud Tasks OIDC)"
fi

# 4. IAM ------------------------------------------------------------------------
# The app (runtime SA) creates tasks…
run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/cloudtasks.enqueuer" --condition=None --quiet --format=none
# …whose OIDC token is minted for the invoker, which needs actAs on it.
run gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role="roles/iam.serviceAccountUser" --quiet --format=none

# Cloud Tasks' service agent mints the token (needed on projects created before 2019; harmless otherwise).
if [[ -z "$DRY_RUN" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
else
  PROJECT_NUMBER="PROJECT_NUMBER"
fi
run gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" --project="$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" --quiet --format=none

# The invoker may call the backend's Cloud Run service. (App Hosting services
# usually allow unauthenticated calls; the job route verifies the OIDC token
# itself either way, so this matters only if the service requires IAM.)
if [[ -n "$BACKEND_ID" ]]; then
  run gcloud run services add-iam-policy-binding "$BACKEND_ID" --project="$PROJECT_ID" --region="$BACKEND_REGION" \
    --member="serviceAccount:${INVOKER_SA}" --role="roles/run.invoker" --quiet --format=none
else
  echo "! BACKEND_ID not set: skipped roles/run.invoker on the Cloud Run service."
  echo "  Find it with: gcloud run services list --project=$PROJECT_ID   (App Hosting names it after the backend)"
fi

# 5. Env -------------------------------------------------------------------------
cat <<EOF

Done. These are the values apphosting.yaml must carry (RUNTIME availability):

  JOBS_DISPATCHER=cloud-tasks
  JOBS_TASKS_PROJECT=${PROJECT_ID}
  JOBS_TASKS_LOCATION=${REGION}
  JOBS_RUN_URL=${RUN_URL}
  JOBS_INVOKER_SERVICE_ACCOUNT=${INVOKER_SA}
  JOBS_QUEUE_PREFIX=${QUEUE_PREFIX}
  # JOBS_OIDC_AUDIENCE defaults to JOBS_RUN_URL

Check a queue:  gcloud tasks queues describe ${QUEUE_PREFIX}ai-image --location=${REGION} --project=${PROJECT_ID}
EOF
