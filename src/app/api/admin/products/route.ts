import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { validateProduct } from '@/lib/catalog/validate';
import type { Product } from '@/lib/types';

const COLLECTION = 'products';
const PRICES = 'prices';

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

/** Build a clean Product payload from request body (server-authoritative; ignores client-set ids/timestamps). */
function productFromBody(body: any): Partial<Product> {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    kind: body.kind,
    scope: body.scope,
    interval: body.interval ?? null,
    grants: Array.isArray(body.grants)
      ? body.grants.map((g: any) => ({ component: g.component, quantity: Number(g.quantity), reset: g.reset }))
      : undefined,
    printProductId: body.printProductId ?? null,
    active: body.active === true,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
  };
}

export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);
    const firestore = getFirestore();
    const snap = await firestore.collection(COLLECTION).orderBy('sortOrder', 'asc').get();
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, products });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/products] GET', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAdminUser(request);
    const body = await request.json();
    const product = productFromBody(body);
    const errors = validateProduct(product);
    if (errors.length) return err(400, errors.join('; '));

    const firestore = getFirestore();
    const ref = await firestore.collection(COLLECTION).add({
      ...product,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    });
    return NextResponse.json({ ok: true, productId: ref.id });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/products] POST', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function PUT(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAdminUser(request);
    const body = await request.json();
    const productId = body.productId || body.id;
    if (!productId) return err(400, 'productId is required');

    const product = productFromBody(body);
    const errors = validateProduct(product);
    if (errors.length) return err(400, errors.join('; '));

    const firestore = getFirestore();
    const ref = firestore.collection(COLLECTION).doc(productId);
    if (!(await ref.get()).exists) return err(404, 'Product not found');
    await ref.update({ ...product, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.email || user.uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/products] PUT', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function DELETE(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    if (!productId) return err(400, 'productId query parameter is required');

    const firestore = getFirestore();
    // Remove the product and any attached prices (avoid orphans).
    const priceSnap = await firestore.collection(PRICES).where('productId', '==', productId).get();
    const batch = firestore.batch();
    priceSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(firestore.collection(COLLECTION).doc(productId));
    await batch.commit();
    return NextResponse.json({ ok: true, deletedPrices: priceSnap.size });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/products] DELETE', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}
