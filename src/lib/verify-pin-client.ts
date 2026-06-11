'use client';

/**
 * Client helper for POST /api/parent/verify-pin.
 *
 * Exists so every surface that checks the parent PIN (PIN modal, kids PWA
 * setup screen) calls the SAME real endpoint with a bearer token — the kids
 * setup screen used to post to a non-existent /api/user/verify-pin and fall
 * back to accepting a hard-coded "1234", which this helper replaces.
 */

type TokenBearer = { getIdToken: (forceRefresh?: boolean) => Promise<string> };

export type VerifyPinResult = {
  ok: boolean;
  /** HTTP status (0 when the request itself failed). */
  status: number;
  /** Server-provided code, e.g. INCORRECT_PIN, PIN_LOCKED, PIN_NOT_SET. */
  code?: string;
  /** User-safe message suitable for direct display. */
  message: string;
};

export async function verifyParentPin(
  user: TokenBearer | null | undefined,
  pin: string,
): Promise<VerifyPinResult> {
  if (!user) {
    return { ok: false, status: 0, message: 'You need to sign in again.' };
  }
  try {
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/parent/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
      body: JSON.stringify({ pin, idToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) {
      return { ok: true, status: response.status, message: 'PIN verified.' };
    }
    return {
      ok: false,
      status: response.status,
      code: result?.code,
      message: result?.message || 'PIN verification failed. Please try again.',
    };
  } catch {
    // Network/unexpected failure: NEVER fall back to a default PIN.
    return { ok: false, status: 0, message: 'Could not verify PIN. Check your connection and try again.' };
  }
}
