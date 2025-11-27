# Parent/Child Shell QA Checklist

Use this script after deploying the shell split to make sure parents and children only see the correct UI.

## 1. Preconditions
- A parent account with at least two children and one existing story session.
- Parent PIN already configured (use `/parent/settings` if needed).

## 2. Parent Shell
1. Sign in, navigate to `/parent` → PIN modal shows; enter PIN; parent dashboard loads.
2. Confirm sidebar links (Overview, Manage Children, Settings) are visible and stay accessible without re-entering PIN for five minutes.
3. Visit `/parent/children` and `/parent/settings` directly via address bar → guard prompts again only if 5+ minutes have elapsed.

## 3. Enter Child Mode
1. On `/parent`, click “Play as child” for Child A.
2. Verify route changes to `/child/<childAId>` and header nav now shows only “My Stories” + “New Story”.
3. Confirm “Back to Parent” button (page + header) opens the PIN modal before showing any parent content.
4. Refresh the browser and ensure the app stays in child mode (route + slim nav).

## 4. Story Access
1. In child mode, ensure only Child A’s stories appear; starting/continuing a story keeps you in child context.
2. Manually navigate to `/child/<childBId>` (a sibling) → expect redirect back to parent mode or “We couldn’t find that child” message.
3. Browse to `/parent/children` while still in child mode → should immediately show the PIN modal.

## 5. Security Regression
1. Open DevTools → Application → Storage and delete `activeChildId`, refresh `/child/<childAId>`; the page should re-fetch and keep you in child mode because the URL sets context.
2. Try to call child API routes with another parent’s child ID; server should respond 403/404 (use emulator logs if available).

Log any failures (URL, timestamp, expected vs actual) before moving on to Step 3 (writer story editor).
