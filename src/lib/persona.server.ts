/**
 * Request-scoped persona plumbing for API routes (Next.js server only).
 *
 * See src/lib/persona.ts for the persona model, cookie format, and the
 * fail-open rule. This module adds:
 *  - secret resolution (PERSONA_COOKIE_SECRET, falling back to
 *    INTERNAL_API_SECRET — the existing Secret Manager-provisioned secret —
 *    so no new secret has to exist for the feature to work in production)
 *  - reading + verifying the cookie from the current request
 *  - the one-call enforcement helper used by every chokepoint route
 */
import { cookies } from 'next/headers';
import {
  PERSONA_COOKIE_NAME,
  PERSONA_MISMATCH_MESSAGE,
  evaluatePersonaScope,
  verifyPersonaCookie,
  type PersonaClaims,
} from './persona';

/**
 * HMAC key for persona cookies. Prefers a dedicated PERSONA_COOKIE_SECRET;
 * falls back to INTERNAL_API_SECRET (already provisioned in Secret Manager and
 * wired through apphosting.yaml). Returns null when neither is configured —
 * cookies then can never be minted nor verified, and every chokepoint
 * fail-opens to legacy behaviour.
 */
export function getPersonaSecret(): string | null {
  return process.env.PERSONA_COOKIE_SECRET || process.env.INTERNAL_API_SECRET || null;
}

/**
 * Read and verify the persona cookie on the current request.
 * Returns null for absent/invalid/expired cookies (fail-open).
 */
export async function readPersonaFromRequest(): Promise<PersonaClaims | null> {
  const secret = getPersonaSecret();
  if (!secret) return null;
  let value: string | undefined;
  try {
    const cookieStore = await cookies();
    value = cookieStore.get(PERSONA_COOKIE_NAME)?.value;
  } catch {
    return null;
  }
  return verifyPersonaCookie(value, secret);
}

export type PersonaEnforcementResult =
  | { ok: true; persona: PersonaClaims | null }
  | { ok: false; status: 403; code: 'PERSONA_SCOPE_MISMATCH'; message: string };

/**
 * Chokepoint helper: reject the request iff a valid child-persona cookie is
 * present for this principal and the request's effective child differs.
 *
 * @param expectedUid       the parent uid the request acts as (verified token
 *                          uid, or the owning parentUid from the target doc on
 *                          legacy unauthenticated routes)
 * @param effectiveChildId  the childId the request would act on (story/session
 *                          doc childId, or request body childId)
 * @param claims            optional verified token claims; admin/writer
 *                          principals are exempt (admin tooling operates
 *                          across children and is not a kid surface)
 *
 * Behaviour matrix (cookie x child):
 *   cookie absent/invalid/expired  -> ok (legacy, mobile-compatible)
 *   cookie valid, different uid    -> ok (not this principal's persona)
 *   cookie valid, no effective child -> ok (nothing to mismatch)
 *   cookie valid, child matches    -> ok
 *   cookie valid, child mismatch   -> 403 PERSONA_SCOPE_MISMATCH
 */
export async function enforcePersonaScope(options: {
  expectedUid: string | null | undefined;
  effectiveChildId: string | null | undefined;
  claims?: Record<string, unknown>;
}): Promise<PersonaEnforcementResult> {
  const { expectedUid, effectiveChildId, claims } = options;
  if (claims && (claims.isAdmin === true || claims.isWriter === true)) {
    return { ok: true, persona: null };
  }
  const persona = await readPersonaFromRequest();
  const decision = evaluatePersonaScope(persona, expectedUid, effectiveChildId);
  if (decision.allowed) {
    return { ok: true, persona };
  }
  return {
    ok: false,
    status: 403,
    code: 'PERSONA_SCOPE_MISMATCH',
    message: PERSONA_MISMATCH_MESSAGE,
  };
}
