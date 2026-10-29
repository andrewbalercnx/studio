/**
 * A small in-memory Firestore for unit tests of the server foundations.
 *
 * Supports what the repositories, config service and job runner use: document
 * get/create/set/update/delete, collections with equality `where` + `limit`,
 * `getAll`, and serialised transactions that (like the real SDK) reject reads
 * after writes. `FieldValue.serverTimestamp()` resolves to the fake clock and
 * `FieldValue.delete()` removes the field. Errors carry the gRPC codes the
 * Admin SDK uses (5 NOT_FOUND, 6 ALREADY_EXISTS).
 *
 * Cast to `Firestore` at the call site: `fake.asFirestore()`.
 */
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

type Data = Record<string, unknown>;

class GrpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

const SERVER_TIMESTAMP = FieldValue.serverTimestamp();
const DELETE = FieldValue.delete();

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object' && !(value instanceof Timestamp) && !(value instanceof FieldValue)) {
    return Object.fromEntries(Object.entries(value as Data).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

export class FakeFirestore {
  readonly store = new Map<string, Data>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(readonly now: () => number = Date.now) {}

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  collection(path: string): FakeCollection {
    return new FakeCollection(this, path);
  }

  doc(path: string): FakeDocRef {
    const index = path.lastIndexOf('/');
    return new FakeDocRef(this, path.slice(0, index), path.slice(index + 1));
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    return refs.map((ref) => this.snapshot(ref));
  }

  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      tx.commit();
      return result;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  // -- internals ---------------------------------------------------------------

  snapshot(ref: FakeDocRef): FakeSnapshot {
    const data = this.store.get(ref.path);
    return new FakeSnapshot(ref, data ? clone(data) : undefined);
  }

  resolve(value: unknown): unknown {
    if (value instanceof FieldValue) {
      if (value.isEqual(SERVER_TIMESTAMP)) return Timestamp.fromMillis(this.now());
      throw new Error('FakeFirestore: unsupported FieldValue');
    }
    if (Array.isArray(value)) return value.map((v) => this.resolve(v));
    if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
      const out: Data = {};
      for (const [k, v] of Object.entries(value as Data)) {
        if (v instanceof FieldValue && v.isEqual(DELETE)) continue;
        if (v !== undefined) out[k] = this.resolve(v);
      }
      return out;
    }
    return value;
  }

  write(op: 'create' | 'set' | 'update' | 'delete', ref: FakeDocRef, data?: Data, options?: { merge?: boolean }): void {
    const existing = this.store.get(ref.path);
    switch (op) {
      case 'create':
        if (existing) throw new GrpcError(6, `ALREADY_EXISTS: ${ref.path}`);
        this.store.set(ref.path, this.resolve(data) as Data);
        return;
      case 'set':
        if (options?.merge && existing) {
          this.store.set(ref.path, mergeDeep(existing, this.resolveMerge(data!)));
        } else {
          this.store.set(ref.path, this.resolve(data) as Data);
        }
        return;
      case 'update': {
        if (!existing) throw new GrpcError(5, `NOT_FOUND: ${ref.path}`);
        const next = clone(existing);
        for (const [key, value] of Object.entries(data!)) {
          setPath(next, key.split('.'), value instanceof FieldValue && value.isEqual(DELETE) ? DELETE : this.resolve(value));
        }
        this.store.set(ref.path, next);
        return;
      }
      case 'delete':
        this.store.delete(ref.path);
        return;
    }
  }

  private resolveMerge(data: Data): Data {
    const out: Data = {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue && v.isEqual(DELETE)) out[k] = DELETE;
      else if (v !== undefined) out[k] = this.resolve(v);
    }
    return out;
  }

  docsIn(collectionPath: string): FakeDocRef[] {
    const prefix = `${collectionPath}/`;
    return [...this.store.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .sort()
      .map((path) => this.doc(path));
  }
}

function setPath(target: Data, path: string[], value: unknown): void {
  let node = target;
  for (const segment of path.slice(0, -1)) {
    if (!node[segment] || typeof node[segment] !== 'object') node[segment] = {};
    node = node[segment] as Data;
  }
  const last = path[path.length - 1];
  if (value === DELETE) delete node[last];
  else node[last] = value;
}

