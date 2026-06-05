import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { CatalogEntry, Price, Product } from '@/lib/types';

/**
 * GET /api/catalog — the consumer-facing catalog: active products with their active prices, assembled
 * server-side (server-first). Products without an active price are still returned (e.g. free tier);
 * filtering/assembly happens here, not on the client.
 */
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAuthenticatedUser(request);
    const firestore = getFirestore();

    const [productsSnap, pricesSnap] = await Promise.all([
      firestore.collection('products').where('active', '==', true).get(),
      firestore.collection('prices').where('active', '==', true).get(),
    ]);

    const pricesByProduct = new Map<string, Price[]>();
    pricesSnap.docs.forEach((d) => {
      const price = { id: d.id, ...d.data() } as Price;
      const list = pricesByProduct.get(price.productId) ?? [];
      list.push(price);
      pricesByProduct.set(price.productId, list);
    });

    const catalog: CatalogEntry[] = productsSnap.docs
      .map((d) => {
        const product = { id: d.id, ...d.data() } as Product;
        return { ...product, prices: pricesByProduct.get(d.id) ?? [] };
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return NextResponse.json({ ok: true, catalog });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: e.message }, { status: e.status });
    }
    console.error('[catalog] GET', e);
    return NextResponse.json(
      { ok: false, errorMessage: e instanceof Error ? e.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
