import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
import { initFirebaseAdminApp } from '@/firebase/admin/app';

export interface AuthResult {
  valid: boolean;
  uid: string | null;
  error?: string;
}

/**
 * Extract Bearer token from Authorization header
 */
async function extractBearerToken(): Promise<string | null> {
  const headerList = await headers();
  const authorization = headerList.get('Authorization') ?? headerList.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.split('Bearer ')[1];
  }
  return null;
}

/**
 * Extract token from query string (fallback)
 */
function extractQueryToken(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('idToken');
  } catch {
    return null;
  }
}

/**
 * Verify Firebase ID token and return user ID
 */
export async function verifyAuthToken(request: Request): Promise<AuthResult> {
  try {
    await initFirebaseAdminApp();

    // Try header token first, then query string
    const headerToken = await extractBearerToken();
    const queryToken = extractQueryToken(request);
    const token = headerToken || queryToken;

    if (!token) {
      return { valid: false, uid: null, error: 'MISSING_TOKEN' };
    }

    const decodedToken = await auth().verifyIdToken(token);
    return { valid: true, uid: decodedToken.uid };
  } catch (error: any) {
    console.error('[verifyAuthToken] Error:', error?.code, error?.message);
    return {
      valid: false,
      uid: null,
      error: error?.code || 'TOKEN_VERIFY_FAILED',
    };
  }
}

/**
 * Get the user ID from a request, or null if not authenticated
 */
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const result = await verifyAuthToken(request);
  return result.uid;
}
