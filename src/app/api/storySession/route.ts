import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * POST /api/storySession
 * Creates a new story session for a child.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { childId, generatorId } = body;

    if (!childId || !generatorId) {
      return NextResponse.json(
        { error: 'childId and generatorId are required' },
        { status: 400 }
      );
    }

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Verify the child belongs to this parent
    const childDoc = await firestore.collection('children').doc(childId).get();
    if (!childDoc.exists || childDoc.data()?.ownerParentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load the generator to get its flowType
    const generatorDoc = await firestore.collection('storyGenerators').doc(generatorId).get();
    const generatorData = generatorDoc.exists ? generatorDoc.data() : null;
    const flowType = generatorData?.flowType || 'wizard';

    // Create the session
    const sessionRef = firestore.collection('storySessions').doc();
    const sessionData = {
      childId,
      parentUid: authResult.uid,
      generatorId,
      flowType,
      status: 'active',
      currentPhase: 'warmup',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await sessionRef.set(sessionData);

    return NextResponse.json({
      id: sessionRef.id,
      ...sessionData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[POST /api/storySession] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create session' },
      { status: 500 }
    );
  }
}
