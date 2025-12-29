# Claude Code Standing Rules

> **IMPORTANT**: Read this file before starting any work on this codebase.

This document contains the standing rules and workflow requirements for working on the StoryPic Kids codebase.

---

## Documentation Requirements

### Schema Documentation
Location: `docs/SCHEMA.md`

This file documents all Firestore collections, their fields, types, and relationships.

**Rule**: Any time you modify the database schema (add/remove/rename collections, add/remove/change fields, update security rules), you **MUST** update `docs/SCHEMA.md` before completing your work.

### API Documentation
Location: `docs/API.md`

This file documents all API routes, their methods, request/response formats, and authentication requirements.

**Rule**: Any time you add, modify, or remove an API route, you **MUST** update `docs/API.md` before completing your work.

### Regression Tests
Location: `src/app/admin/regression/page.tsx`

The regression test page contains automated tests for API routes and data access patterns.

**Rule**: Any time you add or modify an API route, you **SHOULD** add corresponding regression tests to ensure the API continues to work correctly.

---

## Workflow

### Before Starting Work

1. **Check the latest documentation**:
   - Review `docs/SCHEMA.md` to understand the current database structure
   - Review `docs/API.md` to understand the current API surface
   - This ensures you understand the existing architecture before making changes

2. **Understand the change scope**:
   - Will you be modifying the database schema?
   - Will you be adding or changing API routes?
   - Plan your documentation updates accordingly

### On Completion

Before pushing to main, complete this checklist:

1. **Update Schema Documentation** (if schema changed):
   - [ ] Updated `docs/SCHEMA.md` with all schema changes
   - [ ] Added any new collections or fields
   - [ ] Updated security rules documentation if changed
   - [ ] Updated the "Last Updated" date

2. **Update API Documentation** (if API changed):
   - [ ] Updated `docs/API.md` with all API changes
   - [ ] Added documentation for new endpoints
   - [ ] Updated request/response formats for modified endpoints
   - [ ] Removed documentation for deleted endpoints
   - [ ] Updated the "Last Updated" date

3. **Update Regression Tests** (if API changed):
   - [ ] Added tests for new API endpoints
   - [ ] Updated tests for modified endpoints
   - [ ] Removed tests for deleted endpoints

4. **Push to main**:
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

| Documentation | Location | Update When |
|---------------|----------|-------------|
| Schema | `docs/SCHEMA.md` | Collections, fields, or security rules change |
| API | `docs/API.md` | API routes are added, modified, or removed |
| Regression Tests | `src/app/admin/regression/page.tsx` | API routes change |
| Standing Rules | `CLAUDE.md` | Workflow or requirements change |

---

## Version History

| Date | Changes |
|------|---------|
| 2025-12-29 | Initial rules established |
