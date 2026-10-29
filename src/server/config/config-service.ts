/**
 * One typed config loader with one cache, replacing the copy-pasted
 * `src/lib/*-config.server.ts` pattern (module-level cache + TTL + defaults).
 *
 * Semantics kept from those loaders:
 *   - the document is shallow-merged over in-code defaults;
 *   - a missing document means "use the defaults";
 *   - a Firestore read error never throws to callers: defaults are returned and
 *     NOT cached, so the next call retries;
 *   - entries expire after a short TTL (60 s by default).
 * Added:
 *   - the merged value is parsed with the definition's zod schema; a malformed
 *     document logs an error and yields the defaults (cached for the TTL so a
 *     bad document does not cost a read per call);
 *   - explicit invalidation of one definition or of everything (call it after
 *     an admin write);
 *   - concurrent callers share one in-flight read.
 */
import type { z } from 'zod';
import { resolveDb, type DbSource } from '../data/db';

export type ConfigDefinition<S extends z.AnyZodObject = z.AnyZodObject> = {
  /** Firestore document path, e.g. `config/aiModels`. One definition per path. */
  path: string;
  schema: S;
  defaults: z.output<S>;
  /** Overrides the service's default TTL. */
  ttlMs?: number;
};

export function defineConfig<S extends z.AnyZodObject>(definition: ConfigDefinition<S>): ConfigDefinition<S> {
  return definition;
}

type CacheEntry = { value: unknown; expiresAt: number };

export type ConfigServiceOptions = {
  db?: DbSource;
  now?: () => number;
  defaultTtlMs?: number;
};

export const DEFAULT_CONFIG_TTL_MS = 60_000;

export class ConfigService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  /** Bumped on invalidation so a read that started earlier does not repopulate the cache. */
  private readonly generations = new Map<string, number>();
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

  constructor(private readonly options: ConfigServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_CONFIG_TTL_MS;
  }

  async get<S extends z.AnyZodObject>(definition: ConfigDefinition<S>): Promise<z.output<S>> {
    const cached = this.cache.get(definition.path);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value as z.output<S>;
    }
    const pending = this.inflight.get(definition.path);
    if (pending) return pending as Promise<z.output<S>>;

    const read: Promise<z.output<S>> = this.load(definition).finally(() => {
      if (this.inflight.get(definition.path) === read) this.inflight.delete(definition.path);
    });
    this.inflight.set(definition.path, read);
    return read;
  }

  /** Drop one definition's cached value (by definition or path), or everything. */
  invalidate(target?: ConfigDefinition | string): void {
    const paths = target === undefined ? [...new Set([...this.cache.keys(), ...this.inflight.keys()])] : [typeof target === 'string' ? target : target.path];
    for (const path of paths) {
      this.cache.delete(path);
      this.inflight.delete(path);
      this.generations.set(path, (this.generations.get(path) ?? 0) + 1);
    }
  }

  private async load<S extends z.AnyZodObject>(definition: ConfigDefinition<S>): Promise<z.output<S>> {
    const generation = this.generations.get(definition.path) ?? 0;
    let raw: Record<string, unknown> | undefined;
    try {
      const db = await resolveDb(this.options.db);
      const snapshot = await db.doc(definition.path).get();
      raw = snapshot.exists ? snapshot.data() : undefined;
    } catch (error) {
      console.error(`[config] Failed to read ${definition.path}; using defaults`, error);
      return definition.defaults;
    }

    let value: z.output<S> = definition.defaults;
    if (raw) {
      const parsed = definition.schema.safeParse({ ...definition.defaults, ...raw });
      if (parsed.success) {
        value = parsed.data;
      } else {
        console.error(`[config] ${definition.path} does not match its schema; using defaults`, parsed.error.issues);
      }
    }

    if ((this.generations.get(definition.path) ?? 0) === generation) {
      this.cache.set(definition.path, { value, expiresAt: this.now() + (definition.ttlMs ?? this.defaultTtlMs) });
    }
    return value;
  }
}

/** The process-wide config service. */
export const configService = new ConfigService();

export function getConfig<S extends z.AnyZodObject>(definition: ConfigDefinition<S>): Promise<z.output<S>> {
  return configService.get(definition);
}

export function invalidateConfig(target?: ConfigDefinition | string): void {
  configService.invalidate(target);
}
