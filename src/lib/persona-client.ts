'use client';

/**
 * Client-side persona cookie sync (web surfaces only).
 *
 * Fire-and-forget by design: the persona cookie is a server-side hardening
 * layer, never a UX gate. Entering or switching a child persona must stay
 * frictionless, so failures here are swallowed — the chokepoints fail open to
 * legacy parentUid-only enforcement when no valid cookie is present (see
 * src/lib/persona.ts).
 */

type TokenBearer = { getIdToken: (forceRefresh?: boolean) => Promise<string> };

/**
 * Mirror the active persona to the signed httpOnly cookie.
 *
 * - `childId` set (real profile) → POST /api/persona with the bearer token.
 * - `childId` null, or a `help-*` demo profile (no real child doc) → DELETE
 *   to clear, so a stale cookie can never block the next surface.
 */
export function syncPersonaCookie(user: TokenBearer | null | undefined, childId: string | null): void {
  void (async () => {
    try {
      if (childId && !childId.startsWith('help-') && user) {
        const idToken = await user.getIdToken();
        await fetch('/api/persona', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ childId }),
          keepalive: true,
          cache: 'no-store',
        });
      } else {
        await fetch('/api/persona', { method: 'DELETE', keepalive: true, cache: 'no-store' });
      }
    } catch {
      // Fire-and-forget: enforcement fails open without a cookie.
    }
  })();
}
