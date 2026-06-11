# Deployment Runbook — Staged Rollout, Feature Flags, Rollback

> **Last Updated**: 2026-06-11 (Sprint W3-B)
>
> This document supersedes `docs/DEPLOYMENT_ROLLOUT.md` (the original design
> sketch). It covers: what deploys today, the staged-rollout machinery this
> repo now ships, the one-time owner enablement steps, the routine release
> workflow, and the rollback-in-anger one-pager.

---

## 1. Current deploy reality (as of W3-B)

**What actually happens on push to `main` today:**

| Path | Trigger | Status |
|------|---------|--------|
| **Firebase App Hosting** | GitHub connection on the App Hosting backend; every push to `main` auto-builds and rolls out to **100% immediately** | **LIVE** — this is production (`storypic.rcnx.io`). `apphosting.yaml` configures it; the CLAUDE.md "single-push commit" workflow exists to avoid double builds here |
| `cloudbuild.yaml` (Cloud Run service `studio`, europe-west1) | Comment claims "push to main", but trigger status is **not verifiable from the repo** | **Legacy / presumed stale** — its `--set-secrets` list is missing 8 secrets that `apphosting.yaml` mounts (MIXAM_WEBHOOK_*, AZURE_*, GETADDRESS_API_KEY, INTERNAL_API_SECRET, FAL_KEY), so a deploy from it would produce a broken service. **Do not attach a trigger to it.** Owner: verify under Cloud Build → Triggers and delete/disable any trigger pointing at it (enablement step E1) |
| `.github/workflows/ci.yml` | push/PR to `main` | Tests only (typecheck, unit, E2E gate) — no deploy |

There is **no `firebase.json` hosting config** — the domain is attached to the
App Hosting backend, so Firebase Hosting preview channels are not applicable
(zero-traffic tagged Cloud Run revisions fill that role instead, §4.2).

**The problem**: App Hosting gives no build-once artifact, no staging step, no
canary, and rollback means another full rebuild. The machinery below replaces
it with plain Cloud Run + traffic splitting — but **nothing changes until the
owner performs the enablement steps in §3**. Everything committed by W3-B is
opt-in (`workflow_dispatch`, untriggered Cloud Build config, dry-run-default
scripts) except the pure additions (`/api/health`, `/api/flags`).

---

## 2. Target architecture

```
merge to main ──► ci.yml (tests, as today)
                       │ (manual, owner-initiated)
                       ▼
        GitHub Actions "Release (build-once)"  (workflow_dispatch)
        gates: typecheck + unit tests + build
                       │
                       ▼
        Cloud Build (cloudbuild.release.yaml)
        ONE immutable image  gcr.io/<project>/studio:<COMMIT_SHA>
                       │
                       ▼
        Cloud Run revision, --no-traffic, tag rc-<sha7>   ← staging
                       │  smoke test https://rc-<sha7>---<host>/api/health
                       ▼
        canary-promote.sh <revision> 5     (5% traffic)
                       │  watch /api/health, metrics, errors (30–60 min)
                       ▼
        canary-promote.sh <revision> 25 … 50
                       │
                       ▼
        promote-full.sh <revision>         (100%, same image — NO rebuild)

        at ANY point: rollback.sh <known-good-revision>   (seconds)
```

Two independent control planes:

1. **Traffic** (Cloud Run revisions) — which *build* serves users.
2. **Feature flags** (Remote Config / `systemConfig/featureFlags`) — which
   *behaviour* is active inside whatever build is serving. A flag flip needs
   no deploy and reverts in seconds (§6).

Key invariant: **the image is built once**, tagged with the commit SHA, and
that same artifact moves staging → canary → 100%. `/api/health` returns the
baked-in SHA (`version`) so you can always prove which build answered.

---

## 3. Owner enablement (one-time) — nothing below happens until you do this

> The repo ships the machinery but does not change live behaviour. Work
> through these in order; production stays on App Hosting until E6.

