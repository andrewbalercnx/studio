import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

/** A Firestore Timestamp as read back by the Admin SDK. */
export const timestampSchema = z.custom<Timestamp>((value) => value instanceof Timestamp, {
  message: 'Expected a Firestore Timestamp',
});

/** `createdAt` / `updatedAt`, stamped by the repository with server timestamps. */
export const stampFields = {
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

/** Every user-data document carries `ownerUid` (ADR-0007). */
export const ownerFields = {
  ownerUid: z.string().min(1),
};

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/**
 * The latest job for a unit of work, denormalised onto the entity it writes so
 * the UI can show progress from one listener (e.g. `BookPage.artJob`). The Job
 * document stays the source of truth.
 */
export const jobSummarySchema = z.object({
  jobId: z.string().min(1),
  status: jobStatusSchema,
});
export type JobSummary = z.infer<typeof jobSummarySchema>;
