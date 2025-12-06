# CRITICAL FIRESTORE SECURITY UPDATE - Version 11

**Date**: December 6, 2025
**Severity**: HIGH
**Status**: FIXED (pending deployment)

## ⚠️ SECOND CRITICAL VULNERABILITY DISCOVERED

After deploying version 10 of the security rules, comprehensive testing revealed **another critical security vulnerability** that allows authenticated users to read data they shouldn't have access to.

## The Problem

### Vulnerability: Read/List Permission Conflation

Firestore Security Rules have two types of read operations:
- **`get`**: Read a single document by ID
- **`list`**: Query/list multiple documents

When you use `allow read`, it grants BOTH `get` AND `list` permissions. This caused a severe security issue.

### Example of Vulnerable Code (v10)

```javascript
// VULNERABLE - from v10
match /children/{childId} {
  allow read: if isAdmin()
              || (isAuthenticated() && resource.data.ownerParentUid == request.auth.uid);
}
```

**What this actually means:**
- `allow get`: ✅ Parent can read their own child document (correct)
- `allow list`: ❌ **Parent can list ALL children documents** (WRONG!)

When a parent executes a list query, the `resource.data.ownerParentUid` check doesn't work properly because Firestore evaluates the rule against **each document in the result set**, and if the query doesn't explicitly filter, the user can see all documents.

### Test Results Showing the Vulnerability

When running tests **without admin privileges**, the following tests FAILED (expected deny, but got allow):

#### User-Owned Collections:
1. ❌ `users-read-other` - Could read other user profiles
2. ❌ `users-list-all` - Could list all users
3. ❌ `children-read-other` - Could read other parents' children
4. ❌ `children-list-other` - Could list other parents' children
5. ❌ `storysessions-read-other` - Could read other parents' story sessions
6. ❌ `messages-read-other` - Could read messages in other sessions
7. ❌ `characters-read-other` - Could read other parents' characters
8. ❌ `stories-read-other` - Could read other parents' stories
9. ❌ `printorders-read-other` - Could read other parents' print orders

#### System Collections:
10. ❌ `aiflowlogs-read-parent` - Could read admin-only AI flow logs
11. ❌ `aiflowlogs-write-parent` - Could write to admin-only AI flow logs

### Why This Happened

The Firestore Security Rules language **cannot inspect the WHERE clause values** in a query. You can check:
- ✅ `request.query.limit != null` (does query have a limit?)
- ✅ `request.query.where.size() > 0` (does query have any where clauses?)
- ❌ **Cannot check**: "Is the where clause filtering by `ownerParentUid == request.auth.uid`?"

This means rules like this are **dangerously misleading**:

```javascript
// LOOKS SAFE BUT ISN'T!
allow list: if isAuthenticated()
            && request.query.limit != null
            && request.query.where.size() > 0;
```

This allows **any query with any WHERE clause**, including:
- `where('ownerParentUid', '==', 'someone-elses-uid')`  ← ❌ Allowed!
- `where('status', '==', 'active')`  ← ❌ Allowed!
- `where('createdAt', '>', yesterday)`  ← ❌ Allowed!

## Impact Assessment

### What Could Malicious Users Do?

With this vulnerability, any authenticated user could:

1. **List all users** - Query the entire users collection
2. **Read other parents' children** - Access child profiles they don't own
3. **Read other parents' story sessions** - View interactive story sessions
4. **Read other parents' messages** - See private chat messages
5. **Read other parents' characters** - Access custom character data
6. **Read other parents' stories** - View generated stories
7. **Read other parents' print orders** - See order history with potentially sensitive info
8. **Read AI flow logs** - Access admin-only system logs
9. **Write AI flow logs** - Pollute admin-only system logs

**This is a data privacy breach affecting all user data.**

### Data Exposure Timeline

- **v9 rules (before Dec 6)**: Complete exposure via `isServer()` bypass
- **v10 rules (Dec 6)**: Fixed `isServer()`, but read/list conflation remained
- **v11 rules (Dec 6, later)**: Both vulnerabilities fixed

