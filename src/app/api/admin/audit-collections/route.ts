import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

type DocumentIssue = {
  path: string;
  documentId: string;
  issues: string[];
  data?: Record<string, unknown>;
};

type CollectionAuditResult = {
  collection: string;
  totalDocuments: number;
  validDocuments: number;
  invalidDocuments: number;
  issues: DocumentIssue[];
};

type AuditResult = {
  timestamp: string;
  collections: CollectionAuditResult[];
  summary: {
    totalCollections: number;
    totalDocuments: number;
    totalIssues: number;
    collectionsWithIssues: string[];
  };
};

// Required fields for each collection's current schema
const SCHEMA_DEFINITIONS: Record<string, {
  required: string[];
  deprecated?: string[];
  expectedTypes?: Record<string, string>;
}> = {
  stories: {
    required: ['storySessionId', 'childId', 'parentUid', 'storyText', 'createdAt'],
    deprecated: ['outputs'], // Old subcollection - should use storybooks instead
    expectedTypes: {
      storySessionId: 'string',
      childId: 'string',
      parentUid: 'string',
      storyText: 'string',
    },
  },
  'stories/*/storybooks': {
    required: ['storyId', 'childId', 'parentUid', 'createdAt'],
    expectedTypes: {
      storyId: 'string',
      childId: 'string',
      parentUid: 'string',
    },
  },
  'stories/*/outputs': {
    // This is the LEGACY structure - documents here should be migrated or deleted
    required: [],
    deprecated: ['*'], // Entire collection is deprecated
  },
  children: {
    required: ['displayName', 'ownerParentUid', 'createdAt'],
    expectedTypes: {
      displayName: 'string',
      ownerParentUid: 'string',
    },
  },
  characters: {
    required: ['name', 'ownerParentUid', 'createdAt'],
    expectedTypes: {
      name: 'string',
      ownerParentUid: 'string',
    },
  },
  users: {
    required: ['createdAt'],
    expectedTypes: {},
  },
  storySessions: {
    required: ['childId', 'parentUid', 'createdAt'],
    expectedTypes: {
      childId: 'string',
      parentUid: 'string',
    },
  },
  printLayouts: {
    required: ['id', 'name', 'leafWidth', 'leafHeight'],
    expectedTypes: {
      id: 'string',
      name: 'string',
      leafWidth: 'number',
      leafHeight: 'number',
    },
  },
  printOrders: {
    required: ['userId', 'storybookId', 'status', 'createdAt'],
    expectedTypes: {
      userId: 'string',
      status: 'string',
    },
  },
  imageStyles: {
    required: ['id', 'name', 'prompt'],
    expectedTypes: {
      id: 'string',
      name: 'string',
      prompt: 'string',
    },
  },
  storyOutputTypes: {
    required: ['id', 'name'],
    expectedTypes: {
      id: 'string',
      name: 'string',
    },
  },
};

function validateDocument(
  path: string,
  docId: string,
  data: Record<string, unknown>,
  schema: { required: string[]; deprecated?: string[]; expectedTypes?: Record<string, string> }
): DocumentIssue | null {
  const issues: string[] = [];

  // Check for deprecated collection marker
  if (schema.deprecated?.includes('*')) {
    issues.push('Document exists in deprecated collection - should be migrated or deleted');
  }

  // Check required fields
  for (const field of schema.required) {
    if (data[field] === undefined || data[field] === null) {
      issues.push(`Missing required field: ${field}`);
    }
  }

  // Check field types
  if (schema.expectedTypes) {
    for (const [field, expectedType] of Object.entries(schema.expectedTypes)) {
      if (data[field] !== undefined && data[field] !== null) {
        const actualType = typeof data[field];
        if (actualType !== expectedType) {
          issues.push(`Field '${field}' has wrong type: expected ${expectedType}, got ${actualType}`);
        }
      }
    }
  }

  // Check for soft-deleted documents (these are fine, just note them)
  if (data.deletedAt) {
    issues.push('Document is soft-deleted (this is informational, not an error)');
  }

  if (issues.length === 0) {
    return null;
  }

  return {
    path,
    documentId: docId,
    issues,
    data: Object.fromEntries(
      Object.entries(data).filter(([key]) =>
        schema.required.includes(key) ||
        (schema.expectedTypes && key in schema.expectedTypes) ||
        key === 'deletedAt' ||
        key === 'createdAt' ||
        key === 'updatedAt'
      )
    ),
  };
}

