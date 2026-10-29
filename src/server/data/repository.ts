/**
 * Typed repository over one Firestore collection.
 *
 * - Every read is parsed through the collection's zod schema; a malformed
 *   document throws `DataIntegrityError` instead of flowing on as `any`.
 * - Every write is validated against the same schema, and stamped with
 *   `createdAt` / `updatedAt` server timestamps.
 * - User-data collections carry `ownerUid` (ADR-0007); `listByOwner` is the
 *   standard "all my X" query.
 *
 * Repositories are the only place new server code touches Firestore
 * documents (Phase 4 layering). Transactions use the `*In(tx, ...)` variants.
 */
import {
  FieldValue,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
  type UpdateData,
} from 'firebase-admin/firestore';
import { z } from 'zod';
import { ConflictError, DataIntegrityError, NotFoundError } from '../errors';
import { resolveDb, type DbSource } from './db';

export type WithId<T> = T & { id: string };

const STAMP_KEYS = ['createdAt', 'updatedAt'] as const;
type StampKey = (typeof STAMP_KEYS)[number];

/** What a caller passes to `create`: the stored shape minus timestamps (defaults may be omitted). */
export type CreateInput<S extends z.AnyZodObject> = Omit<z.input<S>, StampKey>;
/** What a caller passes to `update`: any subset of top-level fields, or a FieldValue sentinel. */
export type UpdatePatch<S extends z.AnyZodObject> = {
  [K in Exclude<keyof z.output<S>, StampKey>]?: z.input<S>[K] | FieldValue;
};

export type RepositoryConfig<S extends z.AnyZodObject> = {
  /** Collection path, e.g. `books` or `books/abc/pages`. */
  path: string;
  schema: S;
  /** Human label used in error messages (`Book not found`). */
  label: string;
  /** Immutable collections (renders, ADR-0010) reject `update`. */
  immutable?: boolean;
  db?: DbSource;
};

/** gRPC status codes surfaced by the Admin SDK (and mirrored by the test fake). */
const GRPC_NOT_FOUND = 5;
const GRPC_ALREADY_EXISTS = 6;

function grpcCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'number' ? code : undefined;
}

export class Repository<S extends z.AnyZodObject> {
  private readonly createSchema: z.AnyZodObject;

  constructor(private readonly config: RepositoryConfig<S>) {
    const mask = Object.fromEntries(
      STAMP_KEYS.filter((key) => key in config.schema.shape).map((key) => [key, true])
    );
    this.createSchema = config.schema.omit(mask as never);
  }

  get path(): string {
    return this.config.path;
  }

  get label(): string {
    return this.config.label;
  }

  /** The same repository bound to another Firestore (tests, emulator). */
  using(db: DbSource): Repository<S> {
    return new Repository({ ...this.config, db });
  }

  async db(): Promise<Firestore> {
    return resolveDb(this.config.db);
  }

  async collection(): Promise<CollectionReference> {
    return (await this.db()).collection(this.config.path);
  }

  async ref(id: string): Promise<DocumentReference> {
    return (await this.collection()).doc(id);
  }

  /** A new document reference with an auto id. */
  async newRef(): Promise<DocumentReference> {
    return (await this.collection()).doc();
  }

  /** Parse a snapshot; throws DataIntegrityError when the stored data does not match. */
  parse(snapshot: DocumentSnapshot): WithId<z.output<S>> {
    const result = this.config.schema.safeParse(snapshot.data());
    if (!result.success) {
      console.error(`[repository] ${snapshot.ref.path} failed schema validation`, result.error.issues);
      throw new DataIntegrityError(snapshot.ref.path, result.error.issues);
    }
    return { ...(result.data as z.output<S>), id: snapshot.id };
  }

  private parseOrNull(snapshot: DocumentSnapshot): WithId<z.output<S>> | null {
    return snapshot.exists ? this.parse(snapshot) : null;
  }

  private notFound(id: string): NotFoundError {
    return new NotFoundError(`${this.config.label} not found`, { details: { id } });
  }

  private validateCreate(path: string, data: CreateInput<S>): Record<string, unknown> {
    const result = this.createSchema.safeParse(data);
    if (!result.success) {
      throw new DataIntegrityError(path, result.error.issues);
    }
    const stamps: Record<string, FieldValue> = {};
    for (const key of STAMP_KEYS) {
      if (key in this.config.schema.shape) stamps[key] = FieldValue.serverTimestamp();
    }
    return { ...result.data, ...stamps };
  }

