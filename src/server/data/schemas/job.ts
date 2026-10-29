import { z } from 'zod';
import { jobStatusSchema, ownerFields, stampFields, timestampSchema } from './common';

/** Job kinds from pipeline.md. Phase 5 slices register a handler for each. */
export const JOB_KINDS = [
  'likeness.describe',
  'likeness.portrait',
  'story.finish',
  'manuscript.paginate',
  'manuscript.narrate',
  'book.castSheet',
  'book.pageArt',
  'book.render',
  'order.submit',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const jobTargetSchema = z.object({
  collection: z.string().min(1),
  id: z.string().min(1),
  subpath: z.string().min(1).optional(),
});
export type JobTarget = z.infer<typeof jobTargetSchema>;

export const jobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
});
export type JobError = z.infer<typeof jobErrorSchema>;

/** `jobs/{jobId}`: the one unit-of-work record (pipeline.md, ADR-0003). Server-written only. */
export const jobSchema = z.object({
  ...ownerFields,
  jobId: z.string().min(1),
  /** A registered kind; typed as string so the registry, not the schema, owns the list. */
  kind: z.string().min(1),
  target: jobTargetSchema,
  /** Handler input. Part of what the idempotency key is derived from. */
  input: z.record(z.unknown()).default({}),
  status: jobStatusSchema,
  /** Attempts started so far (incremented when a runner takes the lease). */
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  leaseUntil: timestampSchema.nullable().default(null),
  error: jobErrorSchema.nullable().default(null),
  /** Fan-in: the coordinator job waiting on this one. */
  parentJobId: z.string().min(1).nullable().default(null),
  idempotencyKey: z.string().min(1),
  /** Set on a coordinator once its children were all terminal and its fan-in ran. */
  fanInCompletedAt: timestampSchema.nullable().default(null),
  startedAt: timestampSchema.nullable().default(null),
  finishedAt: timestampSchema.nullable().default(null),
  ...stampFields,
});
export type Job = z.infer<typeof jobSchema>;

export const TERMINAL_JOB_STATUSES = new Set<Job['status']>(['succeeded', 'failed', 'cancelled']);
export function isTerminalJobStatus(status: Job['status']): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}
