import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const body: Record<string, unknown> = {
        status: 'ok',
        commit: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ?? 'unknown',
        timestamp: new Date().toISOString(),
    };

    if (process.env.ENABLE_DEV_LOGS === 'true') {
        const { getRecentLogs } = await import('@/lib/dev-log-buffer');
        body.recentLogs = getRecentLogs();
    }

    return NextResponse.json(body);
}
