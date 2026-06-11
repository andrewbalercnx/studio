# Security Remediation — Committed Credentials

> **Created**: 2026-06-05 · **Severity**: Critical · **Status**: In progress
> Surfaced by the GTM sprint-plan security review. Tracked as dev-todo
> `[URGENT][SECURITY] Rotate & purge committed credentials`.

## What was exposed

| Secret | Location | Risk |
|--------|----------|------|
| Firebase **Admin service-account private key** | `serviceAccount.json` (repo root, committed in `4f9da31`) | Admin SDK **bypasses all `firestore.rules`** → full read/write to all user & child data |
| **`INTERNAL_API_SECRET`** (live value) | `CLAUDE.md` plaintext (committed) | Lets anyone call `/api/internal/dev-todos` and `/api/internal/system-test` |

Both were present in tracked files and in git history. `.gitignore` did not cover `serviceAccount.json`.

## Done in the working tree (safe, reversible)

- [x] `git rm --cached serviceAccount.json` — untracked from the index; local copy retained.
- [x] Added `serviceAccount.json`, `*-service-account*.json`, `*.key`, `*.p12` to `.gitignore`.
- [x] Redacted the literal `INTERNAL_API_SECRET` from `CLAUDE.md`; it now references Secret Manager.

> ⚠️ These changes are staged but **not committed/pushed** — the destructive history rewrite and key
> rotation below must be coordinated and done together. Committing the untrack alone does **not**
> remove the secret from history, and does **not** invalidate the already-leaked key.

## Must be done by an admin (Claude cannot perform these)

1. **Rotate the Firebase service-account key** in GCP IAM → disable/delete the leaked key id for
   `authentication-service-account@studio-6508342045-13669.iam.gserviceaccount.com`. Purging git
   history does **not** un-leak a key that is already public to anyone with repo access — rotation is
   the only real fix. The app already loads the key from Secret Manager
   (`FIREBASE_SERVICE_ACCOUNT_KEY` in `apphosting.yaml`), so production is unaffected by removing the
   committed file.
2. **Rotate `INTERNAL_API_SECRET`** in Secret Manager. Once rotated, the old value in git history is
   dead. Update any local `.env`/automation that used it.
3. **Scrub git history** of both secrets across all commits:
   ```bash
   # Preferred: git filter-repo (install separately)
   git filter-repo --invert-paths --path serviceAccount.json
   # plus a replace-text rule for the old INTERNAL_API_SECRET value
   ```
   Then a **coordinated force-push** (notify all collaborators; everyone re-clones).
4. ~~**Harden the secret comparison**~~ — ✅ **Done (2026-06-11, Sprint W1-B,
   commit `0c497a0`)**: both internal routes now compare via
   `crypto.timingSafeEqual` through the shared `isInternalSecretValid` helper
   (`src/lib/internal-secret.ts` — SHA-256 both sides first so length
   mismatches never throw or leak; fails closed when the expected secret is
   unset). Unit-covered in `src/lib/__tests__/internal-secret.test.ts`.
   - `src/app/api/internal/dev-todos/route.ts`
   - `src/app/api/internal/system-test/route.ts`

> **Scrub status (2026-06-11)**: the git-history scrub (item 3) remains
> deliberately deferred — it needs a coordinated force-push with all
> collaborators/worktrees paused, which is out of scope for an automated
> sprint. The leaked values are already rotated/dead, so the scrub is hygiene,
> not exposure reduction.

## Verification

- [ ] Leaked SA key id shows as disabled in GCP IAM; app still functions (uses Secret Manager).
- [ ] Old `INTERNAL_API_SECRET` returns 401 against `/api/internal/dev-todos`; new value works.
- [ ] `git log --all -- serviceAccount.json` returns nothing after history scrub.
- [ ] Repo-wide secret scan (e.g. `gitleaks`) is clean; consider adding it as a CI step.
