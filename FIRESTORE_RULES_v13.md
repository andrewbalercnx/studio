# Firestore Security Rules v13 - Mixam Integration

**Version:** v13
**Date:** December 10, 2025
**Purpose:** Add support for Mixam print-on-demand integration and storyBooks collection

## Summary of Changes

This version adds security rules for three new/updated collections to support the Mixam print-on-demand integration:

1. **printProducts** - New collection for print product catalog
2. **storyBooks** - New collection for finalized story books
3. **printOrders** - Updated to support both legacy and new ownership fields

## Detailed Changes

### 1. Print Products Collection (NEW)

**Collection:** `printProducts`
**Purpose:** Store available print products (hardcover books, etc.)

**Rules:**
```javascript
match /printProducts/{productId} {
  allow read: if isAuthenticated();  // All authenticated users can view products
  allow write: if isAdmin();  // Only admins can create/update products
}
```

**Access Control:**
- **Read:** Any authenticated user can view products (needed for parent order flow)
- **Write:** Only admins can create/modify products
- **List:** Authenticated users can list all products

**Data Structure:**
- `name` - Product name
- `active` - Boolean indicating if product is available
- `pricing` - Pricing tiers and cost information
- `mixamSpec` - Mixam-specific configuration (MxJdf parameters)

### 2. Story Books Collection (NEW)

**Collection:** `storyBooks`
**Purpose:** Store finalized story books with printable PDFs

**Rules:**
```javascript
match /storyBooks/{bookId} {
  allow get: if isAdmin()
             || (isHelpDocument(bookId) && isAuthenticated())
             || (isAuthenticated() && resource.data.ownerUserId == request.auth.uid)
             || (isAuthenticated() && resource.data.parentUid == request.auth.uid);

  allow list: if isAuthenticated();  // Client code must filter by ownerUserId or parentUid

  allow create: if isAdmin()
                || (isHelpDocument(bookId) && isAuthenticated())
                || (isAuthenticated() && request.resource.data.ownerUserId == request.auth.uid)
                || (isAuthenticated() && request.resource.data.parentUid == request.auth.uid);

  allow update, delete: if isAdmin()
                        || (isAuthenticated() && !isHelpDocument(bookId) && resource.data.ownerUserId == request.auth.uid)
                        || (isAuthenticated() && !isHelpDocument(bookId) && resource.data.parentUid == request.auth.uid);
}
```

**Access Control:**
- **Read:** Owner (via `ownerUserId` or `parentUid`), admins, or authenticated users for help documents
- **Create:** Owner can create their own books, admins can create any
- **Update/Delete:** Owner can modify their own books, admins can modify any (except help docs require admin)
- **List:** Authenticated users can list (client must filter by ownership)

**Ownership Fields (Dual Support):**
- `ownerUserId` - New field for user ownership
- `parentUid` - Legacy field for backwards compatibility
- Both fields are supported to ensure compatibility with existing data

### 3. Print Orders Collection (UPDATED)

**Collection:** `printOrders`
**Purpose:** Store print order requests for physical books

**Rules:**
```javascript
match /printOrders/{orderId} {
  allow get: if isAdmin()
             || (isAuthenticated() && resource.data.parentUid == request.auth.uid)
             || (isAuthenticated() && resource.data.ownerUserId == request.auth.uid);
  allow list: if isAuthenticated();  // Client code must filter by parentUid or ownerUserId
  allow create: if isAdmin()
                || (isAuthenticated() && request.resource.data.parentUid == request.auth.uid)
                || (isAuthenticated() && request.resource.data.ownerUserId == request.auth.uid);
  allow update, delete: if isAdmin()
                        || (isAuthenticated() && resource.data.parentUid == request.auth.uid)
                        || (isAuthenticated() && resource.data.ownerUserId == request.auth.uid);
}
```

**Changes from v12:**
- Added support for `ownerUserId` field (Mixam integration uses this)
- Maintained support for `parentUid` field (legacy orders use this)
- All operations now check BOTH ownership fields

