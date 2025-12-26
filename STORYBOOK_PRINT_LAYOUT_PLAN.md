# Storybook Print Layout & PDF Generation - Implementation Plan

## Overview

This document outlines the complete workflow for creating printable storybooks with customizable layouts and Mixam integration.

## Current System Analysis

### ✅ What We Have
1. **Story Creation Flow** - Generates story content with text and images
2. **Print Layouts Database** - Defines page layouts (text/image positions)
3. **Mixam Integration** - JWT auth, PDF upload, order submission, webhooks
4. **Print Product Catalog** - Hardcover book specifications
5. **PDF Generation API** - `/api/storyBook/printable` (generates combined PDFs)

### 🔧 What Exists But Needs Enhancement
1. **StoryOutput Type** - Has `finalization` field with PDF URLs
2. **PrintLayout Type** - Defines text/image boxes on pages
3. **Existing `/storybook/[bookId]/page.tsx`** - Needs layout selection UI
4. **PDF Generation** - Currently generates all pages; needs cover/interior separation

### ❌ What's Missing
1. **Print Layout Selection UI** - Parent chooses layout for their book
2. **Page Layout Preview** - Visual representation of how pages will look
3. **StoryBook Document Type** - Dedicated type for print-ready books
4. **Cover PDF Generation** - Separate 4-page cover (front/back/spine/endpapers)
5. **Interior PDF Generation** - Body pages after cover
6. **Layout-Specific Page Rendering** - Apply layout to story content

---

## Data Model Design

### New Type: StoryBook

```typescript
export type StoryBook = {
  id: string;
  ownerUserId: string; // User who created it
  storyId: string; // Reference to original story
  title: string;

  // Layout Configuration
  printLayoutId: string; // Selected layout

  // Content Structure
  pages: StoryBookPage[];

  // PDF Generation Status
  pdfStatus: 'draft' | 'generating' | 'ready' | 'error';
  coverPdfUrl?: string;
  interiorPdfUrl?: string;
  combinedPdfUrl?: string; // For preview

  // Metadata
  printableMetadata?: PrintableAssetMetadata;

  // Timestamps
  createdAt: any;
  updatedAt: any;
};

export type StoryBookPage = {
  pageNumber: number; // 1-based
  type: 'cover-front' | 'cover-back' | 'interior' | 'endpaper';

  // Content from story
  displayText?: string;
  imageUrl?: string;

  // Layout application
  layoutId: string; // Which layout this page uses

  // Optional overrides
  customTextBox?: { x: number; y: number; width: number; height: number };
  customImageBox?: { x: number; y: number; width: number; height: number };
};
```

### Enhanced StoryOutput (Already Exists, Enhance)

```typescript
// Add to existing StoryOutput type
export type StoryOutput = {
  // ... existing fields ...

  // Add reference to storybook if one is created
  storybookId?: string;
};
```

---

## User Flow & Wireframes

### Phase 1: Layout Selection

**Route:** `/storybook/[bookId]/layout`

**User Story:**
> As a parent, I want to select a print layout for my story so I can customize how the book looks.

**UI Components:**
1. **Layout Gallery**
   - Grid of available layouts with thumbnails
   - Each shows sample page with text/image positioning
   - Name and description

