import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('../persona.server', () => ({ enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args) }));
vi.mock('../server-auth', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/firebase/admin/app', () => ({ initFirebaseAdminApp: vi.fn() }));

import { assertOwns, isHelpDocumentId, RouteAuthError, routeAuthErrorResponse } from '../route-auth.server';
import type { VerifiedUser } from '../server-auth';

function user(uid: string, claims: Record<string, unknown> = {}): VerifiedUser {
  return { uid, email: null, claims: { uid, ...claims } as unknown as VerifiedUser['claims'] };
}

async function rejection(promise: Promise<unknown>): Promise<RouteAuthError> {
  try {
    await promise;
  } catch (error) {
    return error as RouteAuthError;
  }
  throw new Error('expected rejection');
}

describe('assertOwns', () => {
  beforeEach(() => {
    enforcePersonaScope.mockReset();
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  });

  it('allows the owner', async () => {
    await expect(assertOwns(user('u1'), { parentUid: 'u1' }, 'parentUid', 'Story')).resolves.toBeUndefined();
  });

  it('rejects another user with 403', async () => {
    const error = await rejection(assertOwns(user('u2'), { parentUid: 'u1' }, 'parentUid', 'Story'));
    expect(error).toBeInstanceOf(RouteAuthError);
    expect(error.status).toBe(403);
  });

  it('treats a missing owner field as not owned', async () => {
    const error = await rejection(assertOwns(user('u1'), {}, 'parentUid', 'Story'));
    expect(error.status).toBe(403);
  });

  it('lets admin and writer principals through', async () => {
    await expect(assertOwns(user('a', { isAdmin: true }), { parentUid: 'u1' }, 'parentUid', 'Story')).resolves.toBeUndefined();
    await expect(assertOwns(user('w', { isWriter: true }), { parentUid: 'u1' }, 'parentUid', 'Story')).resolves.toBeUndefined();
  });

  it('applies the persona scope with the token uid and the doc child', async () => {
    await assertOwns(user('u1'), { parentUid: 'u1', childId: 'c1' }, 'parentUid', 'Story session');
    expect(enforcePersonaScope).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUid: 'u1', effectiveChildId: 'c1' })
    );
  });

  it('surfaces a persona mismatch as its own status and code', async () => {
    enforcePersonaScope.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'PERSONA_SCOPE_MISMATCH',
      message: 'mismatch',
    });
    const error = await rejection(assertOwns(user('u1'), { parentUid: 'u1', childId: 'c2' }, 'parentUid', 'Story'));
    expect(error.code).toBe('PERSONA_SCOPE_MISMATCH');
  });
});

describe('routeAuthErrorResponse', () => {
  it('maps a RouteAuthError to its status, keeping extra envelope fields', async () => {
    const response = routeAuthErrorResponse(new RouteAuthError(401, 'UNAUTHENTICATED', 'Missing ID token'), {
      sessionId: '',
    });
    expect(response?.status).toBe(401);
    const body = await response!.json();
    expect(body).toMatchObject({ ok: false, sessionId: '', code: 'UNAUTHENTICATED', errorMessage: 'Missing ID token' });
  });

  it('returns null for other errors so the route handles them', () => {
    expect(routeAuthErrorResponse(new Error('boom'))).toBeNull();
  });
});

describe('isHelpDocumentId', () => {
  it('matches help-tour sample ids only', () => {
    expect(isHelpDocumentId('help-story')).toBe(true);
    expect(isHelpDocumentId('story-help-1')).toBe(false);
    expect(isHelpDocumentId(undefined)).toBe(false);
  });
});