async function auditCollection(
  firestore: FirebaseFirestore.Firestore,
  collectionPath: string,
  schema: { required: string[]; deprecated?: string[]; expectedTypes?: Record<string, string> }
): Promise<CollectionAuditResult> {
  const issues: DocumentIssue[] = [];
  let totalDocuments = 0;
  let validDocuments = 0;

  try {
    const snapshot = await firestore.collection(collectionPath).limit(500).get();
    totalDocuments = snapshot.size;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const issue = validateDocument(collectionPath, doc.id, data, schema);
      if (issue) {
        issues.push(issue);
      } else {
        validDocuments++;
      }
    }
  } catch (error: any) {
    issues.push({
      path: collectionPath,
      documentId: 'N/A',
      issues: [`Failed to read collection: ${error.message}`],
    });
  }

  return {
    collection: collectionPath,
    totalDocuments,
    validDocuments,
    invalidDocuments: issues.length,
    issues,
  };
}

async function auditSubcollections(
  firestore: FirebaseFirestore.Firestore,
  parentCollection: string,
  subcollectionName: string,
  schema: { required: string[]; deprecated?: string[]; expectedTypes?: Record<string, string> }
): Promise<CollectionAuditResult> {
  const issues: DocumentIssue[] = [];
  let totalDocuments = 0;
  let validDocuments = 0;

  try {
    // Get all parent documents
    const parentSnapshot = await firestore.collection(parentCollection).limit(100).get();

    for (const parentDoc of parentSnapshot.docs) {
      const subcollectionPath = `${parentCollection}/${parentDoc.id}/${subcollectionName}`;
      const subcollectionSnapshot = await firestore
        .collection(parentCollection)
        .doc(parentDoc.id)
        .collection(subcollectionName)
        .limit(100)
        .get();

      totalDocuments += subcollectionSnapshot.size;

      for (const doc of subcollectionSnapshot.docs) {
        const data = doc.data();
        const issue = validateDocument(subcollectionPath, doc.id, data, schema);
        if (issue) {
          issues.push(issue);
        } else {
          validDocuments++;
        }
      }
    }
  } catch (error: any) {
    issues.push({
      path: `${parentCollection}/*/${subcollectionName}`,
      documentId: 'N/A',
      issues: [`Failed to read subcollections: ${error.message}`],
    });
  }

  return {
    collection: `${parentCollection}/*/${subcollectionName}`,
    totalDocuments,
    validDocuments,
    invalidDocuments: issues.length,
    issues,
  };
}

export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const firestore = getFirestore();
    const results: CollectionAuditResult[] = [];

    // Audit top-level collections
    const topLevelCollections = ['stories', 'children', 'characters', 'users', 'storySessions', 'printLayouts', 'printOrders', 'imageStyles', 'storyOutputTypes'];

    for (const collection of topLevelCollections) {
      const schema = SCHEMA_DEFINITIONS[collection];
      if (schema) {
        const result = await auditCollection(firestore, collection, schema);
        results.push(result);
      }
    }

    // Audit subcollections
    const storybooksSchema = SCHEMA_DEFINITIONS['stories/*/storybooks'];
    if (storybooksSchema) {
      const storybooksResult = await auditSubcollections(firestore, 'stories', 'storybooks', storybooksSchema);
      results.push(storybooksResult);
    }

    // Check for legacy 'outputs' subcollection (should be empty/deprecated)
    const outputsSchema = SCHEMA_DEFINITIONS['stories/*/outputs'];
    if (outputsSchema) {
      const outputsResult = await auditSubcollections(firestore, 'stories', 'outputs', outputsSchema);
      results.push(outputsResult);
    }

    // Calculate summary
    const totalDocuments = results.reduce((sum, r) => sum + r.totalDocuments, 0);
    const totalIssues = results.reduce((sum, r) => sum + r.invalidDocuments, 0);
    const collectionsWithIssues = results
      .filter(r => r.invalidDocuments > 0)
      .map(r => r.collection);

    const auditResult: AuditResult = {
      timestamp: new Date().toISOString(),
      collections: results,
      summary: {
        totalCollections: results.length,
        totalDocuments,
        totalIssues,
        collectionsWithIssues,
      },
    };

    return NextResponse.json(auditResult);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[audit-collections] Error:', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
