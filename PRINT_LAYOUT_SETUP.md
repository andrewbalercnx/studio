# Print Layout Setup Guide

## Overview

Before you can use the Print Storybook feature, you need to create at least one print layout in Firestore. A print layout defines how text and images are positioned on pages.

## Creating Your First Print Layout

### Method 1: Using Firestore Console (Recommended for Testing)

1. Open the Firebase Console: https://console.firebase.google.com
2. Navigate to your project → Firestore Database
3. Create a new collection called `printLayouts`
4. Add a new document with a custom ID (e.g., `a4-portrait-single`)

**Sample Document Data:**

```json
{
  "id": "a4-portrait-single",
  "name": "A4 Portrait - Single Page",
  "leafWidth": 8.27,
  "leafHeight": 11.69,
  "leavesPerSpread": 1,
  "textBoxes": [
    {
      "leaf": 1,
      "x": 0.5,
      "y": 0.5,
      "width": 7.27,
      "height": 5
    }
  ],
  "imageBoxes": [
    {
      "leaf": 1,
      "x": 0.5,
      "y": 6,
      "width": 7.27,
      "height": 5
    }
  ],
  "createdAt": "2025-12-12T00:00:00Z",
  "updatedAt": "2025-12-12T00:00:00Z"
}
```

**Explanation:**
- `leafWidth/leafHeight`: Page dimensions in inches (A4 is 8.27" × 11.69")
- `leavesPerSpread`: 1 for single page, 2 for two-page spread
- `textBoxes`: Array of text box positions (x, y, width, height in inches)
- `imageBoxes`: Array of image box positions
- `leaf`: Which page of the spread (1 or 2)

### Method 2: Two-Page Spread Layout

For a more traditional picture book layout with text on the left and image on the right:

```json
{
  "id": "a4-landscape-spread",
  "name": "A4 Landscape - Two-Page Spread",
  "leafWidth": 11.69,
  "leafHeight": 8.27,
  "leavesPerSpread": 2,
  "textBoxes": [
    {
      "leaf": 1,
      "x": 0.5,
      "y": 0.5,
      "width": 10.69,
      "height": 7.27
    }
  ],
  "imageBoxes": [
    {
      "leaf": 2,
      "x": 0.5,
      "y": 0.5,
      "width": 10.69,
      "height": 7.27
    }
  ],
  "createdAt": "2025-12-12T00:00:00Z",
  "updatedAt": "2025-12-12T00:00:00Z"
}
```

## Testing the Print Layout Workflow

Once you've created a print layout:

1. Navigate to a storybook with all images ready
2. Click "Create Print Layout" button
3. Select your print layout
4. Review the automatically generated pages
5. Click "Generate PDFs"
6. The cover and interior PDFs will be created and ready for Mixam

## Troubleshooting

### Error: "Print layout not found"

**Cause:** No print layouts exist in Firestore or the layout ID is incorrect.

**Solution:**
- Check the Firestore `printLayouts` collection exists
- Verify the document has an `id` field matching the document ID
- Check the Firestore security rules v14 are deployed

### Error: "Failed to generate auto-layout"

**Cause:** Could be missing story pages or invalid data.

**Solution:**
- Check the browser console for detailed error logs
- Verify the story has completed pages in Firestore
- Check that images have been generated for the story

### No Print Layouts Showing

**Cause:** Firestore security rules not deployed or query issue.

**Solution:**
- Deploy Firestore rules v14: `firebase deploy --only firestore:rules`
- Verify you're authenticated as a parent or admin user

## Recommended Layout Sizes

### For Mixam Hardcover Books:

- **Square Format:** 8" × 8" (203mm × 203mm)
- **Portrait Format:** 8.5" × 11" (216mm × 279mm)
- **Landscape Format:** 11" × 8.5" (279mm × 216mm)

### Important Notes:

1. **Cover PDF:** Always 4 pages (front cover, inside front, inside back, back cover)
2. **Interior PDF:** Page count must be divisible by 4 for printing
3. **Bleed:** Mixam requires 3.175mm (0.125") bleed on all edges
4. **DPI:** All PDFs are generated at 300 DPI

## Next Steps

After creating your print layout:

1. Test with a simple story first
2. Review the generated PDFs
3. Create additional layouts for different book styles
4. Integrate with the Mixam order flow

For more details on the Mixam integration, see [MIXAM_SETUP.md](./MIXAM_SETUP.md).
