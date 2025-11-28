import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth } from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

initFirebaseAdminApp();

export async function POST() {
  try {
    const headerList = await headers();
    const authorization = headerList.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);
    if (!decodedToken?.isAdmin) {
      return NextResponse.json({ ok: false, message: 'Admin access required.' }, { status: 403 });
    }

    const firestore = getFirestore();
    const sessionsSnap = await firestore.collection('storySessions').get();

    let migrated = 0;
    let skipped = 0;
    let deleted = 0;
    let errors: Array<{ id: string; reason: string }> = [];

    const deleteSession = async (docRef: FirebaseFirestore.DocumentReference) => {
      const messagesSnap = await docRef.collection('messages').get();
      for (const messageDoc of messagesSnap.docs) {
        await docRef.collection('messages').doc(messageDoc.id).delete();
      }
      await docRef.delete();
    };

    for (const doc of sessionsSnap.docs) {
      try {
        const data = doc.data();
        const childId = data.childId;
        if (!childId) {
          await deleteSession(doc.ref);
          deleted++;
          errors.push({ id: doc.id, reason: 'Missing childId (deleted)' });
          continue;
        }

        const childRef = firestore.collection('children').doc(childId);
        const childSnap = await childRef.get();
        const ownerParentUid = childSnap.exists ? childSnap.data()?.ownerParentUid : null;
        const parentUid = data.parentUid || ownerParentUid;

        if (!parentUid) {
          await deleteSession(doc.ref);
          deleted++;
          errors.push({ id: doc.id, reason: 'Unable to resolve parentUid (deleted)' });
          continue;
        }

        const destRef = childRef.collection('sessions').doc(doc.id);
        await destRef.set(
          {
            ...data,
            parentUid,
            migratedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const messagesSnap = await doc.ref.collection('messages').get();
        for (const messageDoc of messagesSnap.docs) {
          await destRef.collection('messages').doc(messageDoc.id).set(messageDoc.data(), { merge: true });
        }

        await doc.ref.set(
          {
            parentUid,
            migratedToChildSessions: true,
          },
          { merge: true }
        );

        migrated++;
      } catch (migrationError: any) {
        skipped++;
        errors.push({ id: doc.id, reason: migrationError?.message || 'Unknown error' });
      }
    }

    return NextResponse.json({
      ok: true,
      migrated,
      deleted,
      skipped,
      total: sessionsSnap.size,
      errors,
    });
  } catch (error: any) {
    console.error('Migration failed', error);
    return NextResponse.json({ ok: false, message: error?.message || 'Migration failed.' }, { status: 500 });
  }
}