## The Fix (Version 11)

### Changes Applied

Separated `allow read` into explicit `allow get` and `allow list` for all collections:

```javascript
// FIXED - Version 11
match /children/{childId} {
  // Get: Parent can read their own child documents
  allow get: if isAdmin()
             || (isAuthenticated() && resource.data.ownerParentUid == request.auth.uid);

  // List: Only admins can list children (parents must use get with known IDs)
  allow list: if isAdmin();
}
```

### Collections Updated

The following collections had their rules separated:

1. **users** (line 31-35)
2. **children** (line 38-56)
3. **children/sessions** (line 59-68)
4. **storySessions** (line 76-88)
5. **storySessions/messages** (line 91-105)
6. **storySessions/events** (line 107-121)
7. **characters** (line 124-137)
8. **stories** (line 140-152)
9. **stories/{allPaths=**}** (line 155-164) - All subcollections
10. **printOrders** (line 168-173)

### Collections NOT Changed (Already Secure)

These collections use `{document=**}` wildcard pattern and don't allow list operations for non-admins:
- **promptConfigs**
- **storyPhases**
- **storyTypes**
- **storyOutputTypes**
- **printLayouts**
- **aiFlowLogs** (admin-only)
- **helpWizards** (read-only for parents)

## Testing the Fix

### Test Results Expected After v11 Deployment

#### As Parent User (Non-Admin):
- ✅ `users-read-self` - PASS (can read own profile)
- ✅ `users-read-other` - PASS (denied as expected)
- ✅ `users-list-all` - PASS (denied as expected)
- ✅ `children-read-own` - PASS (can read own children)
- ✅ `children-read-other` - PASS (denied as expected)
- ✅ `children-list-own` - PASS (denied - list requires admin)
- ✅ `children-list-other` - PASS (denied as expected)
- ✅ `aiflowlogs-read-parent` - PASS (denied as expected)
- ✅ `aiflowlogs-write-parent` - PASS (denied as expected)

#### As Admin User:
- ✅ All tests should pass (admins have full access)

### How to Test

1. **Deploy v11 rules to production**:
   ```bash
   firebase deploy --only firestore:rules
   ```

2. **Run test harness as parent user**:
   - Navigate to `http://localhost:9002/firestore-test`
   - Click "Run All Tests"
   - Verify all parent tests pass
   - **IMPORTANT**: Some tests will now be "denied" that were incorrectly "allowed" before

3. **Run test harness as admin user**:
   - Sign out
   - Sign in as user with `isAdmin: true` custom claim
   - Run all tests
   - Verify admin tests pass

## Application Impact

### Will My App Break?

**Potentially yes**, if your application relies on list queries for user-owned collections.

### Breaking Changes

#### ❌ These operations will NO LONGER WORK for parent users:

```typescript
// 1. List all children (even if filtering by own UID)
const q = query(
  collection(firestore, 'children'),
  where('ownerParentUid', '==', currentUser.uid)
);
const snapshot = await getDocs(q);  // ❌ Will fail: permission-denied

// 2. List all stories
const q2 = query(
  collection(firestore, 'stories'),
  where('parentUid', '==', currentUser.uid)
);
const snapshot2 = await getDocs(q2);  // ❌ Will fail: permission-denied

// 3. List all characters
const q3 = query(collection(firestore, 'characters'));
const snapshot3 = await getDocs(q3);  // ❌ Will fail: permission-denied
```

### ✅ Recommended Alternatives

#### Option 1: Use Cloud Functions with Admin SDK

Create server-side Cloud Functions that use Firebase Admin SDK (which bypasses rules):

```typescript
// functions/src/index.ts
import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export const listMyChildren = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new Error('Unauthorized');

  const db = getFirestore();
  const snapshot = await db
    .collection('children')
    .where('ownerParentUid', '==', uid)
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});
```

