# Parent PIN Guard QA Checklist

Use this checklist after making changes to the parent security flow to confirm the behaviour matches product requirements.

## 1. Setup
- Sign in with a parent account and navigate to `/parent/settings`.
- Set or update the 4-digit PIN (a success toast should appear).
- In Firestore, confirm the parent document now shows `pinHash`, `pinSalt`, and `pinUpdatedAt`.

## 2. Happy Path
1. Visit a protected route such as `/parent/children`.
2. The Parent PIN modal should appear before content renders.
3. Enter the correct PIN → expect a success toast, the modal closes, and the page content loads.
4. Navigate across multiple parent routes without re-entering the PIN (guard stays unlocked for five minutes or until you sign out).
5. If the account never set a PIN, the modal should offer the “Create PIN” form (two inputs). Enter matching 4-digit values, click **Create PIN**, and the modal should close with a success toast.

## 3. Error Handling
- Enter fewer than four digits → inline toast “PIN must be 4 digits”.
- Enter a wrong PIN → toast “Incorrect PIN...” and input clears.
- Remove the PIN in Firestore → reopening the modal should show the “Parent PIN Required” warning that links to settings.
- Sign out or switch browser profiles → the modal should appear again because the guard state is reset.

## 3b. Brute-Force Lockout (Sprint W4-A)
- Enter a wrong PIN **5 times in a row** → the 5th failure returns `429 PIN_LOCKED` and the UI shows “Too many incorrect attempts. Try again in N minute(s).”
- While locked, **every** attempt (even the correct PIN) returns the same 429 — the server refuses to compare PINs until the lock expires.
- In Firestore, the user doc shows `pinFailedAttempts` counting up (1–4) and then `pinLockedUntil` (~5 minutes ahead) with the counter reset to 0.
- After the lock expires you get a fresh window of 5 attempts; a successful verification removes both fields.
- The kids-PWA setup screen (`/kids/setup` switch-profile and “Return to Parent Mode”) verifies against the same endpoint and shows the same lockout message. There is **no offline fallback PIN** — a network failure shows an error, never accepts a default.
- Regression coverage: `API_VERIFY_PIN_LOCKOUT` on `/admin/regression` uses the endpoint’s `dryRun` flag (reports the policy without recording attempts — it can never lock the admin out).

## 4. Auto-Lock
- After unlocking, wait five minutes (or manually edit `sessionStorage["storypic.parentGuard.lastValidatedAt:<uid>"]` to a timestamp older than five minutes) and confirm the modal reappears automatically.
- Check that the guard state persists across page refreshes *within* the five-minute window.

## 4b. Reload Grace (Sprint W4-A fix)
- Unlock any parent page (or sign up, which primes the grace window), then **hard-reload** the page (Cmd-Shift-R / F5).
- The page content must render WITHOUT the PIN dialog: the guard defers its modal-open decision until the persisted `lastValidatedAt` has hydrated (`isGuardHydrated` in `use-parent-guard`), so an unexpired window survives a full reload.
- A reload *after* the window has expired must still re-prompt.
- Automated coverage: `e2e/pin-guard.spec.ts` (blocking) and the W1C-6 adjacent probe in `e2e/probe/w1c-regression.spec.ts` (report-only; the `pin-guard--grace-lost-on-full-reload` finding has been removed from the probe baseline and must not reappear).

## 5. API Verification
- `POST /api/parent/set-pin` should reject non-authenticated calls (401) and enforce 4-digit input (400).
- `POST /api/parent/verify-pin` should:
  - Return 401 for missing/expired tokens.
  - Return 400 if the user has not set a PIN.
  - Return `{ ok: true }` only when the PIN matches.

## 6. Admin Revoke Flow
- In `/admin/users`, click **Revoke PIN** for a parent who currently has one → Firestore fields `pinHash`, `pinSalt`, `pinUpdatedAt` should be removed.
- Sign in as that parent and open any protected page → the create-PIN modal appears immediately, preventing access until a new PIN is set.

Document any deviations, logs, or console errors before moving on to Step 2 of the role separation work.
