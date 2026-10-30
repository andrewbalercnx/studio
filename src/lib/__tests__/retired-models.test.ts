import { describe, expect, it } from 'vitest';
import { CURRENT_IMAGE_MODEL, CURRENT_TEXT_MODEL, currentModelId } from '../retired-models';

describe('currentModelId', () => {
  it('replaces retired Gemini models, with or without a provider prefix', () => {
    expect(currentModelId('googleai/gemini-2.5-pro')).toBe(CURRENT_TEXT_MODEL);
    expect(currentModelId('gemini-2.0-flash')).toBe(CURRENT_TEXT_MODEL);
    expect(currentModelId('vertexai/gemini-2.5-flash-image')).toBe(CURRENT_IMAGE_MODEL);
  });

  it('leaves current and unknown models alone', () => {
    expect(currentModelId('googleai/gemini-3.1-pro-preview')).toBe('googleai/gemini-3.1-pro-preview');
    expect(currentModelId('elevenlabs/eleven_v3')).toBe('elevenlabs/eleven_v3');
    expect(currentModelId(undefined)).toBeUndefined();
  });
});
