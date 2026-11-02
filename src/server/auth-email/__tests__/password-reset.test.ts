import { describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { appBaseUrl, RESET_THROTTLE_MS, resetEmailHtml, sendPasswordReset, type PasswordResetDeps } from '../password-reset';

const FIREBASE_LINK = 'https://studio-x.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE%2B1&apiKey=k&lang=en';

function setup(overrides: Partial<PasswordResetDeps> = {}) {
  let now = 1_000_000;
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const deps: PasswordResetDeps = {
    db: new FakeFirestore().asFirestore(),
    generateLink: vi.fn(async () => FIREBASE_LINK),
    sendEmail: async (message) => {
      sent.push(message);
    },
    now: () => now,
    baseUrl: 'https://storypic.rcnx.io',
    ...overrides,
  };
  return { deps, sent, advance: (ms: number) => (now += ms) };
}

describe('sendPasswordReset', () => {
  it('emails a link to our own handler carrying Firebase\'s one-time code', async () => {
    const { deps, sent } = setup();
    expect(await sendPasswordReset(deps, '  Parent@Example.com ')).toBe('sent');
    expect(deps.generateLink).toHaveBeenCalledWith('parent@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('parent@example.com');
    expect(sent[0].html).toContain('https://storypic.rcnx.io/auth/action?mode=resetPassword&amp;oobCode=CODE%2B1');
    expect(sent[0].html).not.toContain('firebaseapp.com');
  });

  it('sends at most one email per address per minute', async () => {
    const { deps, sent, advance } = setup();
    await sendPasswordReset(deps, 'p@example.com');
    expect(await sendPasswordReset(deps, 'P@example.com')).toBe('throttled');
    advance(RESET_THROTTLE_MS);
    expect(await sendPasswordReset(deps, 'p@example.com')).toBe('sent');
    expect(sent).toHaveLength(2);
  });

  it('sends nothing for an unknown address, without an error', async () => {
    const error = Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    const { deps, sent } = setup({ generateLink: vi.fn(async () => Promise.reject(error)) });
    expect(await sendPasswordReset(deps, 'nobody@example.com')).toBe('no-account');
    expect(sent).toEqual([]);
  });

  it('escapes the address in the email body', () => {
    expect(resetEmailHtml('<b>@x.com', 'https://a/b?c=1&d=2')).toContain('&lt;b&gt;@x.com');
  });

  it('uses a fixed base URL, never the request', () => {
    expect(appBaseUrl({})).toBe('https://storypic.rcnx.io');
    expect(appBaseUrl({ APP_BASE_URL: 'https://staging.example/' })).toBe('https://staging.example');
  });
});
