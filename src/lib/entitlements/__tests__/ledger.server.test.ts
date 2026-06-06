import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the admin-SDK seams so the server module runs against an in-memory fake store.
vi.mock('@/lib/server-firestore', () => ({ getServerFirestore: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__' },
}));

import { getServerFirestore } from '@/lib/server-firestore';
import { checkEntitlement, consumeEntitlement } from '@/lib/entitlements/ledger.server';

type Doc = Record<string, any> | undefined;

/** Minimal Firestore double: path-keyed docs + a transaction that mutates the same store. */
function makeFirestore(initial: Record<string, Doc> = {}) {
  const store: Record<string, Doc> = { ...initial };
  const writes: Array<{ path: string; data: any; merge: boolean }> = [];

  const makeRef = (path: string) => ({
    path,
    get: async () => ({ exists: store[path] !== undefined, data: () => store[path] }),
  });

  return {
    doc: (path: string) => makeRef(path),
    collection: (name: string) => ({ doc: (id: string) => makeRef(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (ref: any) => ({
          exists: store[ref.path] !== undefined,
          data: () => store[ref.path],
        }),
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          writes.push({ path: ref.path, data, merge: !!opts?.merge });
          store[ref.path] = { ...(store[ref.path] ?? {}), ...data };
        },
      };
      return fn(tx);
    },
    __store: store,
    __writes: writes,
  };
}

const LEDGER = (uid: string) => `entitlementLedgers/${uid}`;

beforeEach(() => {
  vi.mocked(getServerFirestore).mockReset();
});

describe('consumeEntitlement — atomic check-and-decrement', () => {
  it('seeds the free tier and consumes for a brand-new family', async () => {
    const fs = makeFirestore({});
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await consumeEntitlement('p1', 'story_allowance', { parentUid: 'p1' });

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0); // free tier = 1 story, now used
    // A doc was created (createdAt stamped) and the decrement persisted.
    const written = fs.__store[LEDGER('p1')]!;
    expect(written.freeTierGranted).toBe(true);
    expect(written.createdAt).toBe('__TS__');
    expect(written.family.story_allowance.used).toBe(1);
  });

  it('denies and does not write once an already-seeded allowance is exhausted', async () => {
    const fs = makeFirestore({
      [LEDGER('p1')]: {
        family: { story_allowance: { allowance: 1, used: 1, reset: 'lifetime' } },
        freeTierGranted: true,
      },
    });
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await consumeEntitlement('p1', 'story_allowance', { parentUid: 'p1' });

    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.reason).toContain('insufficient');
    expect(fs.__writes).toHaveLength(0); // nothing seeded, nothing decremented
  });

  it('decrements a partially-used family quota and persists the new usage', async () => {
    const fs = makeFirestore({
      [LEDGER('p1')]: {
        family: { story_allowance: { allowance: 3, used: 1, reset: 'lifetime' } },
        freeTierGranted: true,
      },
    });
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await consumeEntitlement('p1', 'story_allowance', { parentUid: 'p1' });

    expect(r.allowed).toBe(true);
    expect(r.source).toBe('family');
    expect(r.remaining).toBe(1);
    expect(fs.__store[LEDGER('p1')]!.family.story_allowance.used).toBe(2);
    expect(fs.__writes).toHaveLength(1);
    expect(fs.__writes[0].merge).toBe(true);
  });

  it('charges the child pool first when a childId is given', async () => {
    const fs = makeFirestore({
      [LEDGER('p1')]: {
        family: { story_allowance: { allowance: 5, used: 0, reset: 'per_period' } },
        children: { c1: { story_allowance: { allowance: 2, used: 0, reset: 'per_period' } } },
        freeTierGranted: true,
      },
    });
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await consumeEntitlement('p1', 'story_allowance', { parentUid: 'p1', childId: 'c1' });

    expect(r.allowed).toBe(true);
    expect(r.source).toBe('child');
    const stored = fs.__store[LEDGER('p1')]!;
    expect(stored.children.c1.story_allowance.used).toBe(1);
    expect(stored.family.story_allowance.used).toBe(0); // family untouched
  });
});

describe('checkEntitlement — read-only pre-flight', () => {
  it('reports the free-tier allowance for a new family without writing', async () => {
    const fs = makeFirestore({});
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await checkEntitlement('p1', 'storybook_allowance', { parentUid: 'p1' });

    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2); // free tier = 2 storybooks
    expect(fs.__writes).toHaveLength(0);
    expect(fs.__store[LEDGER('p1')]).toBeUndefined();
  });

  it('denies when the stored allowance is used up', async () => {
    const fs = makeFirestore({
      [LEDGER('p1')]: {
        family: { storybook_allowance: { allowance: 2, used: 2, reset: 'lifetime' } },
        freeTierGranted: true,
      },
    });
    vi.mocked(getServerFirestore).mockResolvedValue(fs as any);

    const r = await checkEntitlement('p1', 'storybook_allowance', { parentUid: 'p1' });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});
