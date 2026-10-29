import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeFirestore } from '../../testing/fake-firestore';
import { ConfigService, defineConfig } from '../config-service';

const kidsConfig = defineConfig({
  path: 'systemConfig/kids',
  schema: z.object({ enabled: z.boolean(), maxPages: z.number().int() }),
  defaults: { enabled: true, maxPages: 12 },
});

let now: number;
let fake: FakeFirestore;
let reads: number;
let service: ConfigService;

function countingDb() {
  const db = fake.asFirestore();
  return {
    doc: (path: string) => {
      const ref = db.doc(path);
      return {
        get: async () => {
          reads += 1;
          return ref.get();
        },
      };
    },
  } as unknown as typeof db;
}

beforeEach(() => {
  now = 0;
  reads = 0;
  fake = new FakeFirestore();
  service = new ConfigService({ db: countingDb(), now: () => now, defaultTtlMs: 60_000 });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ConfigService', () => {
  it('returns defaults when the document is missing', async () => {
    await expect(service.get(kidsConfig)).resolves.toEqual({ enabled: true, maxPages: 12 });
  });

  it('merges the document over defaults and drops unknown fields', async () => {
    fake.store.set('systemConfig/kids', { maxPages: 24, legacy: 'x' });
    await expect(service.get(kidsConfig)).resolves.toEqual({ enabled: true, maxPages: 24 });
  });

  it('caches for the TTL and re-reads after it', async () => {
    fake.store.set('systemConfig/kids', { maxPages: 16 });
    await service.get(kidsConfig);
    fake.store.set('systemConfig/kids', { maxPages: 24 });
    await expect(service.get(kidsConfig)).resolves.toMatchObject({ maxPages: 16 });
    expect(reads).toBe(1);
    now = 60_001;
    await expect(service.get(kidsConfig)).resolves.toMatchObject({ maxPages: 24 });
    expect(reads).toBe(2);
  });

  it('invalidates one definition, by path, or everything', async () => {
    const other = defineConfig({ path: 'config/other', schema: z.object({ n: z.number() }), defaults: { n: 1 } });
    await service.get(kidsConfig);
    await service.get(other);
    expect(reads).toBe(2);

    fake.store.set('systemConfig/kids', { maxPages: 24 });
    service.invalidate(kidsConfig);
    await expect(service.get(kidsConfig)).resolves.toMatchObject({ maxPages: 24 });
    await service.get(other);
    expect(reads).toBe(3);

    service.invalidate('config/other');
    await service.get(other);
    expect(reads).toBe(4);

    service.invalidate();
    await service.get(kidsConfig);
    await service.get(other);
    expect(reads).toBe(6);
  });

  it('does not let a read that started before invalidation repopulate the cache', async () => {
    fake.store.set('systemConfig/kids', { maxPages: 16 });
    const stale = service.get(kidsConfig);
    service.invalidate(kidsConfig);
    fake.store.set('systemConfig/kids', { maxPages: 24 });
    await stale;
    await expect(service.get(kidsConfig)).resolves.toMatchObject({ maxPages: 24 });
  });

  it('shares one in-flight read between concurrent callers', async () => {
    await Promise.all([service.get(kidsConfig), service.get(kidsConfig), service.get(kidsConfig)]);
    expect(reads).toBe(1);
  });

  it('uses (and caches) defaults for a malformed document', async () => {
    fake.store.set('systemConfig/kids', { maxPages: 'lots' });
    await expect(service.get(kidsConfig)).resolves.toEqual({ enabled: true, maxPages: 12 });
    await service.get(kidsConfig);
    expect(reads).toBe(1);
  });

  it('uses but does not cache defaults when Firestore fails', async () => {
    const failing = new ConfigService({
      db: { doc: () => ({ get: async () => { reads += 1; throw new Error('unavailable'); } }) } as never,
      now: () => now,
    });
    await expect(failing.get(kidsConfig)).resolves.toEqual({ enabled: true, maxPages: 12 });
    await failing.get(kidsConfig);
    expect(reads).toBe(2);
  });
});
