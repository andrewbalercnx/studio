'use client';

import { getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

function isOwnApiRoute(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * `fetch` that attaches the signed-in user's Firebase ID token
 * (`Authorization: Bearer <token>`) to this app's own `/api/` routes.
 * Any other URL is fetched unchanged, so the token never leaves the origin.
 * A header the caller already set is left alone. With nobody signed in the
 * request goes out without a token and a protected route answers 401.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!isOwnApiRoute(input)) {
    return fetch(input, init);
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    const user = getApps().length > 0 ? getAuth().currentUser : null;
    if (user) {
      headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    }
  }
  return fetch(input, { ...init, headers });
}