**E1 — Neutralise the legacy Cloud Build config.**
Console → Cloud Build → Triggers (project `storypic`, all regions): if any
trigger points at `cloudbuild.yaml`, disable or delete it. That file's secret
list is stale; it must never deploy again. (Keep the file for reference or
delete it after cutover.)

**E2 — Create the release service account + GitHub secrets.**
```bash
PROJECT_ID=<your-project-id>
gcloud iam service-accounts create gh-release --project "$PROJECT_ID" \
  --display-name "GitHub release pipeline"
for ROLE in roles/cloudbuild.builds.editor roles/viewer roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:gh-release@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role "$ROLE"
done
gcloud iam service-accounts keys create /tmp/gh-release-key.json \
  --iam-account "gh-release@${PROJECT_ID}.iam.gserviceaccount.com"
```
GitHub repo → Settings → Secrets and variables → Actions:
- `GCP_RELEASE_SA_KEY` = contents of `/tmp/gh-release-key.json` (then delete the local file)
- `GCP_PROJECT_ID` = the project id

The **Cloud Build service account** (`<project-number>@cloudbuild.gserviceaccount.com`)
additionally needs `roles/run.admin` and `roles/iam.serviceAccountUser` (to
deploy Cloud Run) — it already has them if `cloudbuild.yaml` ever deployed.
The **Cloud Run runtime service account** needs `roles/secretmanager.secretAccessor`
on each referenced secret (already true if the `studio` service ever ran).

*Hardening follow-up*: replace the JSON key with Workload Identity Federation.

**E3 — First build-once release (parallel-safe, App Hosting still live).**
GitHub → Actions → "Release (build-once)" → Run workflow (`deploy_staging: true`).
This builds the image and creates a **zero-traffic** revision of the `studio`
Cloud Run service — production traffic (App Hosting) is untouched.

**E4 — Smoke-test staging.**
```bash
scripts/deploy/status.sh                      # find the rc-<sha7> tag URL
curl -fsS https://rc-<sha7>---<service-host>/api/health | jq
# expect: status=ok, version=<sha>, checks.firestore.ok=true
```
Click through login + one story flow on the tagged URL.

**E5 — Dress-rehearse the canary on the `studio` service** (it has no real
traffic yet, so this is free practice):
```bash
scripts/deploy/canary-promote.sh studio-<rev> 5 --execute
scripts/deploy/promote-full.sh   studio-<rev> --execute
scripts/deploy/rollback.sh       studio-<prev-rev> --execute
```

**E6 — Cut the domain over (the actual go-live for the new pipeline).**
1. Map the domain to the Cloud Run service: Cloud Run → `studio` → Manage
   custom domains → add `storypic.rcnx.io` (or use a load balancer), update
   DNS as instructed. Wait for cert provisioning; verify
   `curl https://storypic.rcnx.io/api/health` shows the expected `version`.
2. **Disable App Hosting auto-deploy**: Firebase console → App Hosting →
   your backend → Settings → **disable automatic rollouts** (or disconnect
   the GitHub branch). Optionally delete the backend after a soak period.
3. From this point: merging to `main` runs tests only; releases are the §4
   workflow. Update CLAUDE.md's git workflow note (the "two Firebase builds"
   constraint disappears).

**E7 — (Optional) seed the flag fallback doc.** Create Firestore doc
`systemConfig/featureFlags` (admin SDK or console) with e.g.
`{ health_verbose: true }`. Not required — in-code defaults apply without it.

---

## 4. Routine release workflow (after enablement)

### 4.1 Ship a release

1. **Merge to `main`** — `ci.yml` must be green (typecheck, unit, funnel E2E).
2. **Build once**: Actions → "Release (build-once)" → Run workflow.
   Produces `gcr.io/<project>/studio:<COMMIT_SHA>` + zero-traffic revision
   `rc-<sha7>`. (Local alternative: `gcloud builds submit --config
   cloudbuild.release.yaml --substitutions _RELEASE_SHA=$(git rev-parse HEAD)`.)
