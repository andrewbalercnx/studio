import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { validatePrice } from '@/lib/catalog/validate';
import type { Price } from '@/lib/types';

const COLLECTION = 'prices';

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

function priceFromBody(body: any): Partial<Price> {
  return {
    productId: typeof body.productId === 'string' ? body.productId.trim() : undefined,
    currency: body.currency,
    amountMinor: typeof body.amountMinor === 'number' ? body.amountMinor : Number(body.amountMinor),
    interval: body.interval ?? null,
    active: body.active === true,
    externalPriceId: body.externalPriceId ?? null,
  };
}

export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const firestore = getFirestore();
    let query: FirebaseFirestore.Query = firestore.collection(COLLECTION);
    if (productId) query = query.where('productId', '==', productId);
    const snap = await query.get();
    const prices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, prices });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/prices] GET', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAdminUser(request);
    const body = await request.json();
    const price = priceFromBody(body);
    const errors = validatePrice(price);
    if (errors.length) return err(400, errors.join('; '));

    const firestore = getFirestore();
    // Ensure the product exists before attaching a price.
    if (!(await firestore.collection('products').doc(price.productId!).get()).exists) {
      return err(404, 'Product not found for this price');
    }
    const ref = await firestore.collection(COLLECTION).add({
      ...price,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.email || user.uid,
    });
    return NextResponse.json({ ok: true, priceId: ref.id });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/prices] POST', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function PUT(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAdminUser(request);
    const body = await request.json();
    const priceId = body.priceId || body.id;
    if (!priceId) return err(400, 'priceId is required');
    const price = priceFromBody(body);
    const errors = validatePrice(price);
    if (errors.length) return err(400, errors.join('; '));

    const firestore = getFirestore();
    const ref = firestore.collection(COLLECTION).doc(priceId);
    if (!(await ref.get()).exists) return err(404, 'Price not found');
    await ref.update({ ...price, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.email || user.uid });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/prices] PUT', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}

export async function DELETE(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);
    const { searchParams } = new URL(request.url);
    const priceId = searchParams.get('priceId');
    if (!priceId) return err(400, 'priceId query parameter is required');
    const firestore = getFirestore();
    await firestore.collection(COLLECTION).doc(priceId).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.message);
    console.error('[admin/prices] DELETE', e);
    return err(500, e instanceof Error ? e.message : 'Unexpected error');
  }
}
