import { describe, it, expect } from 'vitest';
import {
  isTestMode,
  TEST_MODE_ENV_VARS,
  TEST_MODE_IMAGE_DATA_URL,
  TEST_MODE_AUDIO_DATA_URL,
} from '@/lib/test-mode';

describe('isTestMode', () => {
  it('is off by default (no flag set)', () => {
    expect(isTestMode({})).toBe(false);
  });

  it('activates on TEST_MODE=1', () => {
    expect(isTestMode({ TEST_MODE: '1' })).toBe(true);
  });

  it('activates on E2E_FAKE_AI=1', () => {
    expect(isTestMode({ E2E_FAKE_AI: '1' })).toBe(true);
  });

  it("accepts 'true' (case-insensitive) but rejects other values", () => {
    expect(isTestMode({ TEST_MODE: 'true' })).toBe(true);
    expect(isTestMode({ TEST_MODE: 'TRUE' })).toBe(true);
    expect(isTestMode({ TEST_MODE: '0' })).toBe(false);
    expect(isTestMode({ TEST_MODE: 'false' })).toBe(false);
    expect(isTestMode({ TEST_MODE: 'yes' })).toBe(false);
    expect(isTestMode({ TEST_MODE: '' })).toBe(false);
  });

  it('exposes both env var names', () => {
    expect(TEST_MODE_ENV_VARS).toContain('TEST_MODE');
    expect(TEST_MODE_ENV_VARS).toContain('E2E_FAKE_AI');
  });
});

describe('fixture data URLs', () => {
  it('image fixture is a PNG data URL', () => {
    expect(TEST_MODE_IMAGE_DATA_URL.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('audio fixture is a WAV data URL', () => {
    expect(TEST_MODE_AUDIO_DATA_URL.startsWith('data:audio/wav;base64,')).toBe(true);
  });
});
