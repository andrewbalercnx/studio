# Writer Story Editor QA Checklist

Use this checklist after updating the writer workspace.

## 1. Preconditions
- Test account with `isWriter` claim set (and not admin for negative checks).
- Firestore populated with at least one story type, phase, prompt config, and output type.

## 2. Access Control
1. Sign in as a writer → visit `/writer`.
2. Expect the Story Editor tabs to render (types/phases/prompts/outputs) with no links to `/admin`.
3. Sign in as a non-writer parent → `/writer` should show the “no access” message.

## 3. Story Types Panel
1. Click **New Story Type**, fill in the form (name, description, arc steps, level bands) and save.
2. Use the dropdowns to pick existing default/ending phases—IDs should match the Firestore `storyPhases` collection.
3. Toggle the level-band chips (Low/Mid/High) and confirm the selection persists after saving.
4. New row should appear immediately; verify the Firestore doc contains `arcTemplate.steps[]` and `levelBands[]`.
5. Edit an existing type (change status/description) → list updates and Firestore shows new values.

## 4. Story Phases Panel
1. Create a phase with phaseType `storyBeat`, choice count, allowMore toggle.
2. Ensure order index is numeric and appears in the table.
3. Edit an existing phase’s status or description; confirm Firestore updates.

## 5. Prompt Configs Panel
1. Create a config (phase, level band, status, system prompt text).
2. Verify `allowedChatMoves` splits correctly when comma-separated.
3. Edit an existing config’s status/systemPrompt and confirm the change in Firestore.

## 6. Output Types Panel
1. Add a new output type (name, category, age range, status).
2. Check that the card shows the new entry and Firestore doc contains the same fields.
3. Edit an existing output type’s status/description.

## 7. Regression + Cleanup
- Ensure writer actions do **not** touch restricted collections (e.g., `children`).
- Run `/admin/regression` → suite should still pass/warn as before.
- Clean up any test docs if they aren’t meant to persist.
