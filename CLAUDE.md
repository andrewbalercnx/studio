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
- Update whenever architectural changes are made
- Always reflects the **current state** of the system (not a history of changes)
- Include rationale for architectural decisions

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

To avoid triggering two Firebase builds, use this workflow to include the commit ID in CHANGES.md before pushing:

1. **Stage all files** including CHANGES.md (use `pending` as placeholder for commit ID)
2. **Commit** with a descriptive message
3. **Get the commit ID** from the commit just made: `git rev-parse --short HEAD`
4. **Update CHANGES.md** replacing `pending` with the actual commit ID
5. **Amend the commit** to include the updated CHANGES.md: `git commit --amend --no-edit`
6. **Push** (single push triggers single build)

Example:
```bash
git add .
git commit -m "Add feature X"
# Get commit ID (e.g., abc1234)
git rev-parse --short HEAD
# Edit CHANGES.md to replace 'pending' with 'abc1234'
git add docs/CHANGES.md
git commit --amend --no-edit
git push
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
```

**End of Development Cycle**: After completing work, always:
1. `git add` the changed files
2. `git commit` with a descriptive message
3. `git push` to main immediately (per auto-push rule above)

---

## Version History

| Date | Changes |
|------|---------|
| 2026-01-04 | Updated Git Workflow to single-push pattern (amend before push) |
| 2025-12-29 | Added Git Workflow auto-push rule |
| 2025-12-29 | Added Allowed Commands section |
| 2025-12-29 | Added System Design and Change History requirements |
| 2025-12-29 | Initial rules established |
