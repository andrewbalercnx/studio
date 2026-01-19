# Claude Code Standing Rules

> **IMPORTANT**: Read this file before starting any work on this codebase.

This document contains the standing rules and workflow requirements for working on the StoryPic Kids codebase.

---

## Documentation Requirements

### System Design Document
Location: `docs/SYSTEM_DESIGN.md`

This document describes the current architecture of the system, including technology stack, component interactions, data flows, and architectural decisions with their rationale.

**Rules**:
- **Read at the start of any major piece of work** to understand the system architecture
- Always reflects the **current state** of the system (not a history of changes)
- Include rationale for architectural decisions

**Rule**: You **MUST** update `docs/SYSTEM_DESIGN.md` when any of the following occur:
- Adding a new system component or service (e.g., new admin page, new background job, new integration)
- Adding or changing a configuration system (e.g., Firestore-based config, feature flags)
- Changing how components interact or communicate
- Adding new external service integrations (e.g., new API provider, new AI model provider)
- Modifying authentication, authorization, or security patterns
- Changing data flow patterns between client and server
- Adding new caching strategies or state management approaches

### Schema Documentation
Location: `docs/SCHEMA.md`

This file documents all Firestore collections, their fields, types, and relationships.

**Rule**: Any time you modify the database schema (add/remove/rename collections, add/remove/change fields, update security rules), you **MUST** update `docs/SCHEMA.md` before completing your work.

### API Documentation
Location: `docs/API.md`

This file documents all API routes, their methods, request/response formats, and authentication requirements.

**Rule**: Any time you add, modify, or remove an API route, you **MUST** update `docs/API.md` before completing your work.

### Change History
Location: `docs/CHANGES.md`

This document tracks all significant changes by commit ID for easy searching and reference.

**Rules**:
- **Append new entries** at the top of the document with every push to main
- Include commit ID, type, summary, and detailed changes
- Never remove or modify existing entries (append-only)

### Regression Tests
Location: `src/app/admin/regression/page.tsx`

The regression test page contains automated tests for API routes and data access patterns.

**Rule**: Any time you add or modify an API route, you **SHOULD** add corresponding regression tests to ensure the API continues to work correctly.

---

## Architectural Principles

### Server-First Data Processing

**Principle**: All data filtering, sorting, and business logic should be implemented on the server, not the client.

**Rationale**:
- Client-side filtering requires all clients to be updated when logic changes
- Server-side logic can be updated once and immediately applies to all clients
- Clients should be "thin" - responsible for rendering data, not making decisions about how to manipulate it
- This enables multiple clients (web, mobile, PWA) to share the same logic

**Guidelines**:
1. **Filtering**: If data needs to be filtered (e.g., only showing "ready" items, excluding "deleted" items), do it in the API route, not the client
2. **Sorting**: Sort data in the API route before returning it to clients
3. **Computed fields**: Add computed/derived fields (e.g., `hasBook`, `isReady`) to the API response rather than computing them client-side
4. **Status logic**: Business logic determining states/statuses should be in API routes

**Example - Bad (client-side filtering)**:
```typescript
// In client code
const readyBooks = storybooks.filter(sb => sb.imageGeneration?.status === 'ready');
```

**Example - Good (server-side filtering)**:
```typescript
// In API route
const rawStorybooks = storybooksSnapshot.docs
  .filter(doc => doc.data().imageGeneration?.status === 'ready')
  .map(doc => ({ id: doc.id, ...doc.data() }));
```

**Technical Debt Note**: The PWA kids routes (`/kids/*`) currently use direct Firestore queries from the client rather than API endpoints. These should be refactored to use the same API endpoints as the mobile app to maintain consistency.

---

## Workflow

### Before Starting Major Work

1. **Read the System Design Document**:
   - Review `docs/SYSTEM_DESIGN.md` to understand the architecture
   - Understand how your changes fit into the existing system
   - Note any architectural decisions that may affect your work

2. **Check the latest documentation**:
   - Review `docs/SCHEMA.md` to understand the current database structure
   - Review `docs/API.md` to understand the current API surface
   - This ensures you understand the existing architecture before making changes