function mergeDeep(base: Data, patch: Data): Data {
  const out = clone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && out[k] && typeof out[k] === 'object') {
      out[k] = mergeDeep(out[k] as Data, v as Data);
    } else out[k] = v;
  }
  return out;
}

export class FakeSnapshot {
  constructor(
    readonly ref: FakeDocRef,
    private readonly value: Data | undefined
  ) {}
  get exists(): boolean {
    return this.value !== undefined;
  }
  get id(): string {
    return this.ref.id;
  }
  data(): Data | undefined {
    return this.value ? clone(this.value) : undefined;
  }
  get(field: string): unknown {
    return field.split('.').reduce<unknown>((node, key) => (node as Data | undefined)?.[key], this.value);
  }
}

let autoId = 0;

export class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly parentPath: string,
    readonly id: string
  ) {}
  get path(): string {
    return `${this.parentPath}/${this.id}`;
  }
  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }
  async get(): Promise<FakeSnapshot> {
    return this.db.snapshot(this);
  }
  async create(data: Data): Promise<void> {
    this.db.write('create', this, data);
  }
  async set(data: Data, options?: { merge?: boolean }): Promise<void> {
    this.db.write('set', this, data, options);
  }
  async update(data: Data): Promise<void> {
    this.db.write('update', this, data);
  }
  async delete(): Promise<void> {
    this.db.write('delete', this);
  }
}

type Filter = { field: string; op: '==' | 'in'; value: unknown };

export class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    readonly path: string,
    protected readonly filters: Filter[] = [],
    protected readonly max?: number
  ) {}
  where(field: string, op: '==' | 'in', value: unknown): FakeQuery {
    if (op !== '==' && op !== 'in') throw new Error(`FakeFirestore: unsupported operator ${op}`);
    return new FakeQuery(this.db, this.path, [...this.filters, { field, op, value }], this.max);
  }
  limit(max: number): FakeQuery {
    return new FakeQuery(this.db, this.path, this.filters, max);
  }
  async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean; size: number }> {
    return this.run();
  }
  run(): { docs: FakeSnapshot[]; empty: boolean; size: number } {
    let docs = this.db
      .docsIn(this.path)
      .map((ref) => this.db.snapshot(ref))
      .filter((snap) =>
        this.filters.every(({ field, op, value }) => {
          const actual = snap.get(field);
          return op === '==' ? actual === value : (value as unknown[]).includes(actual);
        })
      );
    if (this.max !== undefined) docs = docs.slice(0, this.max);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export class FakeCollection extends FakeQuery {
  get id(): string {
    return this.path.slice(this.path.lastIndexOf('/') + 1);
  }
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.db, this.path, id ?? `auto${++autoId}`);
  }
  async add(data: Data): Promise<FakeDocRef> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

export class FakeTransaction {
  private readonly writes: Array<() => void> = [];

  constructor(private readonly db: FakeFirestore) {}

  private assertNoWrites(): void {
    if (this.writes.length > 0) {
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
    }
  }

  async get(target: FakeDocRef | FakeQuery): Promise<FakeSnapshot & { docs: FakeSnapshot[] }> {
    this.assertNoWrites();
    if (target instanceof FakeDocRef) return this.db.snapshot(target) as FakeSnapshot & { docs: FakeSnapshot[] };
    return target.run() as unknown as FakeSnapshot & { docs: FakeSnapshot[] };
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    this.assertNoWrites();
    return refs.map((ref) => this.db.snapshot(ref));
  }

  create(ref: FakeDocRef, data: Data): this {
    this.writes.push(() => this.db.write('create', ref, data));
    return this;
  }
  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }): this {
    this.writes.push(() => this.db.write('set', ref, data, options));
    return this;
  }
  update(ref: FakeDocRef, data: Data): this {
    this.writes.push(() => this.db.write('update', ref, data));
    return this;
  }
  delete(ref: FakeDocRef): this {
    this.writes.push(() => this.db.write('delete', ref));
    return this;
  }

  /** Apply all buffered writes; a failing write aborts the rest (no partial rollback needed in tests). */
  commit(): void {
    const snapshot = new Map(this.db.store);
    try {
      for (const write of this.writes) write();
    } catch (error) {
      this.db.store.clear();
      for (const [k, v] of snapshot) this.db.store.set(k, v);
      throw error;
    }
  }
}
