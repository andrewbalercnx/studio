import { describe, expect, it } from 'vitest';
import { hasParentAccess } from '../server-auth';

// The Firestore-fallback path in requireParentOrAdminUser is exercised by the
// admin regression page against the emulator; here we pin the pure claim
// logic that decides whether the fallback read is needed at all.
describe('hasParentAccess', () => {
  it('grants on isParent token claim', () => {
    expect(hasParentAccess({ isParent: true })).toBe(true);
  });

  it('grants on isAdmin or isWriter token claims', () => {
    expect(hasParentAccess({ isAdmin: true })).toBe(true);
    expect(hasParentAccess({ isWriter: true })).toBe(true);
  });

  it('denies when no relevant claims are present (real parent tokens today)', () => {
    expect(hasParentAccess({})).toBe(false);
    expect(hasParentAccess({ isParent: undefined })).toBe(false);
  });

  it('requires literal true — truthy strings/numbers do not grant', () => {
    expect(hasParentAccess({ isParent: 'true' as unknown })).toBe(false);
    expect(hasParentAccess({ isAdmin: 1 as unknown })).toBe(false);
  });
});