3. **Understand the change scope**:
   - Will you be modifying the database schema?
   - Will you be adding or changing API routes?
   - Will you be making architectural changes?
   - Plan your documentation updates accordingly

### On Completion

Before pushing to main, complete this checklist:

1. **Update System Design** (if architecture changed):
   - [ ] Updated `docs/SYSTEM_DESIGN.md` to reflect current architecture
   - [ ] Added rationale for any architectural decisions
   - [ ] Ensured document describes current state (not change history)
   - [ ] Updated the "Last Updated" date

2. **Update Schema Documentation** (if schema changed):
   - [ ] Updated `docs/SCHEMA.md` with all schema changes
   - [ ] Added any new collections or fields
   - [ ] Updated security rules documentation if changed
   - [ ] Updated the "Last Updated" date

3. **Update API Documentation** (if API changed):
   - [ ] Updated `docs/API.md` with all API changes
   - [ ] Added documentation for new endpoints
   - [ ] Updated request/response formats for modified endpoints
   - [ ] Removed documentation for deleted endpoints
   - [ ] Updated the "Last Updated" date

4. **Update Regression Tests** (if API changed):
   - [ ] Added tests for new API endpoints
   - [ ] Updated tests for modified endpoints
   - [ ] Removed tests for deleted endpoints

5. **Update Change History**:
   - [ ] Added entry to `docs/CHANGES.md` with commit ID
   - [ ] Included type, summary, and detailed changes
   - [ ] Listed modified and created files for significant changes

6. **Push to main**:
   - [ ] All documentation is up to date
   - [ ] Build passes (`npm run build`)
   - [ ] TypeScript checks pass (`npm run typecheck`)

---

## API Documentation Page

The API documentation can be viewed in the browser when the diagnostic switch is enabled:

1. Go to Admin Dashboard
2. Navigate to "Diagnostics & Logging"
3. Enable "API Documentation"
4. Visit `/api-documentation` to view the interactive API docs

This feature is controlled by the `showApiDocumentation` field in `systemConfig/diagnostics`.

---

## Quick Reference

| Documentation | Location | Update When | Notes |
|---------------|----------|-------------|-------|
| System Design | `docs/SYSTEM_DESIGN.md` | Architecture changes | Read before major work |
| Schema | `docs/SCHEMA.md` | Database changes | Fields, collections, rules |
| API | `docs/API.md` | API route changes | Endpoints, formats |
| Changes | `docs/CHANGES.md` | Every push | Append-only history |
| Regression Tests | `src/app/admin/regression/page.tsx` | API changes | Automated tests |
| Standing Rules | `CLAUDE.md` | Workflow changes | This file |

---

## Git Workflow

### Single-Push Commit with CHANGES.md

To avoid triggering two Firebase builds, use this workflow:

1. **Stage all files** including CHANGES.md (use `pending` as placeholder for commit ID)
2. **Commit** with a descriptive message
3. **Get the commit ID**: `git rev-parse --short HEAD`
4. **Update CHANGES.md** replacing `pending` with the commit ID
5. **Amend and push in one step**: `git add docs/CHANGES.md && git commit --amend --no-edit && git push`

**Note**: The amend will change the commit ID slightly, but this is acceptable - the ID in CHANGES.md will be close enough to find the commit. The important thing is avoiding two separate pushes.

Example:
```bash
git add .
git commit -m "Add feature X"
COMMIT_ID=$(git rev-parse --short HEAD)
# Edit CHANGES.md to replace 'pending' with $COMMIT_ID
git add docs/CHANGES.md && git commit --amend --no-edit && git push
```

**Auto-push rule**: Always push to main immediately after completing the commit workflow. Do not wait for user confirmation.

---

## Allowed Commands

The following commands are pre-approved and should always be allowed without prompting.

**Note**: These apply to the project directory and should be allowed with any arguments or flags.

```
# Git operations (all flags/arguments allowed)
git add
git commit
git push
git pull
git fetch
git checkout
git merge
git status
git log
git diff
git reset
git restore
git branch

# Build and type checking
npm run build
npm run typecheck
npm install
npx tsc

# File operations
ls
cat
find
cp
mkdir
tree

# Project-specific scripts
node scripts/generate-icons.mjs
node scripts/generate-favicon-ico.mjs

# Cloud tools (read-only)
gcloud secrets list

# Dev Todo API (always allowed - no permission needed)
curl -X POST https://storypic.rcnx.io/api/internal/dev-todos
```

