import { z } from 'zod';
import { ConflictError, withRoute } from '@/server/http';
import { getJobRunner } from '@/server/jobs';

/**
 * POST /api/internal/jobs/run — called by Cloud Tasks, one task per job attempt.
 *
 * Auth: Cloud Tasks OIDC token for the job invoker service account only
 * (`withRoute({ auth: 'internal' })`); user tokens are rejected.
 *
 * Responses (Cloud Tasks retries any non-2xx):
 *   200 { ok: true, data: { outcome, ... } }  the delivery was handled — including
 *       handler failures, which the runner records and retries itself
 *   409 LEASE_HELD                            another runner holds the lease; redeliver later
 */
export const POST = withRoute(
  { auth: 'internal', name: 'internal/jobs/run', body: z.object({ jobId: z.string().min(1) }) },
  async ({ body }) => {
    const result = await getJobRunner().runJob(body.jobId);
    if (result.outcome === 'busy') {
      throw new ConflictError('Job is leased by another runner', { code: 'LEASE_HELD', details: result });
    }
    return result;
  }
);