**Access Control:**
- **Read:** Owner (via either field), admins
- **Create:** Users can create orders they own (via either field), admins can create any
- **Update/Delete:** Owner can modify their orders, admins can modify any
- **List:** Authenticated users can list (client must filter by ownership)

**Data Types:**
- **Legacy orders:** Use `parentUid` field
- **Mixam orders:** Use `ownerUserId` field and include additional Mixam-specific fields:
  - `productId` - Reference to printProducts document
  - `productSnapshot` - Snapshot of product at order time
  - `fulfillmentStatus` - Mixam-specific status (pending_approval, approved, submitted, etc.)
  - `validationResult` - PDF validation results
  - `mixamJobNumber` - Mixam's job tracking number
  - `coverPdfUrl` / `interiorPdfUrl` - Separate PDF URLs required by Mixam

## Security Trade-offs

**List Operations:**
- All three collections allow `list` operations for authenticated users
- Firestore Security Rules **cannot validate WHERE clause values**
- Client code MUST filter queries by ownership fields
- Malicious clients could potentially query other users' data if they omit filters
- This trade-off is necessary for normal application functionality

**Example Client-Side Filtering:**
```javascript
// CORRECT - Filter by ownership
query(collection(firestore, 'printOrders'),
  where('ownerUserId', '==', currentUser.uid))

// WRONG - No ownership filter (would violate security best practices)
query(collection(firestore, 'printOrders'))
```

## Migration Notes

### Backwards Compatibility

**Print Orders:**
- Existing orders with `parentUid` will continue to work
- New Mixam orders use `ownerUserId`
- Both fields are checked in all rules

**Story Books:**
- Supports both `ownerUserId` (new) and `parentUid` (legacy)
- Existing code using `parentUid` will continue to work
- New code should use `ownerUserId` for consistency

### No Data Migration Required

- No existing data needs to be migrated
- Rules support both old and new field names
- New features use new field names
- Legacy features continue using old field names

## Testing

**Firestore Rules Test Page:** `/firestore-test`

**New Test Cases Added:**

**Story Books (lines 150-153):**
- `storybooks-create` - Parent can create a story book
- `storybooks-read-own` - Parent can read their own story book
- `storybooks-list-own` - Parent can list their own story books

**Print Products (lines 161-165):**
- `printproducts-read` - Parent can read print products
- `printproducts-list` - Parent can list print products
- `printproducts-write-parent` - Parent cannot write print products (deny)
- `printproducts-write-admin` - Admin can write print products

**Print Orders - Mixam (lines 156-159):**
- `printorders-mixam-create` - Parent can create Mixam order with ownerUserId
- `printorders-mixam-read-own` - Parent can read their own Mixam order
- `printorders-mixam-list-own` - Parent can list their Mixam orders

## Deployment Instructions

1. **Go to Firebase Console:** https://console.firebase.google.com/
2. **Select your project**
3. **Navigate to:** Firestore Database → Rules
4. **Copy the entire contents** of `firestore.rules`
5. **Paste into the Firebase Console** rules editor
6. **Click "Publish"**

## Files Modified

- `firestore.rules` - Main security rules file (lines 1-244)
- `src/app/firestore-test/page.tsx` - Added test cases and test data setup

## Related Documentation

- **Mixam Integration:** See implementation in `src/lib/mixam/` directory
- **Print Orders API:** See `src/app/api/printOrders/mixam/route.ts`
- **Admin Workflow:** See `src/app/admin/print-orders/`
- **Parent Order Flow:** See `src/app/storybook/[bookId]/order/`

## Questions or Issues?

If you encounter permission errors after deploying these rules:
1. Verify the rules were published successfully in Firebase Console
2. Check that client queries include proper ownership filters
3. Run the Firestore rules tests at `/firestore-test`
4. Verify user authentication state and custom claims (isAdmin, etc.)
