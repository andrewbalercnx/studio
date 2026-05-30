#!/usr/bin/env bash
# Sets the GitHub Actions secret and variable required by system-tests.yml.
# Run once after cloning. Requires `gh` CLI authenticated to the repo.
#
# Usage:
#   INTERNAL_API_SECRET=<value> ./scripts/setup-github-secrets.sh
#
# The INTERNAL_API_SECRET value is the same one stored in Google Cloud Secret
# Manager under the name INTERNAL_API_SECRET (used by apphosting.yaml).

set -euo pipefail

REPO="andrewbalercnx/studio"
APP_URL="https://storypic.rcnx.io"

# ── Preflight ──────────────────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  echo "ERROR: INTERNAL_API_SECRET env var is not set." >&2
  echo "  Run: INTERNAL_API_SECRET=<value> $0" >&2
  exit 1
fi

# ── Secret ────────────────────────────────────────────────────────────────────

echo "Setting Actions secret: INTERNAL_API_SECRET ..."
echo -n "$INTERNAL_API_SECRET" \
  | gh secret set INTERNAL_API_SECRET --repo "$REPO" --body -
echo "  ✓ INTERNAL_API_SECRET set"

# ── Variable ──────────────────────────────────────────────────────────────────

echo "Setting Actions variable: APP_URL = $APP_URL ..."
gh variable set APP_URL --repo "$REPO" --body "$APP_URL"
echo "  ✓ APP_URL set"

echo ""
echo "Done. The system-tests workflow is ready to run."
echo "Trigger manually: gh workflow run system-tests.yml --repo $REPO"
