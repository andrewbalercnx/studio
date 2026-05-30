import { describe, it, expect } from 'vitest';
import { AuthError } from '@/lib/auth-error';

describe('AuthError', () => {
  it('is an instance of Error', () => {
    expect(new AuthError('UNAUTHENTICATED')).toBeInstanceOf(Error);
  });

  it('defaults to status 401 for UNAUTHENTICATED', () => {
    const err = new AuthError('UNAUTHENTICATED');
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('defaults to status 403 for FORBIDDEN', () => {
    const err = new AuthError('FORBIDDEN');
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('uses custom message when provided', () => {
    const err = new AuthError('UNAUTHENTICATED', 'Token expired');
    expect(err.message).toBe('Token expired');
  });

  it('uses custom status when provided', () => {
    const err = new AuthError('FORBIDDEN', 'Not allowed', 451);
    expect(err.status).toBe(451);
  });

  it('can be caught as an Error', () => {
    const throws = () => { throw new AuthError('FORBIDDEN'); };
    expect(throws).toThrow(Error);
    expect(throws).toThrow('FORBIDDEN');
  });
});