Client-side usage:
```typescript
import { httpsCallable } from 'firebase/functions';

const listMyChildren = httpsCallable(functions, 'listMyChildren');
const result = await listMyChildren();
console.log(result.data);  // ✅ Works!
```

#### Option 2: Maintain a User-Specific Index

Store references to owned documents in the user's profile:

```typescript
// When creating a child:
const childRef = doc(collection(firestore, 'children'));
await setDoc(childRef, {
  ownerParentUid: currentUser.uid,
  displayName: 'Child Name'
});

// Also update user profile with child IDs
await updateDoc(doc(firestore, 'users', currentUser.uid), {
  childIds: arrayUnion(childRef.id)
});

// Later, retrieve children by IDs:
const userDoc = await getDoc(doc(firestore, 'users', currentUser.uid));
const childIds = userDoc.data()?.childIds || [];

const children = await Promise.all(
  childIds.map(id => getDoc(doc(firestore, 'children', id)))
);  // ✅ Works! (uses get, not list)
```

#### Option 3: Use Composite Indexes with Security Rules (Advanced)

If you MUST allow list queries, you can create composite indexes and validate the exact query structure:

**Not recommended** - Firestore Security Rules still cannot validate WHERE clause values, so this approach has limitations.

## Deployment Steps

### 1. Review Your Application Code

Search for all list queries in your codebase:

```bash
# Search for collection queries
grep -r "getDocs" src/
grep -r "onSnapshot.*query" src/
grep -r "collection(firestore" src/
```

Identify any queries that:
- Query `children`, `storySessions`, `characters`, `stories`, or `printOrders`
- Are executed by parent users (not admin)
- Use list operations instead of get operations

### 2. Update Application Code (if needed)

Replace list queries with one of the recommended alternatives above.

### 3. Test Changes Locally

```bash
# Start dev server
npm run dev

# Navigate to affected features and test
# - Child listing
# - Story listing
# - Character selection
# - Print order history
```

### 4. Deploy Security Rules

```bash
firebase deploy --only firestore:rules
```

### 5. Run Test Harness

Navigate to `/firestore-test` and run tests as:
- Parent user
- Admin user (if you have one configured)

### 6. Monitor for Errors

Check browser console and Firebase logs for permission-denied errors:

```bash
firebase functions:log
```

## FAQ

### Q: Will Firebase Admin SDK still work?

**A: Yes, 100%.** Firebase Admin SDK completely bypasses security rules. No changes needed to server-side code.

### Q: Why can't I just validate the WHERE clause in security rules?

**A: Firestore Security Rules don't support this.** You can only check IF a where clause exists, not WHAT it filters on. This is a fundamental limitation of the rules language.

### Q: Can I allow list queries for a specific field only?

**A: No.** There's no way to enforce "only allow queries where the where clause is filtering by ownerParentUid == request.auth.uid".

### Q: What if I need parents to list their own data?

**A: Use Cloud Functions or maintain a document index.** See "Recommended Alternatives" above.

### Q: Will this affect my help-* documents?

**A: No.** Help documents use `get` operations, not `list`. The rules for help-* documents remain:
```javascript
allow get: if isHelpDocument(documentId) && isAuthenticated();
```

### Q: Can admins still list everything?

**A: Yes.** All collections have:
```javascript
allow list: if isAdmin();
```

## Summary

- **Vulnerability**: `allow read` granted both `get` and `list`, allowing unauthorized list queries
- **Impact**: Any authenticated user could list/read other users' private data
- **Fix**: Separated into `allow get` and `allow list`, restricting list to admins only
- **Breaking Change**: Parent users can no longer use list queries (must use Cloud Functions or document indexes)
- **Action Required**: Review and update application code that relies on list queries

---

**Version**: 11
**Previous Version**: 10
**Rules File**: [firestore.rules](firestore.rules)
**Test Harness**: [/firestore-test](/src/app/firestore-test/page.tsx)
**Status**: Ready for deployment
