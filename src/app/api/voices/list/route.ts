import { NextResponse } from 'next/server';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

// Allow up to 60 seconds for the API call
export const maxDuration = 60;

type VoiceInfo = {
  id: string;
  name: string;
  description?: string;
  accent?: string;
  labels?: Record<string, string>;
  category?: string;
};

/**
 * API route for listing available ElevenLabs voices.
 * Supports searching for voices by accent (e.g., "british").
 */
export async function GET(request: Request) {
  try {
    await requireParentOrAdminUser(request);

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || 'british';
    const category = searchParams.get('category') || 'premade';

    console.log('[api/voices/list] Searching for voices:', { search, category });

    // Check for API key before initializing client
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/voices/list] ELEVENLABS_API_KEY environment variable not set');
      return NextResponse.json(
        { ok: false, errorMessage: 'Voice service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey,
    });

    // Fetch voices using the v2 API with search
    // Use timeout for reliability
    console.log('[api/voices/list] Calling ElevenLabs API...');
    const response = await elevenlabs.voices.search(
      {
        search,
        category: category as 'premade' | 'cloned' | 'generated' | 'professional',
        pageSize: 50,
      },
      {
        timeoutInSeconds: 30,
      }
    );
    console.log('[api/voices/list] Got response with', response.voices?.length ?? 0, 'voices');

    // Extract voice information
    const voices: VoiceInfo[] = response.voices.map((voice) => ({
      id: voice.voiceId,
      name: voice.name ?? 'Unknown',
      description: voice.description ?? undefined,
      accent: voice.labels?.accent ?? undefined,
      labels: voice.labels ?? undefined,
      category: voice.category ?? undefined,
    }));

    return NextResponse.json({
      ok: true,
      search,
      category,
      count: voices.length,
      voices,
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    console.error('[api/voices/list] Error:', e);
    return NextResponse.json(
      { ok: false, errorMessage: e.message || 'Failed to list voices' },
      { status: 500 }
    );
  }
}
