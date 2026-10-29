/**
 * Ownership guards for the target model: the owner field is always `ownerUid`
 * (ADR-0007). Same rules as Phase 0's `src/lib/route-auth.server.ts`:
 *
 *   1. a missing owner field is "not yours", never "open";
 *   2. admin and writer principals are exempt (cross-family admin tooling);
 *   3. the child-persona scope is applied with the verified token uid and the
 *      document's `childId`.
 */
import type { z } from 'zod';
import { enforcePersonaScope } from '@/lib/persona.server';
import { BadRequestError, ForbiddenError } from '../errors';
import type { Repository, WithId } from '../data/repository';
import { isPrivileged, type VerifiedUser } from './auth';

export type OwnedData = { ownerUid?: unknown; childId?: unknown };

/** Check an already-loaded document belongs to the caller (and their active persona). */
export async function assertOwner(user: VerifiedUser, data: OwnedData, label = 'resource'): Promise<void> {
  if (!isPrivileged(user) && data.ownerUid !== user.uid) {
    throw new ForbiddenError(`You do not have access to this ${label.toLowerCase()}.`);
  }
  const persona = await enforcePersonaScope({
    expectedUid: user.uid,
    effectiveChildId: typeof data.childId === 'string' ? data.childId : null,
    claims: user.claims as unknown as Record<string, unknown>,
  });
  if (!persona.ok) {
    throw new ForbiddenError(persona.message, { code: persona.code });
  }
}

/**
 * Load a document through its repository (schema-validated) and check the
 * caller owns it. Missing id → 400, missing doc → 404, not owner → 403.
 */
export async function loadOwned<S extends z.AnyZodObject>(
  user: VerifiedUser,
  repo: Repository<S>,
  id: unknown
): Promise<WithId<z.output<S>>> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new BadRequestError(`Missing ${repo.label.toLowerCase()} id`);
  }
  const doc = await repo.require(id);
  await assertOwner(user, doc as OwnedData, repo.label);
  return doc;
}
