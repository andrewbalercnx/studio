# shellcheck shell=bash
# Shared helpers for the staged-rollout scripts (Sprint W3-B).
# Sourced by deploy-staging.sh / canary-promote.sh / promote-full.sh /
# rollback.sh / status.sh — not executable on its own.
#
# Safety model:
# - DRY-RUN BY DEFAULT. Every script prints exactly the gcloud commands it
#   would run and exits. Nothing mutates until you pass --execute.
# - Targets are explicit and overridable via env:
#     SERVICE (default: studio)   REGION (default: europe-west1)
#     PROJECT (default: gcloud config / GOOGLE_CLOUD_PROJECT)
# See docs/DEPLOYMENT.md for the full release workflow.

set -euo pipefail

SERVICE="${SERVICE:-studio}"
REGION="${REGION:-europe-west1}"
PROJECT="${PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"

EXECUTE=0

# ── Output helpers ──────────────────────────────────────────────────────────

say()  { printf '%s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
err()  { printf 'ERROR: %s\n' "$*" >&2; }

banner() {
  say ""
  say "════════════════════════════════════════════════════════════════════"
  say "  $1"
  say "════════════════════════════════════════════════════════════════════"
  say "  service: ${SERVICE}   region: ${REGION}   project: ${PROJECT:-<gcloud default>}"
  if [ "$EXECUTE" -eq 1 ]; then
    say "  mode:    EXECUTE — commands below WILL run"
  else
    say "  mode:    DRY-RUN (default) — printing commands only; add --execute to act"
  fi
  say "════════════════════════════════════════════════════════════════════"
  say ""
}

# Print a command, and run it only in --execute mode.
run() {
  say "+ $*"
  if [ "$EXECUTE" -eq 1 ]; then
    "$@"
  fi
}

# ── Argument parsing ────────────────────────────────────────────────────────

# Consumes --execute / -h / --help; leaves positional args in POSITIONAL.
POSITIONAL=()
parse_common_args() {
  for arg in "$@"; do
    case "$arg" in
      --execute) EXECUTE=1 ;;
      -h|--help) usage; exit 0 ;;
      --*) err "Unknown option: $arg"; usage; exit 2 ;;
      *) POSITIONAL+=("$arg") ;;
    esac
  done
}

require_gcloud() {
  if [ "$EXECUTE" -eq 1 ] && ! command -v gcloud >/dev/null 2>&1; then
    err "gcloud CLI not found — required for --execute mode."
    exit 1
  fi
}

project_flag() {
  if [ -n "$PROJECT" ]; then printf -- '--project=%s' "$PROJECT"; fi
}

# gcloud args common to every command in these scripts.
GCLOUD_COMMON=(--region "$REGION" --platform managed)
gcloud_common_with_project() {
  GCLOUD_COMMON=(--region "$REGION" --platform managed)
  if [ -n "$PROJECT" ]; then
    GCLOUD_COMMON+=(--project "$PROJECT")
  fi
}
gcloud_common_with_project

# ── Validation helpers ──────────────────────────────────────────────────────

validate_percent() {
  case "$1" in
    ''|*[!0-9]*) err "Percent must be an integer 1-100, got: '$1'"; exit 2 ;;
  esac
  if [ "$1" -lt 1 ] || [ "$1" -gt 100 ]; then
    err "Percent must be between 1 and 100, got: $1"
    exit 2
  fi
}

validate_revision_name() {
  case "$1" in
    "$SERVICE"-*) : ;;
    *)
      err "Revision '$1' does not look like a revision of service '$SERVICE' (expected '${SERVICE}-…')."
      note "List revisions with: scripts/deploy/status.sh"
      exit 2
      ;;
  esac
}

post_change_monitoring_hint() {
  say ""
  say "Watch the canary/rollout (docs/DEPLOYMENT.md → 'What to watch'):"
  note "health:   curl -fsS https://<service-host>/api/health | jq"
  note "traffic:  scripts/deploy/status.sh"
  note "metrics:  Cloud Run → ${SERVICE} → Metrics (5xx rate, latency, by revision)"
  note "logs:     gcloud logging read 'resource.labels.service_name=\"${SERVICE}\" severity>=ERROR' --freshness=15m"
}
