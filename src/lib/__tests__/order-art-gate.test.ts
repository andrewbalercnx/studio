import { describe, it, expect } from 'vitest';
import { evaluateOrderArtGate, deriveStorybookArtStatus } from '../storybook-status';

const status = (
  completeness: 'none' | 'in_progress' | 'degraded' | 'failed' | 'complete',
  isOrderable: boolean
) => ({ completeness, isOrderable });

describe('evaluateOrderArtGate', () => {
  it('fails open when no rollup is available (legacy books)', () => {
    expect(evaluateOrderArtGate(null)).toEqual({ allowed: true, requiresAcknowledgement: false });
    expect(evaluateOrderArtGate(undefined)).toEqual({ allowed: true, requiresAcknowledgement: false });
  });

  it('allows complete books without acknowledgement', () => {
    const gate = evaluateOrderArtGate(status('complete', true));
    expect(gate.allowed).toBe(true);
    expect(gate.requiresAcknowledgement).toBe(false);
  });

  it('blocks degraded books WITHOUT acknowledgement', () => {
    const gate = evaluateOrderArtGate(status('degraded', true), false);
    expect(gate.allowed).toBe(false);
    expect(gate.requiresAcknowledgement).toBe(true);
    expect(gate.reason).toBe('degraded_confirmation_required');
  });

  it('allows degraded books WITH acknowledgement', () => {
    const gate = evaluateOrderArtGate(status('degraded', true), true);
    expect(gate.allowed).toBe(true);
    expect(gate.requiresAcknowledgement).toBe(false);
  });

  it('blocks non-orderable books regardless of acknowledgement', () => {
    for (const completeness of ['failed', 'none', 'in_progress'] as const) {
      const gate = evaluateOrderArtGate(status(completeness, false), true);
      expect(gate.allowed).toBe(false);
      expect(gate.requiresAcknowledgement).toBe(false);
      expect(gate.reason).toBe('not_orderable');
    }
  });

  it('composes with deriveStorybookArtStatus (degraded book end-to-end)', () => {
    const pages = [
      { id: 'a', kind: 'image', imagePrompt: 'x', imageStatus: 'ready' },
      { id: 'b', kind: 'image', imagePrompt: 'x', imageStatus: 'error' },
    ] as any[];
    const artStatus = deriveStorybookArtStatus(pages);
    expect(artStatus.completeness).toBe('degraded');

    expect(evaluateOrderArtGate(artStatus, false).requiresAcknowledgement).toBe(true);
    expect(evaluateOrderArtGate(artStatus, true).allowed).toBe(true);
  });
});
