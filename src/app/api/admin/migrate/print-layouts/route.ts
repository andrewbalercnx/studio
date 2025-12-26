import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth, firestore } from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PrintLayout, PageLayoutConfig, TextLayoutBox, PageLayoutBox } from '@/lib/types';

initFirebaseAdminApp();

/**
 * Migration script for PrintLayout documents
 *
 * This migration:
 * 1. Converts legacy textBoxes/imageBoxes arrays to page-type-specific layouts
 * 2. Adds leaf property to all boxes
 * 3. Adds borderRadius to text boxes
 * 4. Removes the legacy textBoxes/imageBoxes arrays
 * 5. Adds titlePageLayout if not present
 */

type LegacyPrintLayout = {
  id: string;
  name: string;
  leafWidth: number;
  leafHeight: number;
  leavesPerSpread: 1 | 2;
  font?: string;
  fontSize?: number;
  coverLayout?: PageLayoutConfig;
  backCoverLayout?: PageLayoutConfig;
  insideLayout?: PageLayoutConfig;
  titlePageLayout?: PageLayoutConfig;
  textBoxes?: Array<{
    leaf: 1 | 2;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  imageBoxes?: Array<{
    leaf: 1 | 2;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  createdAt?: any;
  updatedAt?: any;
};

function migratePrintLayout(layout: LegacyPrintLayout): {
  migratedLayout: Partial<PrintLayout>;
  changes: string[];
} {
  const changes: string[] = [];
  const migratedLayout: Partial<PrintLayout> = {};

  // Helper to ensure text box has required new properties
  const ensureTextBoxProperties = (
    textBox: any,
    defaultLeaf: 1 | 2 = 1
  ): TextLayoutBox => {
    const result: TextLayoutBox = {
      leaf: textBox.leaf ?? defaultLeaf,
      x: textBox.x,
      y: textBox.y,
      width: textBox.width,
      height: textBox.height,
    };
    if (textBox.backgroundColor) {
      result.backgroundColor = textBox.backgroundColor;
    }
    if (textBox.textColor) {
      result.textColor = textBox.textColor;
    }
    // Add default borderRadius if not present
    if (textBox.borderRadius !== undefined) {
      result.borderRadius = textBox.borderRadius;
    } else if (textBox.backgroundColor) {
      // Add a subtle borderRadius for text boxes with background color
      result.borderRadius = 0.15;
    }
    return result;
  };

  // Helper to ensure image box has leaf property
  const ensureImageBoxProperties = (
    imageBox: any,
    defaultLeaf: 1 | 2 = 1
  ): PageLayoutBox => ({
    leaf: imageBox.leaf ?? defaultLeaf,
    x: imageBox.x,
    y: imageBox.y,
    width: imageBox.width,
    height: imageBox.height,
  });

  // Migrate coverLayout
  if (layout.coverLayout) {
    const newCoverLayout: PageLayoutConfig = {};
    if (layout.coverLayout.textBox) {
      newCoverLayout.textBox = ensureTextBoxProperties(layout.coverLayout.textBox, 1);
      if (!layout.coverLayout.textBox.leaf) {
        changes.push('Added leaf=1 to coverLayout.textBox');
      }
      if (!layout.coverLayout.textBox.borderRadius && layout.coverLayout.textBox.backgroundColor) {
        changes.push('Added borderRadius=0.15 to coverLayout.textBox');
      }
    }
    if (layout.coverLayout.imageBox) {
      newCoverLayout.imageBox = ensureImageBoxProperties(layout.coverLayout.imageBox, 1);
      if (!layout.coverLayout.imageBox.leaf) {
        changes.push('Added leaf=1 to coverLayout.imageBox');
      }
    }
    migratedLayout.coverLayout = newCoverLayout;
  }

  // Migrate backCoverLayout
  if (layout.backCoverLayout) {
    const newBackCoverLayout: PageLayoutConfig = {};
    if (layout.backCoverLayout.textBox) {
      newBackCoverLayout.textBox = ensureTextBoxProperties(layout.backCoverLayout.textBox, 1);
      if (!layout.backCoverLayout.textBox.leaf) {
        changes.push('Added leaf=1 to backCoverLayout.textBox');
      }
      if (!layout.backCoverLayout.textBox.borderRadius && layout.backCoverLayout.textBox.backgroundColor) {
        changes.push('Added borderRadius=0.15 to backCoverLayout.textBox');
      }
    }
    if (layout.backCoverLayout.imageBox) {
      newBackCoverLayout.imageBox = ensureImageBoxProperties(layout.backCoverLayout.imageBox, 1);
      if (!layout.backCoverLayout.imageBox.leaf) {
        changes.push('Added leaf=1 to backCoverLayout.imageBox');
      }
    }
    migratedLayout.backCoverLayout = newBackCoverLayout;
  }

  // Migrate insideLayout
  if (layout.insideLayout) {
    const newInsideLayout: PageLayoutConfig = {};
    if (layout.insideLayout.textBox) {
      newInsideLayout.textBox = ensureTextBoxProperties(layout.insideLayout.textBox, 1);
      if (!layout.insideLayout.textBox.leaf) {
        changes.push('Added leaf=1 to insideLayout.textBox');
      }
      if (!layout.insideLayout.textBox.borderRadius && layout.insideLayout.textBox.backgroundColor) {
        changes.push('Added borderRadius=0.15 to insideLayout.textBox');
      }
    }
    if (layout.insideLayout.imageBox) {
      // For spread layouts, image is typically on leaf 2
      const defaultImageLeaf = layout.leavesPerSpread === 2 ? 2 : 1;
      newInsideLayout.imageBox = ensureImageBoxProperties(layout.insideLayout.imageBox, defaultImageLeaf as 1 | 2);
      if (!layout.insideLayout.imageBox.leaf) {
        changes.push(`Added leaf=${defaultImageLeaf} to insideLayout.imageBox`);
      }
    }
    migratedLayout.insideLayout = newInsideLayout;
  } else if (layout.textBoxes && layout.textBoxes.length > 0) {
    // Convert legacy textBoxes/imageBoxes to insideLayout
    const legacyTextBox = layout.textBoxes[0];
    const legacyImageBox = layout.imageBoxes?.[0];

    const newInsideLayout: PageLayoutConfig = {
      textBox: ensureTextBoxProperties({
        leaf: legacyTextBox.leaf,
        x: legacyTextBox.x,
        y: legacyTextBox.y,
        width: legacyTextBox.width,
        height: legacyTextBox.height,
        backgroundColor: '#FFFEF0', // Light cream background
        borderRadius: 0.15,
      }, legacyTextBox.leaf),
    };

    if (legacyImageBox) {
      newInsideLayout.imageBox = ensureImageBoxProperties(legacyImageBox, legacyImageBox.leaf);
    }

    migratedLayout.insideLayout = newInsideLayout;
    changes.push('Created insideLayout from legacy textBoxes/imageBoxes');
  }

  // Add titlePageLayout if not present
  if (!layout.titlePageLayout) {
    migratedLayout.titlePageLayout = {
      textBox: {
        leaf: 1,
        x: 1,
        y: 2,
        width: layout.leafWidth - 2,
        height: layout.leafHeight - 4,
      },
    };
    changes.push('Added titlePageLayout');
  } else if (layout.titlePageLayout.textBox && !layout.titlePageLayout.textBox.leaf) {
    migratedLayout.titlePageLayout = {
      textBox: ensureTextBoxProperties(layout.titlePageLayout.textBox, 1),
    };
    changes.push('Added leaf=1 to titlePageLayout.textBox');
  }

  // Mark legacy arrays for removal
  if (layout.textBoxes && layout.textBoxes.length > 0) {
    changes.push('Will remove legacy textBoxes array');
  }
  if (layout.imageBoxes && layout.imageBoxes.length > 0) {
    changes.push('Will remove legacy imageBoxes array');
  }

  return { migratedLayout, changes };
}

export async function POST() {
  try {
    // Verify authentication
    const headerList = await headers();
    const authorization = headerList.get('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);

    // Check if user is admin
    if (!decodedToken?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const db = getFirestore();
    const printLayoutsRef = db.collection('printLayouts');
    const snapshot = await printLayoutsRef.get();

    const results: Array<{
      id: string;
      name: string;
      migrated: boolean;
      changes: string[];
      error?: string;
    }> = [];

    for (const doc of snapshot.docs) {
      const layout = { id: doc.id, ...doc.data() } as LegacyPrintLayout;

      try {
        const { migratedLayout, changes } = migratePrintLayout(layout);

        if (changes.length > 0) {
          // Build the update object
          const updateData: Record<string, any> = {
            ...migratedLayout,
            updatedAt: FieldValue.serverTimestamp(),
          };

          // Remove legacy arrays using FieldValue.delete()
          if (layout.textBoxes) {
            updateData.textBoxes = FieldValue.delete();
          }
          if (layout.imageBoxes) {
            updateData.imageBoxes = FieldValue.delete();
          }

          await printLayoutsRef.doc(doc.id).update(updateData);

          results.push({
            id: doc.id,
            name: layout.name,
            migrated: true,
            changes,
          });
        } else {
          results.push({
            id: doc.id,
            name: layout.name,
            migrated: false,
            changes: ['No changes needed'],
          });
        }
      } catch (error: any) {
        results.push({
          id: doc.id,
          name: layout.name,
          migrated: false,
          changes: [],
          error: error.message || 'Unknown error',
        });
      }
    }

    const migratedCount = results.filter((r) => r.migrated).length;
    const errorCount = results.filter((r) => r.error).length;

    return NextResponse.json({
      success: errorCount === 0,
      message: `Migrated ${migratedCount} of ${results.length} print layouts`,
      totalLayouts: results.length,
      migratedCount,
      errorCount,
      results,
    });
  } catch (error: any) {
    console.error('Print layout migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}

// GET endpoint to preview migration without applying changes
export async function GET() {
  try {
    // Verify authentication
    const headerList = await headers();
    const authorization = headerList.get('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);

    // Check if user is admin
    if (!decodedToken?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const db = getFirestore();
    const printLayoutsRef = db.collection('printLayouts');
    const snapshot = await printLayoutsRef.get();

    const previews: Array<{
      id: string;
      name: string;
      currentState: LegacyPrintLayout;
      proposedChanges: string[];
      migratedLayout: Partial<PrintLayout>;
    }> = [];

    for (const doc of snapshot.docs) {
      const layout = { id: doc.id, ...doc.data() } as LegacyPrintLayout;
      const { migratedLayout, changes } = migratePrintLayout(layout);

      previews.push({
        id: doc.id,
        name: layout.name,
        currentState: layout,
        proposedChanges: changes,
        migratedLayout,
      });
    }

    const needsMigration = previews.filter((p) => p.proposedChanges.length > 0);

    return NextResponse.json({
      message: `Found ${needsMigration.length} of ${previews.length} layouts needing migration`,
      totalLayouts: previews.length,
      needsMigrationCount: needsMigration.length,
      previews,
    });
  } catch (error: any) {
    console.error('Print layout migration preview error:', error);
    return NextResponse.json(
      { error: error.message || 'Preview failed' },
      { status: 500 }
    );
  }
}
