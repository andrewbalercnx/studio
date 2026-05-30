import { describe, it, expect, beforeEach } from 'vitest';
import { appendLog, getRecentLogs } from '@/lib/dev-log-buffer';

// Reset the shared globalThis buffer before each test so tests are isolated
beforeEach(() => {
  (globalThis as any).__devLogBuffer = [];
});

describe('getRecentLogs', () => {
  it('returns empty array when nothing logged', () => {
    expect(getRecentLogs()).toEqual([]);
  });

  it('returns a copy — mutations do not affect the buffer', () => {
    appendLog('original');
    const logs = getRecentLogs();
    logs.push('injected');
    expect(getRecentLogs()).toHaveLength(1);
  });
});

describe('appendLog', () => {
  it('adds a line containing the message', () => {
    appendLog('hello world');
    expect(getRecentLogs()[0]).toContain('hello world');
  });

  it('prepends a datetime prefix (YYYY-MM-DD HH:MM:SS)', () => {
    appendLog('test message');
    expect(getRecentLogs()[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} test message$/);
  });

  it('preserves insertion order', () => {
    appendLog('first');
    appendLog('second');
    appendLog('third');
    const logs = getRecentLogs();
    expect(logs[0]).toContain('first');
    expect(logs[1]).toContain('second');
    expect(logs[2]).toContain('third');
  });

  it('caps at 10 lines (ring buffer)', () => {
    for (let i = 0; i < 15; i++) appendLog(`line ${i}`);
    expect(getRecentLogs()).toHaveLength(10);
  });

  it('evicts the oldest line when the buffer is full', () => {
    for (let i = 0; i < 11; i++) appendLog(`line ${i}`);
    const logs = getRecentLogs();
    expect(logs[0]).toContain('line 1');   // line 0 was evicted
    expect(logs[9]).toContain('line 10');
  });

  it('exactly 10 lines does not evict', () => {
    for (let i = 0; i < 10; i++) appendLog(`line ${i}`);
    const logs = getRecentLogs();
    expect(logs).toHaveLength(10);
    expect(logs[0]).toContain('line 0');
  });
});
