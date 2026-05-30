/**
 * Startup back-fill: generate missing scene exemplars for any image style that
 * doesn't yet have all four tags with status='ready'.
 *
 * Called from instrumentation.ts on server start. Fires in the background so
 * it does not delay request handling. Idempotent — subsequent cold starts
 * after all exemplars are ready will find nothing to do and return immediately.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { ImageStyle } from '@/lib/types';
import { SCENE_EXEMPLAR_TAGS } from '@/lib/scene-exemplar-config';
import { styleSceneExemplarFlow } from '@/ai/flows/style-scene-exemplar-flow';

const INTER_STYLE_DELAY_MS = 5000;

export async function backfillMissingSceneExemplars(): Promise<void> {
  try {
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const stylesSnap = await firestore.collection('imageStyles').get();
    if (stylesSnap.empty) {
      console.log('[startup:sceneExemplars] No image styles found — nothing to backfill');
      return;
    }

    // Collect styles that have at least one tag missing or not-ready,
    // and record exactly which tags need generation.
    const work: Array<{ styleId: string; missingTags: string[] }> = [];

    for (const docSnap of stylesSnap.docs) {
      const style = docSnap.data() as ImageStyle;
      const missingTags = SCENE_EXEMPLAR_TAGS.filter(tag => {
        const entry = style.sceneExemplars?.[tag];
        return !entry || entry.status !== 'ready' || !entry.imageUrl;
      });
      if (missingTags.length > 0) {
        work.push({ styleId: docSnap.id, missingTags });
      }
    }

    if (work.length === 0) {
      console.log('[startup:sceneExemplars] All styles up to date — nothing to backfill');
      return;
    }

    console.log(
      `[startup:sceneExemplars] Back-filling ${work.length} style(s):`,
      work.map(w => `${w.styleId} (${w.missingTags.join(', ')})`).join('; ')
    );

    // Run in background — caller does not await this
    ;(async () => {
      for (let i = 0; i < work.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, INTER_STYLE_DELAY_MS));
        const { styleId, missingTags } = work[i];
        try {
          await styleSceneExemplarFlow({ styleId, tags: missingTags });
          console.log(`[startup:sceneExemplars] Done ${styleId} (${i + 1}/${work.length})`);
        } catch (e: any) {
          console.error(`[startup:sceneExemplars] Error for style ${styleId}:`, e?.message ?? e);
        }
      }
      console.log('[startup:sceneExemplars] Back-fill complete');
    })().catch(e =>
      console.error('[startup:sceneExemplars] Runner error:', e?.message ?? e)
    );

  } catch (e: any) {
    // Never throw from a startup hook
    console.error('[startup:sceneExemplars] Check failed:', e?.message ?? e);
  }
}
