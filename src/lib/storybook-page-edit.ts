/**
 * Validation for parent per-page storybook edits (Sprint W2-C).
 *
 * Pure and dependency-free so the API route (`/api/storybookV2/pageEdit`) and
 * unit tests share exactly the same rules. The route applies the returned
 * `updates` verbatim; nothing else from the request body reaches Firestore.
 *
 * Contract:
 * - `pageText` updates BOTH `bodyText` and `displayText` on the page. Once a
 *   parent edits the text, their wording is canonical for every consumer
 *   (reader, audio narration, print layout). Text may contain `$$id$$`
 *   placeholders — clients convert display names back via
 *   `replaceNamesWithPlaceholders` before submitting.
 * - `imagePrompt` replaces the page's image-generation prompt. It cannot be
 *   blanked (that would silently flip the page to "no art needed").
 */

export const MAX_PAGE_TEXT_LENGTH = 2000;
export const MAX_IMAGE_PROMPT_LENGTH = 4000;

export type PageEditRequestBody = {
  storyId?: unknown;
  storybookId?: unknown;
  pageId?: unknown;
  pageText?: unknown;
  imagePrompt?: unknown;
};

export type PageEditUpdates = {
  bodyText?: string;
  displayText?: string;
  imagePrompt?: string;
};

export type PageEditValidation =
  | {
      ok: true;
      storyId: string;
      storybookId: string;
      pageId: string;
      updates: PageEditUpdates;
      textChanged: boolean;
      promptChanged: boolean;
    }
  | { ok: false; errorMessage: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validatePageEdit(body: PageEditRequestBody): PageEditValidation {
  if (!isNonEmptyString(body.storyId)) {
    return { ok: false, errorMessage: 'Missing storyId' };
  }
  if (!isNonEmptyString(body.storybookId)) {
    return { ok: false, errorMessage: 'Missing storybookId' };
  }
  if (!isNonEmptyString(body.pageId)) {
    return { ok: false, errorMessage: 'Missing pageId' };
  }

  const hasText = body.pageText !== undefined;
  const hasPrompt = body.imagePrompt !== undefined;

  if (!hasText && !hasPrompt) {
    return {
      ok: false,
      errorMessage: 'Nothing to update — provide pageText and/or imagePrompt.',
    };
  }

  const updates: PageEditUpdates = {};
  let textChanged = false;
  let promptChanged = false;

  if (hasText) {
    if (typeof body.pageText !== 'string') {
      return { ok: false, errorMessage: 'pageText must be a string.' };
    }
    const text = body.pageText.trim();
    if (text.length > MAX_PAGE_TEXT_LENGTH) {
      return {
        ok: false,
        errorMessage: `pageText is too long (max ${MAX_PAGE_TEXT_LENGTH} characters).`,
      };
    }
    // Empty text is allowed: a picture-only page is a valid edit.
    updates.bodyText = text;
    updates.displayText = text;
    textChanged = true;
  }

  if (hasPrompt) {
    if (typeof body.imagePrompt !== 'string') {
      return { ok: false, errorMessage: 'imagePrompt must be a string.' };
    }
    const prompt = body.imagePrompt.trim();
    if (prompt.length === 0) {
      return {
        ok: false,
        errorMessage: 'imagePrompt cannot be empty — edit it instead of removing it.',
      };
    }
    if (prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
      return {
        ok: false,
        errorMessage: `imagePrompt is too long (max ${MAX_IMAGE_PROMPT_LENGTH} characters).`,
      };
    }
    updates.imagePrompt = prompt;
    promptChanged = true;
  }

  return {
    ok: true,
    storyId: body.storyId.trim(),
    storybookId: body.storybookId.trim(),
    pageId: body.pageId.trim(),
    updates,
    textChanged,
    promptChanged,
  };
}
