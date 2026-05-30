import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { styleSceneExemplarFlow } from '@/ai/flows/style-scene-exemplar-flow';

// Delay between styles in batch mode — rate limit headroom.
// Combined with the 2 s per-tag delay inside the flow, this staggers
// the start of each style's 4 calls to avoid hitting the Gemini image API limit.
const STYLE_DELAY_MS = 5000;

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json({ ok: false, errorMessage: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { styleId, tags } = body as { styleId?: string; tags?: string[] };

    const firestore = getFirestore();

    if (styleId) {
      // Single style — run in foreground (4 tags × ~30s each = up to ~2 min)
      const result = await styleSceneExemplarFlow({ styleId, tags });
      return NextResponse.json(result);
    }

    // Batch mode — collect all style IDs then process sequentially in background
    const stylesSnap = await firestore.collection('imageStyles').get();
    const styleIds = stylesSnap.docs.map(d => d.id);

    if (styleIds.length === 0) {
      return NextResponse.json({ ok: true, dispatched: 0, message: 'No styles found' });
    }

    // Fire background job — sequential with per-style delay to respect rate limits.
    // Each style processes 4 tags with a 2 s gap inside the flow; we add a further
    // STYLE_DELAY_MS gap between styles so calls never overlap.
    (async () => {
      for (let i = 0; i < styleIds.length; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, STYLE_DELAY_MS));
        }
        try {
          await styleSceneExemplarFlow({ styleId: styleIds[i] });
        } catch (e: any) {
          console.error(`[generateSceneExemplars] Batch error for style ${styleIds[i]}:`, e?.message ?? e);
        }
      }
      console.log(`[generateSceneExemplars] Batch complete — processed ${styleIds.length} styles`);
    })().catch(e => console.error('[generateSceneExemplars] Batch runner error:', e?.message ?? e));

    return NextResponse.json({
      ok: true,
      dispatched: styleIds.length,
      message: `Generating scene exemplars for ${styleIds.length} style(s) in background. Results will appear as each style completes.`,
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: error.message }, { status: error.status });
    }
    console.error('[generateSceneExemplars] Error:', error);
    return NextResponse.json({ ok: false, errorMessage: 'Internal server error' }, { status: 500 });
  }
}
