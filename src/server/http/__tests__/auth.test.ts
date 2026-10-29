import { describe, expect, it, vi } from 'vitest';
import { UnauthenticatedError } from '../../errors';
import { readBearerToken, readInternalAuthConfig, verifyInternalCaller, verifyUserToken } from '../auth';

const SA = 'jobs-invoker@proj.iam.gserviceaccount.com';
const config = { audience: 'https://app.example/api/internal/jobs/run', serviceAccountEmail: SA };

function request(headers: Record<string, string> = {}, url = 'https://app.example/api/x') {
  return new Request(url, { headers });
}

describe('readBearerToken', () => {
  it('reads the Authorization header only, never the query string', () => {
    expect(readBearerToken(request({ Authorization: 'Bearer abc' }))).toBe('abc');
    expect(readBearerToken(request({}, 'https://app.example/api/x?idToken=abc'))).toBeNull();
    expect(readBearerToken(request({ Authorization: 'Basic abc' }))).toBeNull();
  });
});

describe('verifyUserToken', () => {
  it('rejects a request without a bearer token before touching firebase-admin', async () => {
    await expect(verifyUserToken(request({}, 'https://app.example/api/x?idToken=abc'))).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
  });
});

describe('verifyInternalCaller', () => {
  const withToken = () => request({ Authorization: 'Bearer oidc' });

  it('accepts a verified token for the invoker service account and audience', async () => {
    const verify = vi.fn().mockResolvedValue({ email: SA, email_verified: true });
    await expect(verifyInternalCaller(withToken(), { config, verify })).resolves.toEqual({ email: SA });
    expect(verify).toHaveBeenCalledWith('oidc', config.audience);
  });

  it.each([
    ['another account', { email: 'someone@proj.iam.gserviceaccount.com', email_verified: true }],
    ['an unverified email', { email: SA, email_verified: false }],
    ['no payload', undefined],
  ])('rejects %s', async (_label, payload) => {
    const verify = vi.fn().mockResolvedValue(payload);
    await expect(verifyInternalCaller(withToken(), { config, verify })).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects tokens that fail verification (e.g. a Firebase user token)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const verify = vi.fn().mockRejectedValue(new Error('Wrong recipient'));
    await expect(verifyInternalCaller(withToken(), { config, verify })).rejects.toThrow('Invalid OIDC token');
  });

  it('fails closed when not configured or no token is sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const verify = vi.fn();
    await expect(verifyInternalCaller(withToken(), { config: null, verify })).rejects.toThrow(/not configured/);
    await expect(verifyInternalCaller(request(), { config, verify })).rejects.toThrow('Missing OIDC token');
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('readInternalAuthConfig', () => {
  it('defaults the audience to JOBS_RUN_URL', () => {
    expect(
      readInternalAuthConfig({ JOBS_RUN_URL: 'https://x/run', JOBS_INVOKER_SERVICE_ACCOUNT: SA })
    ).toEqual({ audience: 'https://x/run', serviceAccountEmail: SA });
    expect(readInternalAuthConfig({ JOBS_RUN_URL: 'https://x/run' })).toBeNull();
  });
});
