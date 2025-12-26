import { NextResponse } from 'next/server';
import { getKidsFlowConfig } from '@/lib/kids-flow-config.server';

/**
 * GET: Fetch the enabled kids flows (public endpoint)
 * Returns which story generation flows are enabled for the /kids endpoint.
 * This is a public endpoint but only returns boolean flags, no sensitive data.
 */
export async function GET() {
  try {
    const config = await getKidsFlowConfig();

    return NextResponse.json({
      ok: true,
      flows: {
        wizard: config.wizardEnabled,
        chat: config.chatEnabled,
        gemini3: config.gemini3Enabled,
        gemini4: config.gemini4Enabled,
      },
    });

  } catch (error: any) {
    console.error('[kids-flows] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
