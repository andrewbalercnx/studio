import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { getIdToken: async () => 'token-123' } }),
}));

import { authFetch } from '../auth-fetch';

const fetchMock = vi.fn(async () => new Response('{}'));

function sentHeaders(): Headers {
  const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe('authFetch', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the bearer token to a relative /api/ route', async () => {
    await authFetch('/api/storyBeat', { method: 'POST' });
    expect(sentHeaders().get('Authorization')).toBe('Bearer token-123');
  });

  it('attaches the token to an absolute same-origin /api/ URL', async () => {
    await authFetch('https://app.example/api/storyCompile');
    expect(sentHeaders().get('Authorization')).toBe('Bearer token-123');
  });

  it('never sends the token to another origin', async () => {
    await authFetch('https://storage.googleapis.com/api/whatever');
    expect(sentHeaders().get('Authorization')).toBeNull();
  });

  it('does not attach the token to same-origin non-API paths', async () => {
    await authFetch('/downloads/storypic-kids.apk');
    expect(sentHeaders().get('Authorization')).toBeNull();
  });

  it('keeps an Authorization header the caller set', async () => {
    await authFetch('/api/storyBeat', { headers: { Authorization: 'Bearer explicit' } });
    expect(sentHeaders().get('Authorization')).toBe('Bearer explicit');
  });
});