2. **Layout Details**
   - Preview of 2-page spread
   - Dimensions (8×10")
   - Text/image box positions visualized

3. **Selection Action**
   - "Use This Layout" button
   - Proceeds to page assignment

**Data Flow:**
```
1. Load available PrintLayouts from Firestore
2. Display gallery with previews
3. User selects layout
4. Create StoryBook document with selected layout
5. Navigate to page editor
```

---

### Phase 2: Page Assignment & Preview

**Route:** `/storybook/[bookId]/pages`

**User Story:**
> As a parent, I want to see how my story content is laid out on each page and make adjustments if needed.

**UI Components:**

1. **Page Navigator**
   - Thumbnail strip of all pages
   - Current page highlighted
   - Page numbers and types (cover, interior)

2. **Page Preview Canvas**
   - Large preview of current page
   - Shows text and image in layout boxes
   - Displays actual content from story

3. **Content Assignment**
   - Auto-assign story beats to pages
   - Drag-and-drop to reorder
   - Edit text/image per page

4. **Actions**
   - "Previous Page" / "Next Page"
   - "Generate PDFs" button when satisfied
   - "Save Draft" to save progress

**Layout Logic:**

```
Cover Pages (4 pages required by Mixam hardcover):
├── Page 1: Inside front cover (endpaper)
├── Page 2: Title page / dedication
├── Page 3: Copyright / credits
└── Page 4: Inside back cover (endpaper)

Interior Pages:
├── Auto-calculate from story content
├── Must be divisible by 4 (printing requirement)
├── Apply selected layout to each page
└── Distribute story beats across pages
```

**Data Flow:**
```
1. Load StoryBook document
2. Load story content (text/images)
3. Apply layout to distribute content across pages
4. Render preview of each page
5. Allow user to navigate and review
6. Save any manual adjustments
```

---

### Phase 3: PDF Generation

**Route:** `/storybook/[bookId]/generate`

**User Story:**
> As a parent, I want to generate print-ready PDFs so I can order physical books.

**UI Components:**

1. **Generation Status**
   - Progress indicator
   - Status messages ("Generating cover PDF...", "Generating interior PDF...")
   - Preview thumbnails when complete

2. **PDF Preview**
   - Embedded PDF viewer for cover
   - Embedded PDF viewer for interior
   - Download buttons

3. **Quality Validation**
   - Check page count (cover = 4, interior divisible by 4)
   - Check image resolution (300 DPI)
   - Check PDF size
   - Display warnings if any

4. **Actions**
   - "Regenerate PDFs" if edits made
   - "Proceed to Order" when satisfied

**PDF Generation Logic:**

```
Cover PDF (4 pages):
├── Page 1: Inside front cover
│   └── Layout: Endpaper color/pattern
├── Page 2: Title page
│   └── Layout: Centered title + author
├── Page 3: Copyright page
│   └── Layout: Small text, publication info
└── Page 4: Inside back cover
    └── Layout: Endpaper color/pattern

Interior PDF (N pages, N % 4 = 0):
├── Story pages with selected layout
├── Text rendered in layout text boxes
├── Images rendered in layout image boxes
└── Page numbers
```

**API Endpoints:**

```
POST /api/storyBook/[bookId]/generate-pdfs
├── Generates cover PDF (4 pages)
├── Generates interior PDF (body pages)
├── Uploads to Firebase Storage
├── Updates StoryBook document with URLs
└── Returns URLs and metadata

Response:
{
  coverPdfUrl: string;
  interiorPdfUrl: string;
  combinedPdfUrl: string; // For preview
  metadata: {
    coverPageCount: 4;
    interiorPageCount: number;
    totalPageCount: number;
    dpi: 300;
    trimSize: "8x10";
  }
}
```

---

### Phase 4: Order Creation

**Route:** `/storybook/[bookId]/order` (Already Exists!)

**Enhancement Needed:**
- Check that PDFs are generated before allowing order
- Pass cover/interior PDF URLs to Mixam order API

**Existing Flow:**
```
1. Select print product (hardcover)
2. Choose quantity
3. Customize (endpaper color, etc.)
4. Enter shipping address
5. Submit order
```

**Integration Points:**
```
Order Creation:
├── Validate StoryBook has PDFs
├── Pass coverPdfUrl to order
├── Pass interiorPdfUrl to order
├── Create PrintOrder document
└── Navigate to /parent/orders
```

---

## Technical Implementation Plan

### Phase 1: Data Types & Database (1-2 hours)

**Files:**
- `src/lib/types.ts` - Add StoryBook and StoryBookPage types
- `firestore.rules` - Already has storyBooks rules ✅

**Tasks:**
1. Define StoryBook type
2. Define StoryBookPage type
3. Add storybookId to StoryOutput type

---

### Phase 2: Layout Selection UI (2-3 hours)

**Files to Create:**
- `src/app/storybook/[bookId]/layout/page.tsx` - Layout selection UI
- `src/components/storybook/layout-card.tsx` - Layout preview component

**Files to Modify:**
- `src/app/storybook/[bookId]/page.tsx` - Add "Choose Print Layout" button

**API Endpoints:**
- None (client-side reads from Firestore)

**Tasks:**
1. Create layout selection page
2. Load printLayouts from Firestore
3. Display grid of layout options
4. Show preview of each layout
5. Create StoryBook document on selection
6. Navigate to page editor

---

### Phase 3: Page Editor & Preview (4-6 hours)

**Files to Create:**
- `src/app/storybook/[bookId]/pages/page.tsx` - Page editor UI
- `src/components/storybook/page-preview.tsx` - Page preview canvas
- `src/components/storybook/page-navigator.tsx` - Thumbnail navigation
- `src/lib/storybook-layout-engine.ts` - Logic to distribute content across pages

**API Endpoints:**
- None initially (client-side only)

**Tasks:**
1. Create page editor UI
2. Load StoryBook document
3. Load story content (from StoryOutput)
4. Implement auto-layout logic:
   - Assign cover pages (4 pages)
   - Distribute story beats across interior pages
   - Ensure interior page count % 4 = 0
5. Render page preview with actual layout
6. Add navigation between pages
7. Save/load draft state

**Layout Engine Logic:**

```typescript
function distributeContentToPages(
  storyOutput: StoryOutput,
  layout: PrintLayout
): StoryBookPage[] {
  const pages: StoryBookPage[] = [];

  // Cover pages (fixed structure)
  pages.push({
    pageNumber: 1,
    type: 'cover-front',
    layoutId: layout.id,
  });
  pages.push({
    pageNumber: 2,
    type: 'interior',
    displayText: `${storyOutput.title}\n\nBy ${storyOutput.authorName}`,
    layoutId: layout.id,
  });
  pages.push({
    pageNumber: 3,
    type: 'interior',
    displayText: 'Copyright info...',
    layoutId: layout.id,
  });
  pages.push({
    pageNumber: 4,
    type: 'cover-back',
    layoutId: layout.id,
  });

  // Interior pages from story beats
  const storyBeats = storyOutput.pages || [];
  let pageNum = 5;

  for (const beat of storyBeats) {
    pages.push({
      pageNumber: pageNum++,
      type: 'interior',
      displayText: beat.displayText,
      imageUrl: beat.imageUrl,
      layoutId: layout.id,
    });
  }

  // Pad to make divisible by 4
  while ((pages.length - 4) % 4 !== 0) {
    pages.push({
      pageNumber: pageNum++,
      type: 'interior',
      layoutId: layout.id,
      // Blank page
    });
  }

  return pages;
}
```

---

### Phase 4: PDF Generation (3-4 hours)

**Files to Create:**
- `src/app/api/storyBook/[bookId]/generate-pdfs/route.ts` - PDF generation endpoint
- `src/lib/pdf-renderer.ts` - Enhanced PDF rendering with layouts

**Files to Modify:**
- `src/app/api/storyBook/printable/route.ts` - Extract shared rendering logic

**Tasks:**
1. Create PDF generation API endpoint
2. Implement cover PDF generation:
   - Exactly 4 pages
   - Apply layout to title/copyright pages
   - Endpaper pages
3. Implement interior PDF generation:
   - All story content pages
   - Apply selected layout to each
   - Ensure divisible by 4
4. Upload PDFs to Firebase Storage
5. Update StoryBook document with URLs
6. Return metadata

**PDF Rendering with Layouts:**

```typescript
async function renderPageWithLayout(
  page: StoryBookPage,
  layout: PrintLayout
): Promise<PDFPage> {
  const pdfPage = pdfDoc.addPage([
    layout.leafWidth * 72,
    layout.leafHeight * 72
  ]);

  // Render image in image boxes
  if (page.imageUrl && layout.imageBoxes.length > 0) {
    const imageBox = layout.imageBoxes[0];
    const imageData = await fetchImageBytes(page.imageUrl);
    const image = await pdfDoc.embedJpg(imageData);

    pdfPage.drawImage(image, {
      x: imageBox.x * 72,
      y: (layout.leafHeight - imageBox.y - imageBox.height) * 72,
      width: imageBox.width * 72,
      height: imageBox.height * 72,
    });
  }

  // Render text in text boxes
  if (page.displayText && layout.textBoxes.length > 0) {
    const textBox = layout.textBoxes[0];
    pdfPage.drawText(page.displayText, {
      x: textBox.x * 72,
      y: (layout.leafHeight - textBox.y) * 72,
      size: 12,
      maxWidth: textBox.width * 72,
      // ... text wrapping logic
    });
  }

  return pdfPage;
}
```

---

### Phase 5: Integration with Existing Order Flow (1-2 hours)

**Files to Modify:**
- `src/app/storybook/[bookId]/order/page.tsx` - Verify PDFs exist before order
- `src/app/api/printOrders/mixam/route.ts` - Use StoryBook PDFs

**Tasks:**
1. Update order page to check for generated PDFs
2. Show PDF preview on order page
3. Use StoryBook PDFs instead of StoryOutput PDFs
4. Validate PDF requirements before submission

---

## File Structure Summary

```
New Files to Create:
├── src/lib/types.ts (modify - add StoryBook types)
├── src/app/storybook/[bookId]/layout/page.tsx
├── src/app/storybook/[bookId]/pages/page.tsx
├── src/app/api/storyBook/[bookId]/generate-pdfs/route.ts
├── src/components/storybook/layout-card.tsx
├── src/components/storybook/page-preview.tsx
├── src/components/storybook/page-navigator.tsx
└── src/lib/storybook-layout-engine.ts

Files to Modify:
├── src/app/storybook/[bookId]/page.tsx
├── src/app/storybook/[bookId]/order/page.tsx
└── src/app/api/printOrders/mixam/route.ts

Existing Files (Reference):
├── src/app/api/storyBook/printable/route.ts
├── src/lib/types.ts (PrintLayout, StoryOutput)
└── firestore.rules (storyBooks already defined)
```

---

## Implementation Phases

### Phase 1: Foundation (2-3 hours)
- [ ] Define StoryBook and StoryBookPage types
- [ ] Create layout selection page UI
- [ ] Test layout selection flow

### Phase 2: Page Editor (4-6 hours)
- [ ] Build page editor UI
- [ ] Implement layout engine (content distribution)
- [ ] Create page preview component
- [ ] Add navigation between pages
- [ ] Test with various story lengths

### Phase 3: PDF Generation (3-4 hours)
- [ ] Create PDF generation API
- [ ] Implement cover PDF rendering (4 pages)
- [ ] Implement interior PDF rendering
- [ ] Upload to Firebase Storage
- [ ] Test with Mixam specifications

### Phase 4: Integration (1-2 hours)
- [ ] Update order flow
- [ ] Add PDF validation
- [ ] Test end-to-end workflow

### Phase 5: Polish & Testing (2-3 hours)
- [ ] Error handling
- [ ] Loading states
- [ ] Validation messages
- [ ] E2E testing

**Total Estimated Time: 12-18 hours**

---

## API Endpoints Summary

### New Endpoints

```
POST /api/storyBook/[bookId]/generate-pdfs
├── Input: { bookId: string }
├── Output: { coverPdfUrl, interiorPdfUrl, combinedPdfUrl, metadata }
├── Creates: Cover PDF (4 pages) + Interior PDF (N pages)
└── Updates: StoryBook document with URLs

GET /api/storyBook/[bookId]/preview
├── Input: { bookId: string, pageNumber?: number }
├── Output: { pages: StoryBookPage[], layout: PrintLayout }
└── Returns: Page data for preview
```

---

## Dependencies & Prerequisites

### Required
- ✅ PrintLayout collection seeded with at least 1 layout
- ✅ Firebase Storage configured
- ✅ Mixam integration (JWT auth, PDF upload)
- ✅ pdf-lib library installed

### Optional
- [ ] Image optimization service (for high-res images)
- [ ] PDF compression (to reduce file sizes)

---

## Testing Strategy

### Unit Tests
- Layout engine (content distribution)
- PDF rendering functions
- Page validation logic

### Integration Tests
- Layout selection → StoryBook creation
- Page editor → Save draft
- PDF generation → Firebase upload
- Order creation → Mixam submission

### E2E Tests
1. Create story with 10 pages
2. Select print layout
3. Review pages in editor
4. Generate PDFs
5. Verify cover = 4 pages
6. Verify interior % 4 = 0
7. Create Mixam order
8. Submit to Mixam (mock mode)

---

## Risk Mitigation

### Technical Risks

**Risk:** PDF generation fails for large books (100+ pages)
- **Mitigation:** Implement chunked processing, progress updates

**Risk:** Images are low resolution (< 300 DPI)
- **Mitigation:** Validate DPI before PDF generation, show warning

**Risk:** Text doesn't fit in layout text boxes
- **Mitigation:** Implement text wrapping and overflow detection

**Risk:** Page count not divisible by 4
- **Mitigation:** Auto-add blank pages, warn user

### UX Risks

**Risk:** Users don't understand page layout selection
- **Mitigation:** Clear previews, sample pages, help text

**Risk:** PDF generation takes too long (no feedback)
- **Mitigation:** Show progress bar, estimated time

**Risk:** Users can't find generated PDFs
- **Mitigation:** Clear navigation, "View PDFs" prominent button

---

## Success Metrics

1. **Functionality**
   - ✅ User can select a print layout
   - ✅ Pages are correctly distributed across layout
   - ✅ Cover PDF has exactly 4 pages
   - ✅ Interior PDF page count % 4 = 0
   - ✅ PDFs upload to Firebase Storage
   - ✅ Order can be created with PDFs

2. **Quality**
   - ✅ Images render at 300 DPI
   - ✅ Text fits in layout boxes
   - ✅ PDFs meet Mixam specifications
   - ✅ No blank pages except intentional padding

3. **Performance**
   - ✅ Layout selection loads in < 2 seconds
   - ✅ Page preview renders in < 1 second
   - ✅ PDF generation completes in < 30 seconds for 50 pages

---

## Next Steps

**Immediate:**
1. Review and approve this plan
2. Clarify any requirements
3. Prioritize phases if needed

**After Approval:**
1. Start with Phase 1 (Foundation)
2. Implement incrementally
3. Test each phase before moving to next

---

## Questions for Clarification

1. **Layout Library:** How many print layouts should we support initially? (Recommend starting with 1-2)

2. **Auto-Layout:** Should the system automatically assign story beats to pages, or allow manual assignment?

3. **Cover Design:** What should cover pages look like? (Title page format, copyright text, endpaper design)

4. **Editing:** Can users edit text/images on pages, or are they locked to story content?

5. **Preview Quality:** Should preview be low-res for speed, or high-res for accuracy?

6. **Regeneration:** If user changes layout, should PDFs auto-regenerate or require manual trigger?

---

## Appendix: Example User Journey

1. **Parent completes story** → Story has 20 pages of content
2. **Navigates to** `/storybook/abc123`
3. **Clicks** "Prepare for Print"
4. **Redirected to** `/storybook/abc123/layout`
5. **Sees** 3 layout options in gallery
6. **Selects** "Classic Layout" (text on left, image on right)
7. **Clicks** "Use This Layout"
8. **StoryBook document created** with 24 total pages (4 cover + 20 interior)
9. **Redirected to** `/storybook/abc123/pages`
10. **Reviews** each page in preview
11. **Clicks** "Generate PDFs"
12. **System generates:**
    - Cover PDF: 4 pages
    - Interior PDF: 20 pages
13. **PDFs uploaded** to Firebase Storage
14. **Preview shown** with download buttons
15. **Clicks** "Proceed to Order"
16. **Redirected to** `/storybook/abc123/order`
17. **Reviews** order details with PDF previews
18. **Submits** order to Mixam

**Total Time: ~10 minutes**