  private validatePatch(path: string, patch: UpdatePatch<S>): Record<string, unknown> {
    if (this.config.immutable) {
      throw new ConflictError(`${this.config.label} documents are immutable`, { code: 'IMMUTABLE' });
    }
    const shape = this.config.schema.shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, unknown> = {};
    const issues: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const field = shape[key];
      if (!field || (STAMP_KEYS as readonly string[]).includes(key)) {
        issues.push({ path: [key], message: 'Unknown or reserved field' });
        continue;
      }
      if (value instanceof FieldValue) {
        out[key] = value;
        continue;
      }
      const result = field.safeParse(value);
      if (result.success) {
        out[key] = result.data;
      } else {
        issues.push(...result.error.issues.map((issue) => ({ ...issue, path: [key, ...issue.path] })));
      }
    }
    if (issues.length > 0) {
      throw new DataIntegrityError(path, issues);
    }
    if ('updatedAt' in shape) out.updatedAt = FieldValue.serverTimestamp();
    return out;
  }

  // ---------------------------------------------------------------------------
  // Plain operations
  // ---------------------------------------------------------------------------

  async get(id: string): Promise<WithId<z.output<S>> | null> {
    return this.parseOrNull(await (await this.ref(id)).get());
  }

  async require(id: string): Promise<WithId<z.output<S>>> {
    const found = await this.get(id);
    if (!found) throw this.notFound(id);
    return found;
  }

  /** Create a document (fails with ConflictError if `id` is taken). Returns the id. */
  async create(data: CreateInput<S>, options: { id?: string } = {}): Promise<string> {
    const ref = options.id ? await this.ref(options.id) : await this.newRef();
    const payload = this.validateCreate(ref.path, data);
    try {
      await ref.create(payload);
    } catch (error) {
      if (grpcCode(error) === GRPC_ALREADY_EXISTS) {
        throw new ConflictError(`${this.config.label} already exists`, { code: 'ALREADY_EXISTS', details: { id: ref.id } });
      }
      throw error;
    }
    return ref.id;
  }

  async update(id: string, patch: UpdatePatch<S>): Promise<void> {
    const ref = await this.ref(id);
    const payload = this.validatePatch(ref.path, patch);
    try {
      await ref.update(payload);
    } catch (error) {
      if (grpcCode(error) === GRPC_NOT_FOUND) throw this.notFound(id);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await (await this.ref(id)).delete();
  }

  /** Equality query on top-level fields. */
  async where(
    filters: Partial<Record<keyof z.output<S> & string, unknown>>,
    options: { limit?: number } = {}
  ): Promise<WithId<z.output<S>>[]> {
    let query: Query = await this.collection();
    for (const [field, value] of Object.entries(filters)) {
      if (value !== undefined) query = query.where(field, '==', value);
    }
    if (options.limit) query = query.limit(options.limit);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => this.parse(doc));
  }

  /** "All my X": the standard owner query (ADR-0007). */
  async listByOwner(ownerUid: string, options: { limit?: number } = {}): Promise<WithId<z.output<S>>[]> {
    return this.where({ ownerUid } as Partial<Record<keyof z.output<S> & string, unknown>>, options);
  }

  // ---------------------------------------------------------------------------
  // Transaction variants (all reads before any write, as Firestore requires)
  // ---------------------------------------------------------------------------

  async getIn(tx: Transaction, id: string): Promise<WithId<z.output<S>> | null> {
    return this.parseOrNull(await tx.get(await this.ref(id)));
  }

  async requireIn(tx: Transaction, id: string): Promise<WithId<z.output<S>>> {
    const found = await this.getIn(tx, id);
    if (!found) throw this.notFound(id);
    return found;
  }

  /** Create inside a transaction; the commit fails if the id is taken. Returns the id. */
  async createIn(tx: Transaction, data: CreateInput<S>, options: { id?: string } = {}): Promise<string> {
    const ref = options.id ? await this.ref(options.id) : await this.newRef();
    tx.create(ref, this.validateCreate(ref.path, data));
    return ref.id;
  }

  async updateIn(tx: Transaction, id: string, patch: UpdatePatch<S>): Promise<void> {
    const ref = await this.ref(id);
    tx.update(ref, this.validatePatch(ref.path, patch) as UpdateData<DocumentData>);
  }
}

export function defineRepository<S extends z.AnyZodObject>(config: RepositoryConfig<S>): Repository<S> {
  return new Repository(config);
}

/**
 * A subcollection under a parent document, e.g. `books/{bookId}/pages`.
 * `pages.of(bookId)` returns a Repository for one parent's subcollection.
 */
export class SubRepository<S extends z.AnyZodObject> {
  constructor(
    private readonly config: Omit<RepositoryConfig<S>, 'path'> & { parent: string; name: string }
  ) {}

  of(parentId: string): Repository<S> {
    const { parent, name, ...rest } = this.config;
    return new Repository({ ...rest, path: `${parent}/${parentId}/${name}` });
  }

  using(db: DbSource): SubRepository<S> {
    return new SubRepository({ ...this.config, db });
  }
}

export function defineSubRepository<S extends z.AnyZodObject>(
  config: Omit<RepositoryConfig<S>, 'path'> & { parent: string; name: string }
): SubRepository<S> {
  return new SubRepository(config);
}
