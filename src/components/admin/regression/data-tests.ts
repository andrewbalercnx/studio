'use client';

import { collection, getDocs, doc, getDoc, query, where, limit } from 'firebase/firestore';
import type { PromptConfig, ChildProfile, PrintLayout } from '@/lib/types';
import type { RegressionContext } from './context';

/** Regression scenarios run from the admin regression page. */
export async function runDataTests({ firestore, updateTestResult, setDiagnostics }: RegressionContext): Promise<void> {
    if (!firestore) return;
    let fsSummary: any = {};

    // Test: DATA_PROMPTS
    try {
        const promptsRef = collection(firestore, 'promptConfigs');
        const qWarmup = query(promptsRef, where('phase', '==', 'warmup'), limit(1));
        const qBeat = query(promptsRef, where('phase', '==', 'storyBeat'), limit(1));
        const [warmupSnap, beatSnap, allSnap] = await Promise.all([getDocs(qWarmup), getDocs(qBeat), getDocs(promptsRef)]);
        
        fsSummary.promptConfigsCount = allSnap.size;

        if (warmupSnap.empty || beatSnap.empty) {
            throw new Error(`Missing configs: warmup=${warmupSnap.size}, storyBeat=${beatSnap.size}`);
        }
        const promptDoc = beatSnap.docs[0].data();
        if (!promptDoc.id || !promptDoc.model?.name) {
            throw new Error('Beat prompt config missing key fields.');
        }
        updateTestResult('DATA_PROMPTS', { status: 'PASS', message: `Found ${fsSummary.promptConfigsCount} configs, including warmup and storyBeat.` });
    } catch (e: any) {
        updateTestResult('DATA_PROMPTS', { status: 'FAIL', message: e.message });
    }

    // Test: DATA_PROMPTS_STORY_BEAT_LIVE
    try {
      const promptsRef = collection(firestore, 'promptConfigs');
      const q = query(promptsRef, where('phase', '==', 'storyBeat'), where('status', '==', 'live'));
      const snap = await getDocs(q);
      const liveBeatConfigs = snap.docs.map(d => d.data() as PromptConfig);
      fsSummary.storyBeatLiveCount = liveBeatConfigs.length;

      if (liveBeatConfigs.length === 0) {
        throw new Error("No live storyBeat promptConfigs found; at least one is required.");
      }
      
      const lowLevelConfigs = liveBeatConfigs.filter(p => p.levelBand === 'low');
      fsSummary.storyBeatLiveLowCount = lowLevelConfigs.length;

      if (lowLevelConfigs.length === 0) {
          updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'FAIL', message: "Live storyBeat configs exist, but none have levelBand 'low'." });
      } else {
          updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'PASS', message: `Found ${liveBeatConfigs.length} live configs, including ${lowLevelConfigs.length} for levelBand 'low'.` });
      }
    } catch (e: any) {
      updateTestResult('DATA_PROMPTS_STORY_BEAT_LIVE', { status: 'FAIL', message: e.message });
    }


    // Test: DATA_STORY_TYPES
     try {
        const storyTypesRef = collection(firestore, 'storyTypes');
        const snap = await getDocs(storyTypesRef);
        fsSummary.storyTypesCount = snap.size;
        if (snap.empty) throw new Error('Collection is empty.');
        const typeDoc = snap.docs[0].data();
        if (!typeDoc.name || !typeDoc.defaultPhaseId || !typeDoc.arcTemplate?.steps?.length) {
            throw new Error('First story type doc is missing key fields.');
        }
        updateTestResult('DATA_STORY_TYPES', { status: 'PASS', message: `Found ${snap.size} types. First doc OK.` });
     } catch(e: any) {
          updateTestResult('DATA_STORY_TYPES', { status: 'FAIL', message: e.message });
     }

    // Test: DATA_STORY_PHASES
    try {
      const phasesRef = collection(firestore, 'storyPhases');
      const requiredIds = ["warmup_phase_v1", "story_beat_phase_v1", "ending_phase_v1"];
      const docs = await Promise.all(requiredIds.map(id => getDoc(doc(phasesRef, id))));
      fsSummary.storyPhasesCount = (await getDocs(phasesRef)).size;
      const missing = [];
      for (let i = 0; i < docs.length; i++) {
          if (!docs[i].exists()) {
              missing.push(requiredIds[i]);
          }
      }
      if (missing.length > 0) {
          throw new Error(`Missing required phases: ${missing.join(', ')}`);
      }
      updateTestResult('DATA_STORY_PHASES', { status: 'PASS', message: 'Found all required phases.' });
    } catch (e: any) {
      updateTestResult('DATA_STORY_PHASES', { status: 'FAIL', message: e.message });
    }

    // Test: DATA_STORY_OUTPUTS
     try {
      const outputsRef = collection(firestore, 'storyOutputTypes');
      const snap = await getDocs(query(outputsRef, limit(10)));
      fsSummary.storyOutputTypesCount = snap.size;
      if (snap.empty) {
        throw new Error('Collection is empty. Visit /admin/storyOutputs to seed data.');
      }
      const firstDoc = snap.docs[0].data();
      if (!firstDoc.name || !firstDoc.category || !firstDoc.ageRange || !firstDoc.status) {
        throw new Error('First doc is missing required fields (name, category, ageRange, status).');
      }
      updateTestResult('DATA_STORY_OUTPUTS', { status: 'PASS', message: `Found ${snap.size} output types. First doc OK.` });
    } catch (e: any) {
      updateTestResult('DATA_STORY_OUTPUTS', { status: 'FAIL', message: e.message });
    }
    
    // Test: DATA_PRINT_LAYOUTS
    try {
        const layoutsRef = collection(firestore, 'printLayouts');
        const snap = await getDocs(layoutsRef);
        fsSummary.printLayoutsCount = snap.size;
        if(snap.empty) {
            throw new Error("Collection is empty. Visit /admin/print-layouts to seed data.");
        }
        const firstLayout = snap.docs[0].data() as PrintLayout;
        if (!firstLayout.name || !firstLayout.leafWidth || !firstLayout.leafHeight || !firstLayout.leavesPerSpread) {
            throw new Error("First layout doc is missing required fields.");
        }
        updateTestResult('DATA_PRINT_LAYOUTS', {status: 'PASS', message: `Found ${snap.size} layouts. First doc OK.`});
    } catch(e: any) {
        updateTestResult('DATA_PRINT_LAYOUTS', {status: 'FAIL', message: e.message});
    }


    // Test: DATA_CHILDREN
    try {
      const childrenRef = collection(firestore, 'children');
      const snap = await getDocs(query(childrenRef, limit(5)));
      fsSummary.childrenCount = snap.size;
      if (snap.empty) {
          updateTestResult('DATA_CHILDREN', { status: 'PASS', message: 'No children found; may be expected in dev.' });
      } else {
          const firstChild = snap.docs[0].data();
          if (!firstChild.displayName) {
              throw new Error('First child doc is missing displayName field.');
          }
          updateTestResult('DATA_CHILDREN', { status: 'PASS', message: `Found ${snap.size} children. First doc OK.` });
      }
    } catch (e: any) {
      updateTestResult('DATA_CHILDREN', { status: 'FAIL', message: e.message });
    }
    
    // Test: DATA_CHILDREN_EXTENDED
    try {
        const childrenRef = collection(firestore, 'children');
        const snap = await getDocs(query(childrenRef, limit(1)));
        fsSummary.childrenExtendedCount = snap.size;
        if (snap.empty) {
            updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'SKIP', message: 'No children found to test.' });
        } else {
            const child = snap.docs[0].data() as ChildProfile;
            if (!child.ownerParentUid) {
                throw new Error('First child document is missing ownerParentUid.');
            }
            if (!child.displayName) {
                throw new Error('First child document is missing displayName.');
            }
            // Check for new required fields (likes and dislikes arrays)
            if (!Array.isArray(child.likes)) {
                throw new Error('Child doc missing likes array field.');
            }
            if (!Array.isArray(child.dislikes)) {
                throw new Error('Child doc missing dislikes array field.');
            }

            updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'PASS', message: 'First child has ownerParentUid, displayName, likes, and dislikes fields.' });
        }
    } catch (e: any) {
        updateTestResult('DATA_CHILDREN_EXTENDED', { status: 'FAIL', message: e.message });
    }


    // Test: DATA_IMAGE_STYLES_SCENE_EXEMPLARS
    try {
        const SCENE_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'] as const;
        const stylesRef = collection(firestore, 'imageStyles');
        const stylesSnap = await getDocs(query(stylesRef, limit(10)));
        fsSummary.imageStylesCount = stylesSnap.size;

        if (stylesSnap.empty) {
            updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', { status: 'SKIP', message: 'No image styles found.' });
        } else {
            let stylesWithExemplars = 0;
            let totalTagsReady = 0;
            let totalTagsMissing = 0;

            for (const docSnap of stylesSnap.docs) {
                const style = docSnap.data();
                const exemplars: Record<string, any> = style.sceneExemplars ?? {};
                if (SCENE_TAGS.some(tag => exemplars[tag]?.status)) stylesWithExemplars++;
                for (const tag of SCENE_TAGS) {
                    const entry = exemplars[tag];
                    if (entry?.status === 'ready' && entry?.imageUrl) totalTagsReady++;
                    else totalTagsMissing++;
                }
            }

            updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', {
                status: totalTagsReady > 0 ? 'PASS' : 'FAIL',
                message: `${stylesSnap.size} style(s) checked; ${stylesWithExemplars} have exemplars; ${totalTagsReady} tag(s) ready, ${totalTagsMissing} missing/pending.`,
            });
        }
    } catch (e: any) {
        updateTestResult('DATA_IMAGE_STYLES_SCENE_EXEMPLARS', { status: 'FAIL', message: e.message });
    }

    // Test: DATA_CHILDREN_CANONICAL
    try {
        const childrenRef = collection(firestore, 'children');
        const childrenSnap = await getDocs(query(childrenRef, limit(10)));

        if (childrenSnap.empty) {
            updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'SKIP', message: 'No children found.' });
        } else {
            const withPhotos = childrenSnap.docs.filter(d => {
                const photos = d.data().photos;
                return Array.isArray(photos) && photos.length > 0;
            });

            if (withPhotos.length === 0) {
                updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'SKIP', message: `${childrenSnap.size} children found, none have photos yet.` });
            } else {
                const withCanonicalField = withPhotos.filter(d => d.data().canonicalImageGeneration !== undefined);
                const withCanonicalReady = withCanonicalField.filter(d => d.data().canonicalImageGeneration?.status === 'ready');

                if (withCanonicalField.length === 0) {
                    updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'FAIL', message: `${withPhotos.length} child(ren) with photos but none have canonicalImageGeneration field.` });
                } else {
                    updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'PASS', message: `${withPhotos.length} child(ren) with photos; ${withCanonicalField.length} have canonicalImageGeneration; ${withCanonicalReady.length} ready.` });
                }
            }
        }
    } catch (e: any) {
        updateTestResult('DATA_CHILDREN_CANONICAL', { status: 'FAIL', message: e.message });
    }

     setDiagnostics((prev: any) => ({...prev, firestoreSummary: {...prev.firestoreSummary, ...fsSummary }}));
}
