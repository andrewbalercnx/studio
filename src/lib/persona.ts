/**
 * Persona cookie: signing, verification, and scope evaluation (pure logic).
 *
 * THE MODEL — one Firebase account per family. Children are data, not auth
 * principals. "A child is playing" used to be a purely client-side fiction
 * (React state + localStorage). The persona cookie gives that fiction
 * server-side meaning: when a child persona is entered on a browser surface,
 * the client posts to /api/persona and the server sets a SIGNED httpOnly
 * cookie binding {uid, childId}. Write/generation chokepoints then verify the
 * cookie and reject requests whose effective child does not match the active
 * persona.
 *
 * THE FAIL-OPEN RULE (critical for mobile compatibility) — the mobile app and
 * packages/api-client authenticate with bearer tokens and never carry this
 * cookie. Enforcement therefore only ever applies when a VALID cookie is
 * present: absent, malformed, tampered, or expired cookies mean "behave
 * exactly as before" (parentUid ownership checks only). Cookie present and
 * valid = enforce; anything else = legacy behaviour.
 *
 * This module is pure (node:crypto only, no Next.js imports) so it can be
 * unit-tested directly. The request-scoped cookie plumbing lives in
 * persona.server.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cookie name carrying the signed persona claims. */
export const PERSONA_COOKIE_NAME = 'storypic.persona';

/**
 * Persona lifetime: 30 days. Personas are device-level ("this tablet is
 * Maya's"), not session-level — a kids tablet should stay locked to its child
 * across restarts, mirroring the 30-day-feel of the kids PWA localStorage lock.
 */
export const PERSONA_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const PERSONA_MAX_AGE_MS = PERSONA_MAX_AGE_SECONDS * 1000;

/** Allow small clock skew when validating iat (cookie minted by another instance). */
const IAT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type PersonaClaims = {
  /** The parent's Firebase uid the persona belongs to. */
  uid: string;
  /** The active child profile id. */
  childId: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
};

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function hmacSignature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

/**
 * Serialize + sign persona claims into a cookie value:
 * `base64url(JSON claims) + '.' + base64url(HMAC-SHA256(payload, secret))`.
 */
export function signPersonaCookie(claims: PersonaClaims, secret: string): string {
  const payload = base64UrlEncode(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = base64UrlEncode(hmacSignature(payload, secret));
  return `${payload}.${signature}`;
}

/**
 * Verify a persona cookie value. Returns the claims when the signature is
 * valid and the cookie is within its lifetime; null for ANYTHING else
 * (malformed, tampered, expired, wrong types). Null means fail-open — the
 * caller must fall back to legacy parentUid-only enforcement, never reject.
 */
export function verifyPersonaCookie(
  value: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now(),
): PersonaClaims | null {
  if (!value || !secret) return null;
  const dotIndex = value.indexOf('.');
  if (dotIndex <= 0 || dotIndex === value.length - 1) return null;
  const payload = value.slice(0, dotIndex);
  const providedSig = value.slice(dotIndex + 1);

  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(providedSig, 'base64url');
  } catch {
    return null;
  }
  const expectedBuf = hmacSignature(payload, secret);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const { uid, childId, iat } = claims as Record<string, unknown>;
  if (typeof uid !== 'string' || uid.length === 0) return null;
  if (typeof childId !== 'string' || childId.length === 0) return null;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;

  // Lifetime: reject expired cookies and absurd future iat (beyond clock skew).
  if (nowMs - iat > PERSONA_MAX_AGE_MS) return null;
  if (iat - nowMs > IAT_FUTURE_SKEW_MS) return null;

  return { uid, childId, iat };
}

export type PersonaScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'CHILD_MISMATCH'; personaChildId: string };

/**
 * Decide whether a request is allowed under the active persona.
 *
 * Fail-open by design (see module docs): only a valid persona whose uid
 * matches the request's principal AND whose child differs from the request's
 * effective child is rejected. Every uncertain case behaves as legacy:
 *
 * - persona null (absent/invalid/expired cookie)      -> allowed
 * - expectedUid unknown                               -> allowed
 * - persona.uid !== expectedUid (cookie not for this
 *   principal — e.g. account switch on shared device) -> allowed (legacy)
 * - effectiveChildId unknown (no child scope)         -> allowed
 * - persona.childId === effectiveChildId              -> allowed
 * - persona.childId !== effectiveChildId              -> REJECTED
 */
export function evaluatePersonaScope(
  persona: PersonaClaims | null,
  expectedUid: string | null | undefined,
  effectiveChildId: string | null | undefined,
): PersonaScopeDecision {
  if (!persona) return { allowed: true };
  if (!expectedUid) return { allowed: true };
  if (persona.uid !== expectedUid) return { allowed: true };
  if (!effectiveChildId) return { allowed: true };
  if (persona.childId === effectiveChildId) return { allowed: true };
  return { allowed: false, reason: 'CHILD_MISMATCH', personaChildId: persona.childId };
}

/** User-safe message returned by every chokepoint on a persona scope rejection. */
export const PERSONA_MISMATCH_MESSAGE =
  'This belongs to a different profile. Switch profiles and try again.';
