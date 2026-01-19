import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DevTodo, DevTodoStatus, DevTodoPriority } from '@/lib/types';

const DEV_TODOS_COLLECTION = 'devTodos';

/**
 * Internal API for Claude to create dev todos
 * Uses a shared secret for authentication instead of user auth
 *
 * POST /api/internal/dev-todos
 * Header: X-Internal-Secret: <secret>
 */
export async function POST(request: Request) {
  try {
    // Verify internal secret
    const secret = request.headers.get('X-Internal-Secret');
    const expectedSecret = process.env.INTERNAL_API_SECRET;

    if (!expectedSecret) {
      console.error('[internal/dev-todos] INTERNAL_API_SECRET not configured');
      return NextResponse.json(
        { ok: false, errorMessage: 'Internal API not configured' },
        { status: 500 }
      );
    }

    if (!secret || secret !== expectedSecret) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Invalid or missing internal secret' },
        { status: 401 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const body = await request.json();
    const {
      title,
      description,
      priority = 'medium',
      category,
      relatedFiles,
    } = body;

    // Validate required fields
    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'title must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate priority
    const validPriorities: DevTodoPriority[] = ['low', 'medium', 'high'];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json(
        { ok: false, errorMessage: 'priority must be low, medium, or high' },
        { status: 400 }
      );
    }

    const todoData: Omit<DevTodo, 'id'> = {
      title: title.trim(),
      description: description?.trim() || undefined,
      status: 'pending' as DevTodoStatus,
      priority: priority as DevTodoPriority,
      createdBy: 'claude',
      category: category?.trim() || undefined,
      relatedFiles: Array.isArray(relatedFiles) ? relatedFiles.filter((f: string) => typeof f === 'string' && f.trim()) : undefined,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Remove undefined fields
    const cleanData = Object.fromEntries(
      Object.entries(todoData).filter(([, v]) => v !== undefined)
    );

    const docRef = await firestore.collection(DEV_TODOS_COLLECTION).add(cleanData);

    console.log(`[internal/dev-todos] Created dev todo ${docRef.id}: ${title}`);

    return NextResponse.json({
      ok: true,
      todoId: docRef.id,
      message: 'Dev todo created successfully',
    });

  } catch (error: unknown) {
    console.error('[internal/dev-todos] POST Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
