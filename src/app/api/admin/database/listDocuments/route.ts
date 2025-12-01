'use server';

import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

type ListDocumentsRequest = {
  collection: string;
  limit?: number;
};

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user.claims?.isAdmin) {
      throw new AuthError('FORBIDDEN', 'Admin access required');
    }

    const body = (await request.json()) as ListDocumentsRequest;
    const rawCollection = body?.collection ?? '';
    const collection = rawCollection.replace(/^\/+/, '').trim();
    if (!collection) {
      return NextResponse.json(
        { ok: false, error: 'collection is required' },
        { status: 400 },
      );
    }
    const limitInput = typeof body?.limit === 'number' ? body.limit : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitInput, MAX_LIMIT));

    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const collectionRef = firestore.collection(collection);
    const docRefs = await collectionRef.listDocuments();

    if (docRefs.length === 0) {
      return NextResponse.json({ ok: true, documents: [] });
    }

    const sortedRefs = docRefs
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
    const snapshots = await firestore.getAll(...sortedRefs);

    const documents = snapshots.map((snapshot) => ({
      id: snapshot.id,
      exists: snapshot.exists,
      data: snapshot.data() ?? null,
      createTime: snapshot.createTime?.toDate().toISOString() ?? null,
      updateTime: snapshot.updateTime?.toDate().toISOString() ?? null,
      readTime: snapshot.readTime?.toDate().toISOString() ?? null,
    }));

    return NextResponse.json({ ok: true, documents });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    console.error('[admin-database] listDocuments error', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Unexpected error listing documents' },
      { status: 500 },
    );
  }
}
