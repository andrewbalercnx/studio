# Firestore Security Rules Testing Guide

## Overview

This document describes the testing approach for Firestore security rules in this application, including how to use the test harness, understanding limitations, and answers to common questions.

## Test Harness Location

The test harness is available at:
- **File:** `/src/app/firestore-test/page.tsx`
- **URL:** `http://localhost:9002/firestore-test` (when running dev server)

## Testing Approach

### Authentication & Mock Users

**Q: Can I create mock users for testing different roles?**

**A: No, the current test harness uses real Firebase Authentication and cannot create mock users with custom claims.**

Here's why and what your options are:

#### Option 1: Use `@firebase/rules-unit-testing` Library (Recommended for Comprehensive Testing)

For true mock authentication with custom claims, you would need to:

1. Install the testing library:
   ```bash
   npm install --save-dev @firebase/rules-unit-testing
   ```

2. Set up Firebase emulators:
   ```bash
   npm install -g firebase-tools
   firebase init emulators
   ```

3. Create a separate test file (e.g., `firestore.rules.test.ts`) using the library:
   ```typescript
   import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

   const testEnv = await initializeTestEnvironment({
     projectId: 'demo-test',
     firestore: {
       rules: fs.readFileSync('firestore.rules', 'utf8'),
     },
   });

   // Create contexts with custom claims
   const parentContext = testEnv.authenticatedContext('parent-uid', {
     isParent: true,
     isAdmin: false,
     isWriter: false
   });

   const adminContext = testEnv.authenticatedContext('admin-uid', {
     isParent: true,
     isAdmin: true,
     isWriter: false
   });

   const writerContext = testEnv.authenticatedContext('writer-uid', {
     isParent: true,
     isAdmin: false,
     isWriter: true
   });
   ```

**Advantages:**
- Full control over custom claims
- Automated testing
- Can run in CI/CD
- No need for real user accounts

**Disadvantages:**
- Requires separate test infrastructure
- More setup complexity
- Different from production environment

#### Option 2: Manual Testing with Real Users (Current Approach)

The current test harness at `/firestore-test` requires real Firebase Authentication users with custom claims set.

**You need to run tests under different user accounts:**

1. **Parent Role**: Regular authenticated user (default)
   - Log in as a regular parent user
   - Tests marked with `role: 'parent'` will run automatically

2. **Admin Role**: User with `isAdmin: true` custom claim
   - Set custom claim via Firebase Admin SDK or console
   - Log in as this user and run tests
   - Tests marked with `role: 'admin'` will run

3. **Writer Role**: User with `isWriter: true` custom claim
   - Set custom claim via Firebase Admin SDK or console
   - Log in as this user and run tests
   - Tests marked with `role: 'writer'` will run

4. **Unauthenticated**: Sign out before running
   - Tests marked with `role: 'unauthenticated'` will run

**Current Test Coverage by Role:**

The test harness includes **83 test cases** covering:
- 7 tests for user profiles
- 10 tests for children collection
- 2 tests for legacy child sessions
- 5 tests for story sessions
- 4 tests for messages
- 3 tests for events
- 6 tests for characters
- 6 tests for stories
- 2 tests for story outputs
- 2 tests for story pages
- 4 tests for print orders
- 16 tests for configuration collections
- 3 tests for system collections
- 13 tests for help-* objects

**Test Execution:**
- ✅ **Parent tests** (54 tests): Run automatically when logged in as parent
- ✅ **Unauthenticated tests** (7 tests): Run automatically when signed out
- ⚠️ **Admin tests** (11 tests): Require manual login as admin user
- ⚠️ **Writer tests** (3 tests): Require manual login as writer user
- ❌ **Child tests** (2 tests): Currently skipped (would need child-specific auth)

### How to Set Custom Claims

To create users with admin or writer roles:

**Using Firebase Admin SDK (server-side):**
```typescript
import { getAuth } from 'firebase-admin/auth';

// Set admin claim
await getAuth().setCustomUserClaims(uid, {
  isAdmin: true,
  isWriter: false,
  isParent: true
});

// Set writer claim
await getAuth().setCustomUserClaims(uid, {
  isAdmin: false,
  isWriter: true,
  isParent: true
});
```

**Using Firebase Console:**
1. Go to Firebase Console > Authentication
2. Select the user
3. Edit custom claims in the user details

## Help Objects (Public Read Access)

Certain documents are marked as "help" objects and are readable by any authenticated user:

### Help Document Pattern

Any document ID starting with `help-` in the following collections is readable by authenticated users:

- `children/help-child` (and all subcollections)
- `children/help-*` (any help-prefixed child)
- `characters/help-character`
- `storySessions/help-storysession` (and subcollections: messages, events)
- `stories/help-story` (and all subcollections: outputs, pages)
- `stories/help-storybook` (and all subcollections)

### Help Objects in Rules

The rules use a helper function to identify help documents:

```javascript
function isHelpDocument(docId) {
  return docId.matches('help-.*');
}
```

### Testing Help Objects

