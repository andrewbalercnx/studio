import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import type { DevTodo, DevTodoStatus, DevTodoPriority } from '@/lib/types';

const DEV_TODOS_COLLECTION = 'devTodos';

/**
 * GET: Fetch all dev todos
 */
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const firestore = getFirestore();
    const snapshot = await firestore
      .collection(DEV_TODOS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    const todos: DevTodo[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as DevTodo[];

    return NextResponse.json({
      ok: true,
      todos,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/dev-todos] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * POST: Create a new dev todo
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      title,
      description,
      priority = 'medium',
      category,
      relatedFiles,
      createdBy = 'admin', // Can be 'admin' or 'claude'
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

    // Validate createdBy
    if (createdBy !== 'admin' && createdBy !== 'claude') {
      return NextResponse.json(
        { ok: false, errorMessage: 'createdBy must be admin or claude' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const todoData: Omit<DevTodo, 'id'> = {
      title: title.trim(),
      description: description?.trim() || undefined,
      status: 'pending' as DevTodoStatus,
      priority: priority as DevTodoPriority,
      createdBy,
      createdByEmail: createdBy === 'admin' ? (user.email || undefined) : undefined,
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

    return NextResponse.json({
      ok: true,
      todoId: docRef.id,
      message: 'Dev todo created successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/dev-todos] POST Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update an existing dev todo
 */
export async function PUT(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      todoId,
      title,
      description,
      status,
      priority,
      partialComment,
      category,
      relatedFiles,
      completedBy,
    } = body;

    // Validate todoId
    if (typeof todoId !== 'string' || !todoId.trim()) {
      return NextResponse.json(
        { ok: false, errorMessage: 'todoId is required' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.collection(DEV_TODOS_COLLECTION).doc(todoId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Dev todo not found' },
        { status: 404 }
      );
    }

    // Build update data
    const updateData: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return NextResponse.json(
          { ok: false, errorMessage: 'title must be a non-empty string' },
          { status: 400 }
        );
      }
      updateData.title = title.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (status !== undefined) {
      const validStatuses: DevTodoStatus[] = ['pending', 'in_progress', 'partial', 'completed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { ok: false, errorMessage: 'status must be pending, in_progress, partial, or completed' },
          { status: 400 }
        );
      }
      updateData.status = status;

      // Track who completed the item
      if (status === 'completed') {
        updateData.completedAt = FieldValue.serverTimestamp();
        updateData.completedBy = completedBy || 'admin';
        updateData.completedByEmail = (completedBy || 'admin') === 'admin' ? (user.email || null) : null;
      }
    }

    if (priority !== undefined) {
      const validPriorities: DevTodoPriority[] = ['low', 'medium', 'high'];
      if (!validPriorities.includes(priority)) {
        return NextResponse.json(
          { ok: false, errorMessage: 'priority must be low, medium, or high' },
          { status: 400 }
        );
      }
      updateData.priority = priority;
    }

    if (partialComment !== undefined) {
      updateData.partialComment = partialComment?.trim() || null;
    }

    if (category !== undefined) {
      updateData.category = category?.trim() || null;
    }

    if (relatedFiles !== undefined) {
      updateData.relatedFiles = Array.isArray(relatedFiles)
        ? relatedFiles.filter((f: string) => typeof f === 'string' && f.trim())
        : null;
    }

    await docRef.update(updateData);

    return NextResponse.json({
      ok: true,
      message: 'Dev todo updated successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/dev-todos] PUT Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Delete a dev todo
 */
export async function DELETE(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const todoId = searchParams.get('todoId');

    if (!todoId) {
      return NextResponse.json(
        { ok: false, errorMessage: 'todoId query parameter is required' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const docRef = firestore.collection(DEV_TODOS_COLLECTION).doc(todoId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Dev todo not found' },
        { status: 404 }
      );
    }

    await docRef.delete();

    return NextResponse.json({
      ok: true,
      message: 'Dev todo deleted successfully',
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/dev-todos] DELETE Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