3. **Staging smoke** on the tagged URL (`/api/health`, login, one core flow).
4. **Canary 5%**: `scripts/deploy/canary-promote.sh <revision> 5 --execute`.
5. **Watch for 30–60 min** (§5). Healthy → step up: `… 25 --execute`, then
   `… 50 --execute` for bigger changes; small changes can go 5 → 100.
6. **Promote**: `scripts/deploy/promote-full.sh <revision> --execute`.
7. **Record** the new known-good revision name (release log below, or a
   pinned note) — it is the next release's rollback target.

All scripts are **dry-run by default**: run them once without `--execute` to
see exactly what they will do. `scripts/deploy/status.sh` is read-only and
shows the live traffic split + revision names.

### 4.2 Feature-branch QA (replaces "preview channels")

There is no Firebase Hosting, so preview channels don't apply. For branch QA:
build the branch with the same Cloud Build config (`_DEPLOY_STAGING=true`,
`_RELEASE_SHA=$(git rev-parse <branch>)`) — you get a zero-traffic tagged
revision URL to share, with zero production impact. Delete stale rc- tags
occasionally: `gcloud run services update-traffic studio --remove-tags rc-<sha7>`.

### 4.3 Release log

| Date | SHA | Revision | Notes |
|------|-----|----------|-------|
| _(append on each promote-full)_ | | | |

---

## 5. What to watch during a canary

| Signal | Where | Healthy looks like |
|--------|-------|--------------------|
| **Health endpoint** | `curl -fsS https://<host>/api/health` (hits revisions per traffic split; loop it) and the rc- tag URL (hits the canary directly) | `status: ok`, HTTP 200, `checks.firestore.ok: true`, sane `latencyMs`; `version` confirms which build answered. `503/degraded` = dependency probe failing |
| **5xx rate by revision** | Cloud Run → `studio` → Metrics → Request count, group by revision | Canary's 5xx ratio ≤ stable revision's |
| **Latency by revision** | same, p50/p95 | No step-change vs stable |
| **Error logs** | `gcloud logging read 'resource.labels.service_name="studio" severity>=ERROR' --freshness=30m` | No new error signatures from the canary revision |
| **App errors / funnel** | PostHog (EU) once analytics flag is on; `aiFlowLogs` failures in admin | No spike correlated with canary start |
| **Container health** | Cloud Run → Metrics → instance count, memory | No restart churn / OOM on the canary |

**Decision rule**: any sustained 5xx increase, `degraded` health, or new
error signature on the canary → **roll back first, diagnose after** (§7).

---

## 6. Feature flags

### How it works

- **Registry**: `src/lib/feature-flags.ts` — `FLAG_DEFAULTS` (key + in-code
  default). Adding a flag = adding one line there.
- **Server**: `getFeatureFlag(key, {uid, email})` /
  `getAllFeatureFlags(ctx)` from `src/lib/feature-flags.server.ts`.
- **Client**: `useFeatureFlag(key)` from `src/hooks/use-feature-flag.ts` —
  calls `GET /api/flags`, which evaluates **on the server** (server-first
  rule; no Remote Config SDK in the client bundle).
- **Precedence** (highest wins), with every layer failing open to the next:
  1. Env override `FLAG_<KEY_UPPERCASED>=true|false` (ops escape hatch)
  2. **Firebase Remote Config** (server template; only explicitly-set remote
     parameters count)
  3. Firestore **`systemConfig/featureFlags`** doc (field per flag) — works
     before Remote Config is set up, editable from the Firestore console
  4. In-code default in `FLAG_DEFAULTS`
- Caches: RC template 60s, systemConfig doc 30s per instance → a flag flip
  reaches all instances within ~1 minute, no deploy.

### Remote Config condition recipes (Firebase console → Remote Config)

Create a **parameter** named exactly like the flag key (e.g.
`health_verbose`), type Boolean, default = the in-code default. Then add
conditional values. The server passes these signals when evaluating:
`randomizationId` = user UID, plus **custom signals** `uid` and `emailDomain`.

