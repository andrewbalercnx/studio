# Major Changes Tracker

Use this log to keep the multi-step rollout visible. Update the statuses and checkboxes as we finish each slice.

## 1. Harden Parent PIN Guard (Step 1)

- **Status**: Code complete, QA + regression sign-off still pending.
- **What landed**
  - Session-scoped guard with five-minute auto-lock and PIN modal orchestration (`src/hooks/use-parent-guard.tsx:9`).
  - Shared PIN modal plus parent settings surface for creating/updating hashes (`src/components/parent/pin-form.tsx:24`, `src/app/parent/settings/page.tsx:18`).
  - Secure PIN APIs with salted scrypt hashing in the backend (`src/app/api/parent/set-pin/route.ts:2`, `src/app/api/parent/verify-pin/route.ts:1`).
- **Open actions**
  - [ ] Run the full checklist in `docs/testing/pin-guard.md:5` on the latest build.
  - [ ] Add automated coverage (Smoke Playwright or API tests) for the happy path + lockout timers so regressions are caught early.
  - [ ] Instrument error logging around repeated PIN failures to flag brute-force attempts (can be part of Firebase Functions / logging story).

## 2. Parent / Child Shell Separation (Step 2)

- **Status**: In progress — UX scaffolding exists, but layout/middleware and full QA are outstanding.
- **What landed**
  - Parent-only layout that wraps all `/parent` routes with the guard and nav chrome (`src/app/parent/layout.tsx:1`).
  - Role-aware header + redirect logic so child mode hides parent links and `/stories` bounces to the child shell (`src/components/header.tsx:25`, `src/app/stories/page.tsx:49`).
  - First pass at the child experience that filters sessions per child and forces a PIN when returning to parent mode (`src/app/child/[childId]/page.tsx:1`).
  - App-level context now keeps `{ activeChildId, activeChildProfile, roleMode }` with ownership checks before granting child mode (`src/hooks/use-app-context.tsx:22`).
- **Still needed**
  - [ ] Introduce `src/app/child/[childId]/layout.tsx` so every child route shares the slim chrome + back button described in `docs/architecture/parent-child-shells.md:11`.
  - [ ] Add middleware or server-side guards that verify the signed-in parent owns `childId` before rendering (`docs/architecture/parent-child-shells.md:19`).
  - [ ] Ensure child-facing APIs also re-check `ownerParentUid` and avoid trusting client-provided IDs.
  - [ ] Tighten Firestore rules for characters and other child-owned docs so they match the scoped access already enforced for children and story sessions (`firestore.rules:31`).
  - [ ] Execute the parent/child QA script once the above work lands (`docs/testing/parent-child-shell.md:5`).

## 3. Writer Story Editor Upgrade (Step 3)

- **Status**: Not started — gated on Step 2 completion.
- **Current surface**: Writer dashboard is a thin launcher into existing admin CRUD tools (`src/app/writer/page.tsx:1`).
- **Planned scope**
  - Build the actual writer-facing story editor / prompt-tuning workflow per the core product blueprint (`docs/blueprint.md:1`).
  - Expand Firestore rules so writer-only collections (prompt configs, story types, etc.) enforce `isWriter` even when accessed outside admin (`firestore.rules:53`).
  - Create regression coverage inside `src/app/admin/regression/page.tsx` so writer capabilities stay isolated from parents.
- **Prereqs / next actions**
  - [ ] Finish Step 2 security + QA so parents/children are isolated before exposing richer writer tooling.
  - [ ] Draft detailed requirements for the writer editor (APIs, data model updates, Genkit hooks).
  - [ ] Align with infra on any additional GenAI/print-on-demand integrations referenced in `docs/blueprint.md:15`.
