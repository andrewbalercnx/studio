# Parent vs Child Shell Architecture

This document captures the structure we’ll implement to give parents and children clearly separated experiences, as well as the verification steps for confirming the split works.

## Goals
- Parent tools (children management, payments, settings) remain PIN-guarded.
- Child mode renders a simplified story launcher for a single child and hides all parent controls.
- Switching modes is explicit, quick, and auditable.
- Firestore/API access is scoped so a child context cannot touch parent-protected data.

## Route & Layout Plan
| Route | Layout Owner | Notes |
| --- | --- | --- |
| `/parent` | `AppParentLayout` (new `src/app/parent/layout.tsx`) | Wraps all parent pages with `<ParentGuard>`; renders parent nav/sidebar. |
| `/parent/children`, `/parent/settings`, `/parent/billing` | Same layout | Content slots inherit guard & toolbar; additional routes can be added without repeating guard code. |
| `/child/[childId]` | `ChildShellLayout` (new `src/app/child/[childId]/layout.tsx`) | Shows reduced header (logo + “Back to Parent” button), story cards for that child only. |
| `/stories` (child view) | becomes redirect to `/child/[activeChildId]` when `roleMode === 'child'`; otherwise stays parent’s story list. |

## State & Access Control
- `useAppContext`:
  - Store `{ activeChildId, setActiveChildId }` (already exists) plus `activeChildProfile` fetched lazily to confirm ownership.
  - Derive `roleMode === 'child'` only when `activeChildId` is set **and** Firestore confirms `ownerParentUid === currentUser.uid`.
  - Provide `enterChildMode(childId)` helper that runs the ownership check before switching and sets `sessionStorage` to persist between reloads.
- Middleware (optional but recommended) to guard `/child/:id` routes by verifying ID token + Firestore ownership server-side; fallback to 404/redirect if mismatched.
- API handlers receiving `childId` must re-check `ownerParentUid` to avoid trusting client state.

## UI Flow
1. Parent lands on `/parent` (guarded). Each child card gets two actions:
   - `Play as child` → calls `enterChildMode(childId)` then `router.push('/child/${childId}')`.
   - `Manage` → stays within parent shell (still guarded).
2. Child shell header shows only story-centric nav plus “Back to parent” button that:
   - Calls `switchToParentMode()` (clears `activeChildId`).
   - Immediately opens the PIN modal (ParentGuard) before routing back to `/parent`.
3. Header nav renders role-specific actions (already partially implemented) but will hide `/parent/...` links entirely while in child mode.

## Data Queries
- Parent shell: queries remain `where('ownerParentUid','==', user.uid)`; no change.
- Child shell: same query but constrained to `doc(childId)` plus Firestore rules requiring `request.auth.uid == resource.data.ownerParentUid`.
- Story/session lists reuse existing hooks but supply `childId` so sessions load only for that child.

## Verification Checklist (to execute after implementation)
1. **Parent access**: Log in as parent, unlock with PIN, visit `/parent/children`; guard only prompts once per 5 minutes.
2. **Enter child mode**: Click “Play as child”. Confirm URL switches to `/child/<id>`, header shrinks, parent-only buttons vanish, and only selected child’s stories appear.
3. **Switch back**: Click “Back to parent”; expect immediate PIN modal before `/parent` content renders.
4. **Unauthorized child**: Manually navigate to another parent’s child URL → expect 404 or redirect (no data leak).
5. **Refresh persistence**: While in child mode, refresh the browser; app should stay in child shell until “Back to parent” is used.
6. **Automation**: Add Playwright test that toggles modes and asserts DOM differences (parent nav vs child nav).

This plan becomes the blueprint for the upcoming code changes (Step 2). Implementations must follow it and satisfy the checklist before moving to the writer tooling work.