| Pattern | Condition (console) |
|---------|---------------------|
| **Staff first** (email domain) | Custom signal `emailDomain` == `rcnx.io` → `true` |
| **UID allowlist** | Custom signal `uid` in `[<uid1>, <uid2>]` → `true` |
| **Percentage rollout** | "User in random percentile" ≤ 10% → `true` (uses `randomizationId`; sticky per UID. Anonymous requests have no randomization id and resolve to the default — i.e. percentage rollouts only apply to signed-in users) |
| **Kill switch** | Set the parameter's default value to `false`, remove conditions, **Publish** |

Worked example shipped with W3-B: **`health_verbose`** — set it to `false`
(any layer) and `GET /api/health` switches to the minimal `{status, version}`
body and skips the Firestore probe; set `true` (or remove) to restore. Proves
"a flag disables a feature in production without a deploy", and doubles as a
probe load-shed switch.

### Rules of thumb

- Ship risky features **dark** (flag default `false`), enable for
  staff/allowlist on the canary, then percentage, then default `true`,
  then delete the flag (registry stays small).
- Flags are **not secrets** and **not authorization** — never gate sensitive
  data on a flag alone.

---

## 7. ROLLBACK IN ANGER — one-pager

> Production is broken after a release. Do this, in this order.

**0. Is it a *flagged feature* misbehaving?** → flip the flag instead
(seconds, no traffic change):
- Remote Config console → set parameter to `false` → **Publish**, or
- Firestore `systemConfig/featureFlags` → set `<flag>: false`.
Propagates within ~1 min (cache TTL). Done — diagnose at leisure.

**1. Find the known-good revision** (the one serving before the release):
```bash
scripts/deploy/status.sh        # revisions + traffic; previous 100% holder
```

**2. Route everything back** (no rebuild — seconds):
```bash
scripts/deploy/rollback.sh studio-<known-good> --execute
```

**3. Verify**:
```bash
curl -fsS https://<host>/api/health | jq '.version'    # must show the OLD sha
```
Watch the 5xx rate drop in Cloud Run metrics.

**4. Afterwards**: keep the bad revision at 0% for diagnosis; write up; fix
forward via a fresh release (never patch a revision in place).

**If the rollback target itself is gone** (revision deleted): redeploy the
last good *image* — `scripts/deploy/deploy-staging.sh <good-sha> --execute`,
then `promote-full.sh` the new revision. Still no rebuild — images are
immutable and tagged by SHA.

**Pre-enablement fallback** (still on App Hosting): Firebase console → App
Hosting → backend → Rollouts → re-deploy the previous successful rollout, or
`git revert` + push (rebuild, ~minutes — exactly why this runbook exists).

---

## 8. File map

| File | Role | Active when |
|------|------|-------------|
| `.github/workflows/release.yml` | Build-once release pipeline (gates → Cloud Build) | Manual (`workflow_dispatch`) only |
| `cloudbuild.release.yaml` | Gates → immutable image `:<SHA>` → zero-traffic staging revision | Only when submitted (no trigger) |
| `cloudbuild.yaml` | **Legacy** — stale secrets; do not trigger | Never (verify, E1) |
| `apphosting.yaml` | Current production (App Hosting) config | Until cutover (E6) |
| `scripts/deploy/status.sh` | Read-only traffic/revision view | Always safe |
| `scripts/deploy/deploy-staging.sh` | Zero-traffic revision from an existing image | Dry-run default |
| `scripts/deploy/canary-promote.sh` | Stepwise canary traffic % | Dry-run default |
| `scripts/deploy/promote-full.sh` | 100% to validated revision | Dry-run default |
| `scripts/deploy/rollback.sh` | 100% back to known-good revision | Dry-run default |
| `src/app/api/health/route.ts` | Version/uptime/dependency probe | Live now (pure addition) |
| `src/app/api/flags/route.ts` | Server-evaluated flags for clients | Live now (pure addition) |
| `src/lib/feature-flags{,.server}.ts`, `src/hooks/use-feature-flag.ts` | Flag registry, evaluation, client hook | Live now |
