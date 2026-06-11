import { describe, expect, it } from 'vitest';
import {
  PERSONA_MAX_AGE_MS,
  evaluatePersonaScope,
  signPersonaCookie,
  verifyPersonaCookie,
  type PersonaClaims,
} from './persona';

const SECRET = 'unit-test-secret';
const NOW = 1_750_000_000_000;

function claims(overrides: Partial<PersonaClaims> = {}): PersonaClaims {
  return { uid: 'parent-1', childId: 'child-a', iat: NOW, ...overrides };
}

describe('signPersonaCookie / verifyPersonaCookie', () => {
  it('round-trips valid claims', () => {
    const value = signPersonaCookie(claims(), SECRET);
    expect(verifyPersonaCookie(value, SECRET, NOW)).toEqual(claims());
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const value = signPersonaCookie(claims(), SECRET);
    const [payload, sig] = value.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims(), childId: 'child-b' }),
      'utf8',
    ).toString('base64url');
    expect(verifyPersonaCookie(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    // and a tampered signature on the original payload
    const flippedSig = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyPersonaCookie(`${payload}.${flippedSig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', () => {
    const value = signPersonaCookie(claims(), 'some-other-secret');
    expect(verifyPersonaCookie(value, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired cookie (past max age)', () => {
    const value = signPersonaCookie(claims({ iat: NOW - PERSONA_MAX_AGE_MS - 1 }), SECRET);
    expect(verifyPersonaCookie(value, SECRET, NOW)).toBeNull();
  });

  it('accepts a cookie just inside its lifetime', () => {
    const value = signPersonaCookie(claims({ iat: NOW - PERSONA_MAX_AGE_MS + 1000 }), SECRET);
    expect(verifyPersonaCookie(value, SECRET, NOW)).not.toBeNull();
  });

  it('rejects an absurdly future-dated iat (beyond clock skew)', () => {
    const value = signPersonaCookie(claims({ iat: NOW + 60 * 60 * 1000 }), SECRET);
    expect(verifyPersonaCookie(value, SECRET, NOW)).toBeNull();
  });

  it('rejects malformed values and missing inputs', () => {
    expect(verifyPersonaCookie(undefined, SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie('', SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie('no-dot-here', SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie('.leading-dot', SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie('trailing-dot.', SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie('not-base64!!.also-not!!', SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(signPersonaCookie(claims(), SECRET), null, NOW)).toBeNull();
  });

  it('rejects claims with wrong shapes even when correctly signed', () => {
    const sign = (payloadObj: unknown) => {
      // re-implement the format with an arbitrary payload
      const { createHmac } = require('node:crypto') as typeof import('node:crypto');
      const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
      const sig = createHmac('sha256', SECRET).update(payload, 'utf8').digest().toString('base64url');
      return `${payload}.${sig}`;
    };
    expect(verifyPersonaCookie(sign({ uid: '', childId: 'c', iat: NOW }), SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(sign({ uid: 'u', childId: '', iat: NOW }), SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(sign({ uid: 'u', childId: 'c' }), SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(sign({ uid: 'u', childId: 'c', iat: 'x' }), SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(sign('a string'), SECRET, NOW)).toBeNull();
    expect(verifyPersonaCookie(sign(null), SECRET, NOW)).toBeNull();
  });
});

describe('evaluatePersonaScope (the fail-open matrix)', () => {
  const persona = claims(); // parent-1 / child-a

  it('cookie absent -> allowed (legacy / mobile)', () => {
    expect(evaluatePersonaScope(null, 'parent-1', 'child-b').allowed).toBe(true);
  });

  it('cookie present, child matches -> allowed', () => {
    expect(evaluatePersonaScope(persona, 'parent-1', 'child-a').allowed).toBe(true);
  });

  it('cookie present, child mismatch -> denied', () => {
    const decision = evaluatePersonaScope(persona, 'parent-1', 'child-b');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('CHILD_MISMATCH');
      expect(decision.personaChildId).toBe('child-a');
    }
  });

  it('cookie for a different uid -> allowed (not this principal)', () => {
    expect(evaluatePersonaScope(persona, 'parent-2', 'child-b').allowed).toBe(true);
  });

  it('unknown expected uid -> allowed (legacy)', () => {
    expect(evaluatePersonaScope(persona, undefined, 'child-b').allowed).toBe(true);
    expect(evaluatePersonaScope(persona, null, 'child-b').allowed).toBe(true);
    expect(evaluatePersonaScope(persona, '', 'child-b').allowed).toBe(true);
  });

  it('no effective child scope -> allowed (nothing to mismatch)', () => {
    expect(evaluatePersonaScope(persona, 'parent-1', undefined).allowed).toBe(true);
    expect(evaluatePersonaScope(persona, 'parent-1', null).allowed).toBe(true);
    expect(evaluatePersonaScope(persona, 'parent-1', '').allowed).toBe(true);
  });
});
