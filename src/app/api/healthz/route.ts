import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        commit: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ?? 'unknown',
        timestamp: new Date().toISOString(),
    });
}
