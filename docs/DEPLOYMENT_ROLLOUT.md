# Selective Deployment & Rollback Strategy

This replaces the single "push → auto deploy" flow with a staged rollout that lets us ship to small user groups first and roll back safely.

## Goals
- Ship behind flags to selected users (allowlists or % rollouts).
- Promote builds progressively (0% → canary → full) without rebuilding.
- Revert quickly to a known-good revision or disable a flag.

## Components
- **Artifact**: Docker image built by Cloud Build (`gcr.io/$PROJECT_ID/studio:$COMMIT_SHA`).
- **Runtime**: Cloud Run (deployed via App Hosting/`apphosting.yaml`).
- **Routing**: Cloud Run traffic splitting; Firebase Hosting rewrites already point to the service.
- **Flags**: Firebase Remote Config (conditions: user UID/email domain/app version/percentage).
- **Monitoring**: Cloud Run metrics + logs; app-level health endpoint recommended.

## Environments & Channels
- **Staging**: Deploy new revision with `--no-traffic` for smoke tests. Can live in the same project (revision only) or a sibling Firebase project if isolation is required.
- **Canary**: Same Cloud Run service; allocate small traffic % to the new revision.
- **Production**: 100% traffic once canary is clean.
- **Preview (optional)**: `firebase hosting:channel:deploy feature-x --expires 7d` for QA on feature branches (uses the staging image).

## Release Workflow
1) **Build once** (CI)
   - On merge to `main`, run tests/typecheck/build, then push image tagged with `$COMMIT_SHA` and `:latest`.
   - Store `$COMMIT_SHA` as the release candidate (RC).
2) **Deploy RC to staging, zero-traffic**
   - `gcloud run deploy studio --image gcr.io/$PROJECT_ID/studio:$COMMIT_SHA --region ${_DEPLOY_REGION} --no-traffic`.
   - Run smoke tests + health check on the new revision URL.
3) **Canary**
   - Send a slice of traffic to the new revision: `gcloud run services update-traffic studio --region ${_DEPLOY_REGION} --to-revisions RC=5,previous=95`.
   - Monitor errors/latency for ~30–60 minutes; increase to 25–50% if healthy.
4) **Promote to 100%**
   - `gcloud run services update-traffic studio --region ${_DEPLOY_REGION} --to-revisions RC=100`.
5) **Finalize**
   - Mark the revision as prod; keep at least one prior healthy revision for rollback.

## Feature-Flag Rollouts (user-selective)
Use Firebase Remote Config to gate new functionality without deploys.

1) Define a flag in Remote Config, e.g. `feature_story_builder` default `false`.
2) Add conditions:
   - **Allowlist**: match `user.uid` in a list or `email` domain.
   - **Percent rollout**: randomize by `user.id % 100 < 10` (10%) using the built-in percentage condition.
3) Fetch and cache Remote Config in the app; gate code paths on the flag.

Example (client/server shared):
```ts
// flag.ts
export function isStoryBuilderEnabled(flags: Record<string, boolean | string>): boolean {
  return flags['feature_story_builder'] === true;
}
```

Rollback path for flags: flip condition to 0% or default `false` — no deployment needed.

## Rollback Playbook
- **Rapid rollback (traffic)**: `gcloud run services update-traffic studio --region ${_DEPLOY_REGION} --to-revisions previous=100` to send all traffic back to the last stable revision.
- **Flag rollback**: set the Remote Config flag to `false` or remove allowlists; publish changes (takes effect within RC cache TTL).
- **Full revert**: deploy the previous known-good image tag: `gcloud run deploy studio --image gcr.io/$PROJECT_ID/studio:<good_sha> --region ${_DEPLOY_REGION} --no-traffic` then shift traffic to it.

## CI/CD Adjustments
- Add a manual/approval step after build to deploy the RC to staging with `--no-traffic`.
- Add scripts/targets:
  - `npm run release:deploy -- <commit_sha>` → deploy image with no traffic.
  - `npm run release:canary -- <revision> <percent>` → update traffic split.
  - `npm run release:promote -- <revision>` → move to 100%.
- Emit release metadata (image tag, revision, git sha) for traceability.

## Operational Checklist
- Health endpoint responding before shifting traffic.
- Error budget/alerts on Cloud Run metrics during canary.
- Secrets present for the new revision (App Hosting already mounts from Secret Manager).
- Keep an allowlist flag for staff accounts to verify features before wide rollout.

This flow keeps deploys low-risk: new code is exercised first by staff/testers via flags, then by a small % of production traffic, with a single-command rollback available at either the traffic or flag layer.