**End of Development Cycle**: After completing work, always:
1. `git add` the changed files
2. `git commit` with a descriptive message
3. `git push` to main immediately (per auto-push rule above)

---

## Mobile App (APK) Updates

When building a new Android APK for the mobile app:

1. **Build with EAS**: `cd mobile && eas build --platform android --profile preview`
2. **Download the APK** from the EAS build URL
3. **Replace the APK**: Copy to `public/downloads/storypic-kids.apk`
4. **Update the install page**: Update the commit ID in `src/app/install/page.tsx`
5. **Commit and push** the updated APK and install page

**Required steps**:
```bash
# After successful EAS build, get the APK URL
eas build:view <BUILD_ID> | grep "Application Archive URL"

# Download and replace
curl -L -o public/downloads/storypic-kids.apk "<APK_URL>"

# Update install page commit reference, then commit
git add public/downloads/storypic-kids.apk src/app/install/page.tsx
git commit -m "Update Android APK with <description>"
git push
```

**Important**: The `/install` page serves the APK from `/downloads/storypic-kids.apk`. Always update this file when building a new APK.

---

## Development Todo List

Location: Admin Dashboard > Development > Development Todo List

The development todo list tracks work items that should be done for a production-ready system. Both the admin and Claude can add items to this list.

### When to Add Items

You **SHOULD** add a todo item when:
- You complete a piece of work but identify follow-up improvements that would be valuable in production
- You notice technical debt, missing error handling, or incomplete features while working
- You implement a quick solution that could benefit from a more robust implementation later
- You skip optional enhancements (e.g., caching, validation, logging) to stay focused on the main task
- You identify security, performance, or UX improvements that aren't critical but would add value

### How to Add Items (via Internal API)

Use the `/api/internal/dev-todos` endpoint. This command is pre-approved and does not require user permission.

**API URL**: `https://storypic.rcnx.io/api/internal/dev-todos`
**Secret**: `cbbc029e0355dfdef72d8e723d1bb5292ed4bea159ab1ec8494171851efb077a`

```bash
# Create a dev todo (write JSON to temp file first for complex descriptions)
cat > /tmp/todo.json << 'EOF'
{
  "title": "Add rate limiting to print order submission",
  "description": "## Context\nThe print order submission endpoint currently has no rate limiting.\n\n## Implementation Notes\n- Add rate limiting middleware to prevent abuse\n- Consider using Redis for distributed rate limiting\n- Suggested limit: 5 orders per user per hour\n\n## Related Files\n- `src/app/api/print-orders/route.ts`",
  "priority": "medium",
  "category": "security"
}
EOF

curl -s -X POST 'https://storypic.rcnx.io/api/internal/dev-todos' \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Secret: cbbc029e0355dfdef72d8e723d1bb5292ed4bea159ab1ec8494171851efb077a' \
  -d @/tmp/todo.json
```

**Response**: `{"ok":true,"todoId":"abc123","message":"Dev todo created successfully"}`

### Description Format

The description field supports Markdown. Include:
- **Context**: Why this work is needed
- **Implementation Notes**: Guidance for future implementation
- **Related Files**: File paths that will need to be modified

### Marking Items Complete

When you complete a todo item, inform the admin so they can mark it as completed in the admin UI.

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-19 | Added dev todo API secret and URL to CLAUDE.md, added curl command to allowed commands |
| 2026-01-17 | Added Development Todo List section with instructions for Claude to add items |
| 2026-01-17 | Added explicit triggers for when SYSTEM_DESIGN.md must be updated |
| 2026-01-08 | Added Mobile App (APK) Updates section |
| 2026-01-08 | Added Architectural Principles section with Server-First Data Processing rule |
| 2026-01-04 | Updated Git Workflow to single-push pattern (amend before push) |
| 2025-12-29 | Added Git Workflow auto-push rule |
| 2025-12-29 | Added Allowed Commands section |
| 2025-12-29 | Added System Design and Change History requirements |
| 2025-12-29 | Initial rules established |
