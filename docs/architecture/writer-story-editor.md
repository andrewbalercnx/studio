# Writer Story Editor Workspace

This doc captures the structure and responsibilities of the new writer-facing tools so the Writer role can work independently from admins.

## Goals
- Give writers a dedicated `/writer` experience that never routes through `/admin`.
- Provide simple CRUD panels for creative assets: Story Types, Story Phases, Prompt Configs, Story Output Types.
- Keep forms non-technical: plain inputs, select menus, and text areas instead of raw JSON editing.
- Enforce role gating so only `isWriter` (and optionally admins) can access the workspace.

## Layout
- `src/app/writer/layout.tsx`
  - Client layout that checks `roleMode` and blocks non-writers.
  - Provides consistent page chrome with room for future sidebar/toolbar additions.
- `src/app/writer/page.tsx`
  - Hosts the Story Editor tabs (Types, Phases, Prompts, Outputs).
  - Each tab is a panel component with list + modal editor.

## Data Flow
- Uses the existing `useCollection` hook plus Firestore client to read/write docs from:
  - `storyTypes`
  - `storyPhases`
  - `promptConfigs`
  - `storyOutputTypes`
- Writer updates use `setDoc`/`addDoc` with `serverTimestamp` for `updatedAt`.
- Forms convert friendly input (comma/newline separated) into the arrays/objects the backend expects (levelBands, arcTemplate.steps, allowedChatMoves, etc.).

## Role Gating
- Layout guards via `roleMode` from `AppContext`.
- Admins may access the writer tools (for support), but standard parents/children are blocked with a friendly message.
- Future enhancement: middleware-level guard for `/writer` to protect server components as well.

## Future Enhancements
- Autosave drafts + validation for prompt JSON fragments.
- Collaborative change history per asset.
- Embedded previews (e.g., sample beat generation) per writer panel.

Refer to `docs/testing/writer-story-editor.md` for verification steps after changes.