The test harness includes specific tests for help objects:
- `children-help-read-auth`: Authenticated user can read help-child ✅
- `children-help-read-unauth`: Unauthenticated cannot read help-child ❌
- `children-help-wildcard-read`: Authenticated user can read help-* docs ✅
- `child-sessions-help-read`: Authenticated can read help-child sessions ✅
- `storysessions-help-read`: Authenticated can read help-storysession ✅
- `messages-help-read`: Authenticated can read help-storysession messages ✅
- `events-help-read`: Authenticated can read help-storysession events ✅
- `characters-help-read`: Authenticated can read help-character ✅
- `stories-help-read`: Authenticated can read help-story ✅
- `stories-help-storybook-read`: Authenticated can read help-storybook ✅
- `story-outputs-help-read`: Authenticated can read help-story outputs ✅
- `story-pages-help-read`: Authenticated can read help-story pages ✅

## Running the Tests

### Prerequisites

1. Firebase project configured
2. User accounts with appropriate custom claims (for admin/writer tests)
3. Development server running: `npm run dev`

### Step-by-Step Testing Process

#### 1. Test as Parent User

1. Log in to the application as a regular parent user
2. Navigate to `/firestore-test`
3. Click "Run All Tests"
4. Review results - should see ~54 tests run, ~20 skipped for other roles

#### 2. Test as Admin User

1. Sign out from the application
2. Log in as a user with `isAdmin: true` custom claim
3. Navigate to `/firestore-test`
4. Click "Run All Tests"
5. Review results - admin tests should now pass

#### 3. Test as Writer User

1. Sign out from the application
2. Log in as a user with `isWriter: true` custom claim
3. Navigate to `/firestore-test`
4. Click "Run All Tests"
5. Review results - writer tests should now pass

#### 4. Test as Unauthenticated

1. Sign out from the application
2. Navigate to `/firestore-test`
3. Click "Run All Tests"
4. Review results - unauthenticated tests should run

### Understanding Test Results

**Test Status:**
- ✅ **Pass (green)**: Rule behaved as expected
- ❌ **Fail (red)**: Rule did NOT behave as expected - needs investigation
- ⏸️ **Pending (gray)**: Test was skipped (usually requires different role)
- ⏳ **Running (blue)**: Test is currently executing

**Common Failure Reasons:**
1. **Permission denied when expected to allow**: Rule is too restrictive
2. **Allowed when expected to deny**: Rule is too permissive (security issue!)
3. **Document not found**: Setup failed, or wrong document ID referenced
4. **Missing data fields**: Test data doesn't match expected structure

### Cleanup

After running tests, click "Cleanup Test Data" to remove all test documents. This will:
- Delete all documents with `rulesTest: true` flag
- Clean up from collections: children, storySessions, characters, stories, printOrders
- **NOT delete** user profiles (for safety)
- Show count of deleted documents

## Test Data Setup

The test harness automatically creates the following test data:

### Created by Setup (Parent Tests)
1. Own child document
2. Sibling child document
3. Legacy child session
4. Story session
5. Message in story session
6. Character
7. Story
8. Print order

### Created by Setup (Admin Tests Only)
9. Other parent's child
10. Other parent's story session
11. Other parent's character
12. Other parent's story
13. Other parent's print order

All test documents are tagged with `rulesTest: true` for easy cleanup.

## Test Coverage by Collection

| Collection | Create | Read Own | Read Other | Update | Delete | List | Help Docs |
|------------|--------|----------|------------|--------|--------|------|-----------|
| users | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | N/A |
| children | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| children/sessions | N/A | ✅ | N/A | N/A | N/A | N/A | ✅ |
| storySessions | ✅ | ✅ | ✅ | ✅ | N/A | N/A | ✅ |
| storySessions/messages | ✅ | ✅ | ✅ | N/A | N/A | N/A | ✅ |
| storySessions/events | ✅ | ✅ | N/A | N/A | N/A | N/A | ✅ |
| characters | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ |
| stories | ✅ | ✅ | ✅ | ✅ | N/A | N/A | ✅ |
| stories/outputs | N/A | ✅ | N/A | N/A | N/A | N/A | ✅ |
| stories/outputs/pages | N/A | ✅ | N/A | N/A | N/A | N/A | ✅ |
| printOrders | ✅ | ✅ | ✅ | ✅ | N/A | N/A | N/A |
| promptConfigs | N/A | ✅ | N/A | ✅ (W) | N/A | N/A | N/A |
| storyPhases | N/A | ✅ | N/A | ✅ (W/A) | N/A | N/A | N/A |
| storyTypes | N/A | ✅ | N/A | ✅ (deny) | N/A | N/A | N/A |
| storyOutputTypes | N/A | ✅ | N/A | ✅ (deny) | N/A | N/A | N/A |
| printLayouts | N/A | ✅ | N/A | ✅ (deny) | N/A | N/A | N/A |
| aiFlowLogs | ✅ (deny) | ✅ (deny/A) | N/A | N/A | N/A | N/A | N/A |
| helpWizards | N/A | ✅ | N/A | ✅ (deny) | N/A | N/A | N/A |

**Legend:**
- ✅ = Test exists
- N/A = Not applicable or not tested
- (W) = Writer role required
- (A) = Admin role required
- (deny) = Test expects denial

