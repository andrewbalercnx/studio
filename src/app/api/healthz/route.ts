import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const body: Record<string, unknown> = {
        status: 'ok',
        commit: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ?? 'unknown',
        timestamp: new Date().toISOString(),
    };

    // Recent server log lines carry session/order IDs and error text, so they
    // go only to an admin caller. Probes without a token get the plain status.
    if (process.env.ENABLE_DEV_LOGS === 'true' && request.headers.has('Authorization')) {
        try {
            await requireAdminUser(request);
            const { getRecentLogs } = await import('@/lib/dev-log-buffer');
            body.recentLogs = getRecentLogs();
        } catch {
            // Not an admin: omit the logs, keep the health response.
        }
    }

    return NextResponse.json(body);
}
