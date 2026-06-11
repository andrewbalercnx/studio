import { describe, expect, it } from 'vitest';
import { isInternalSecretValid } from '../internal-secret';

describe('isInternalSecretValid', () => {
  it('accepts an exact match', () => {
    expect(isInternalSecretValid('s3cret-value', 's3cret-value')).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    expect(isInternalSecretValid('s3cret-valuX', 's3cret-value')).toBe(false);
  });

  it('rejects a wrong secret of a different length (no throw)', () => {
    expect(isInternalSecretValid('s3', 's3cret-value')).toBe(false);
    expect(isInternalSecretValid('s3cret-value-with-suffix', 's3cret-value')).toBe(false);
  });

  it('rejects a prefix of the expected secret', () => {
    expect(isInternalSecretValid('s3cret-valu', 's3cret-value')).toBe(false);
  });

  it('rejects when the provided secret is missing or empty', () => {
    expect(isInternalSecretValid(null, 's3cret-value')).toBe(false);
    expect(isInternalSecretValid(undefined, 's3cret-value')).toBe(false);
    expect(isInternalSecretValid('', 's3cret-value')).toBe(false);
  });

  it('rejects when the expected secret is unconfigured (fail closed)', () => {
    expect(isInternalSecretValid('anything', undefined)).toBe(false);
    expect(isInternalSecretValid('anything', null)).toBe(false);
    expect(isInternalSecretValid('anything', '')).toBe(false);
    // Both empty must still deny — empty expected means "not configured".
    expect(isInternalSecretValid('', '')).toBe(false);
  });

  it('handles multi-byte UTF-8 input', () => {
    expect(isInternalSecretValid('pässwörd-✓', 'pässwörd-✓')).toBe(true);
    expect(isInternalSecretValid('pässwörd-✗', 'pässwörd-✓')).toBe(false);
  });
});