## Limitations & Known Gaps

### Current Limitations

1. **No Mock Authentication**: Cannot programmatically test all roles without real users
2. **Manual Role Switching**: Admin and Writer tests require manual login with different accounts
3. **Child Role Not Implemented**: Child-specific authentication not yet supported
4. **No Server Context Testing**: Cannot test server (unauthenticated from backend) operations in browser
5. **Limited List Query Testing**: Only basic list queries with `where` clauses tested
6. **No Field Validation Testing**: Rules don't yet validate field types or prevent ownership changes
7. **No Subcollection List Testing**: Testing get operations but not list operations on subcollections

### Missing Test Coverage

Collections/operations not yet covered:
- Share token authentication (public access with valid token)
- Passcode-protected shares
- Field-level validation (e.g., preventing ownership field changes)
- Rate limiting scenarios
- Batch write operations
- Transaction operations
- More complex query patterns

### Security Gaps in Current Rules

1. **No field validation**: Rules don't verify field types or required fields
2. **No ownership immutability**: Users can potentially change `ownerParentUid` after creation
3. **No explicit deny-all**: Missing catch-all rule to deny access to unmatched collections
4. **Limited query validation**: Don't verify that list queries use correct filters

## CRITICAL SECURITY FIX APPLIED

**Version 10 of the rules (current) fixes a critical security vulnerability:**

The previous rules used `isServer()` function that checked `request.auth == null`. This was **WRONG** because:
- It allowed ANY unauthenticated browser user to bypass all security rules
- There's no way to distinguish server requests from unauthenticated users in Firestore Security Rules
- **Firebase Admin SDK bypasses Security Rules entirely** - it doesn't evaluate rules at all

**What changed:**
- ❌ Removed broken `isServer()` function
- ✅ Server-side code should use Firebase Admin SDK (which bypasses rules automatically)
- ✅ All client-side requests now require proper authentication
- ✅ Help documents (`help-*`) require authentication, not open to public
- ✅ Added explicit deny-all rule at the end for unmatched collections

**Impact on your server-side code:**
- If you have server-side Node.js code using Firebase Admin SDK → **No changes needed**, Admin SDK already bypasses rules
- If you were relying on `isServer()` for client-side unauthenticated access → **This is now blocked** (as it should be for security)

## Recommended Next Steps

### For Immediate Use

1. **Deploy the fixed rules to production immediately** - The previous rules had a critical security hole

2. **Create Test Users**: Set up at least 3 test accounts:
   - Regular parent (no special claims)
   - Admin parent (`isAdmin: true`)
   - Writer parent (`isWriter: true`)

2. **Run Tests for Each Role**: Manually run the test suite as each user type

3. **Document Results**: Save test results diagnostics for each role

### For Better Testing Infrastructure

1. **Set Up Firebase Emulators**:
   ```bash
   firebase init emulators
   # Select: Authentication, Firestore
   ```

2. **Create Unit Tests with `@firebase/rules-unit-testing`**:
   - Fully automated testing
   - Mock authentication with custom claims
   - Can run in CI/CD pipeline

3. **Add Field Validation Rules**: Update rules to validate:
   - Required fields
   - Field types
   - Ownership field immutability
   - Role self-assignment prevention

4. **Add Explicit Deny-All Rule** at end of `firestore.rules`:
   ```javascript
   // Deny access to any collection not explicitly allowed
   match /{document=**} {
     allow read, write: if false;
   }
   ```

## References

For more information about Firebase testing:

- [Firebase Unit Tests Documentation](https://firebase.google.com/docs/rules/unit-tests)
- [Test Rules with Emulator](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [Authentication Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth)
- [@firebase/rules-unit-testing on npm](https://www.npmjs.com/package/@firebase/rules-unit-testing)

## Appendix: Test Case Reference

See `/src/app/firestore-test/page.tsx` for the complete list of 83 test cases organized by collection.

### Quick Test Statistics

- **Total Tests**: 83
- **Parent Tests**: 54 (65%)
- **Admin Tests**: 11 (13%)
- **Writer Tests**: 3 (4%)
- **Unauthenticated Tests**: 7 (8%)
- **Other Role Tests**: 8 (10% - currently skipped)

### Collections Covered

- ✅ users (7 tests)
- ✅ children (10 tests)
- ✅ children/sessions (2 tests)
- ✅ storySessions (5 tests)
- ✅ storySessions/messages (4 tests)
- ✅ storySessions/events (3 tests)
- ✅ characters (6 tests)
- ✅ stories (6 tests)
- ✅ stories/outputs (2 tests)
- ✅ stories/outputs/pages (2 tests)
- ✅ printOrders (4 tests)
- ✅ promptConfigs (4 tests)
- ✅ storyPhases (3 tests)
- ✅ storyTypes (2 tests)
- ✅ storyOutputTypes (2 tests)
- ✅ printLayouts (2 tests)
- ✅ aiFlowLogs (3 tests)
- ✅ helpWizards (3 tests)

---

**Document Version**: 1.0
**Last Updated**: 2025-12-06
**Author**: Claude Code Test Harness Generator
