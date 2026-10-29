import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { books } from '../../data/repositories';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors';
import { FakeFirestore } from '../../testing/fake-firestore';
import type { VerifiedUser } from '../auth';
import { assertOwner, loadOwned } from '../ownership';

function user(uid: string, claims: Record<string, unknown> = {}): VerifiedUser {
  return { uid, email: null, claims: { uid, ...claims } as unknown as VerifiedUser['claims'] };
}

beforeEach(() => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
});

describe('assertOwner', () => {
  it('allows the owner and checks the persona with the token uid and doc child', async () => {
    await expect(assertOwner(user('u1'), { ownerUid: 'u1', childId: 'c1' }, 'Book')).resolves.toBeUndefined();
    expect(enforcePersonaScope).toHaveBeenCalledWith(expect.objectContaining({ expectedUid: 'u1', effectiveChildId: 'c1' }));
  });

  it('rejects another family, and treats a missing ownerUid as not owned', async () => {
    await expect(assertOwner(user('u2'), { ownerUid: 'u1' }, 'Book')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertOwner(user('u1'), {}, 'Book')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('ignores legacy owner fields', async () => {
    await expect(assertOwner(user('u1'), { parentUid: 'u1' } as never, 'Story')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('exempts admin and writer principals', async () => {
    await expect(assertOwner(user('a', { isAdmin: true }), { ownerUid: 'u1' })).resolves.toBeUndefined();
    await expect(assertOwner(user('w', { isWriter: true }), { ownerUid: 'u1' })).resolves.toBeUndefined();
  });

  it('surfaces a persona mismatch as 403 with its own code', async () => {
    enforcePersonaScope.mockResolvedValue({ ok: false, status: 403, code: 'PERSONA_SCOPE_MISMATCH', message: 'mismatch' });
    const error = await assertOwner(user('u1'), { ownerUid: 'u1', childId: 'c2' }).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.code).toBe('PERSONA_SCOPE_MISMATCH');
  });
});

describe('loadOwned', () => {
  async function setup() {
    const fake = new FakeFirestore();
    const repo = books.using(fake.asFirestore());
    const id = await repo.create({
      ownerUid: 'u1',
      childId: 'c1',
      manuscriptId: 'm1',
      storyId: 's1',
      styleId: 'watercolour',
      layoutId: 'square-24',
      status: 'draft',
    });
    return { repo, id };
  }

  it('returns the parsed document for its owner', async () => {
    const { repo, id } = await setup();
    const book = await loadOwned(user('u1'), repo, id);
    expect(book).toMatchObject({ id, ownerUid: 'u1', status: 'draft', printProductId: null });
  });

  it('maps a missing id to 400, a missing doc to 404 and another owner to 403', async () => {
    const { repo, id } = await setup();
    await expect(loadOwned(user('u1'), repo, undefined)).rejects.toBeInstanceOf(BadRequestError);
    await expect(loadOwned(user('u1'), repo, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(loadOwned(user('u2'), repo, id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
