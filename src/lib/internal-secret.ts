import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison for internal API shared secrets.
 *
 * A plain `===` on attacker-controlled input leaks, through response timing,
 * how many leading characters matched — enough to recover a secret
 * byte-by-byte in theory. `crypto.timingSafeEqual` removes that signal, but it
 * throws on length mismatch (itself a timing leak). Hashing both sides first
 * gives two equal-length digests, so the comparison is always performed and
 * always constant-time regardless of input length.
 *
 * Returns false (never throws) for missing/empty values: an unset expected
 * secret must always deny, not crash.
 */
export function isInternalSecretValid(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
