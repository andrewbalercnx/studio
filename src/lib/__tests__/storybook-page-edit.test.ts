import { describe, it, expect } from 'vitest';
import {
  validatePageEdit,
  MAX_PAGE_TEXT_LENGTH,
  MAX_IMAGE_PROMPT_LENGTH,
} from '../storybook-page-edit';

const base = { storyId: 's1', storybookId: 'sb1', pageId: 'p1' };

describe('validatePageEdit', () => {
  it('rejects missing ids', () => {
    expect(validatePageEdit({ ...base, storyId: undefined, pageText: 'x' }).ok).toBe(false);
    expect(validatePageEdit({ ...base, storybookId: '', pageText: 'x' }).ok).toBe(false);
    expect(validatePageEdit({ ...base, pageId: '   ', pageText: 'x' }).ok).toBe(false);
    expect(validatePageEdit({ ...base, storyId: 42 as any, pageText: 'x' }).ok).toBe(false);
  });

  it('rejects a request with nothing to update', () => {
    const result = validatePageEdit({ ...base });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toMatch(/Nothing to update/);
  });

  it('rejects non-string pageText and imagePrompt', () => {
    expect(validatePageEdit({ ...base, pageText: 42 }).ok).toBe(false);
    expect(validatePageEdit({ ...base, imagePrompt: { a: 1 } }).ok).toBe(false);
  });

  it('accepts a text-only edit and writes BOTH bodyText and displayText', () => {
    const result = validatePageEdit({ ...base, pageText: '  Ellie sails away.  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates).toEqual({
        bodyText: 'Ellie sails away.',
        displayText: 'Ellie sails away.',
      });
      expect(result.textChanged).toBe(true);
      expect(result.promptChanged).toBe(false);
    }
  });

  it('allows empty pageText (picture-only page)', () => {
    const result = validatePageEdit({ ...base, pageText: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates.bodyText).toBe('');
      expect(result.updates.displayText).toBe('');
    }
  });

  it('accepts a prompt-only edit', () => {
    const result = validatePageEdit({ ...base, imagePrompt: ' A boat on a starry sea ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates).toEqual({ imagePrompt: 'A boat on a starry sea' });
      expect(result.textChanged).toBe(false);
      expect(result.promptChanged).toBe(true);
    }
  });

  it('rejects blanking the imagePrompt', () => {
    const result = validatePageEdit({ ...base, imagePrompt: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorMessage).toMatch(/cannot be empty/);
  });

  it('enforces length limits', () => {
    expect(
      validatePageEdit({ ...base, pageText: 'x'.repeat(MAX_PAGE_TEXT_LENGTH + 1) }).ok
    ).toBe(false);
    expect(
      validatePageEdit({ ...base, imagePrompt: 'x'.repeat(MAX_IMAGE_PROMPT_LENGTH + 1) }).ok
    ).toBe(false);
    expect(
      validatePageEdit({ ...base, pageText: 'x'.repeat(MAX_PAGE_TEXT_LENGTH) }).ok
    ).toBe(true);
  });

  it('accepts a combined text + prompt edit and trims ids', () => {
    const result = validatePageEdit({
      storyId: ' s1 ',
      storybookId: 'sb1',
      pageId: 'p1',
      pageText: 'New text',
      imagePrompt: 'New prompt',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storyId).toBe('s1');
      expect(result.textChanged).toBe(true);
      expect(result.promptChanged).toBe(true);
    }
  });
});
