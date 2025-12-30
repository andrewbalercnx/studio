import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fix double slashes in URL path (e.g., //api-documentation -> /api-documentation)
  // This prevents SecurityError when Next.js tries to use history.replaceState
  // with malformed URLs
  if (pathname.includes('//')) {
    const cleanPath = pathname.replace(/\/+/g, '/');
    const url = request.nextUrl.clone();
    url.pathname = cleanPath;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except static files and API routes
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
