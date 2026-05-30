/**
 * In-memory ring buffer for recent server-side log lines.
 * Only populated in non-production environments (via console monkey-patch in instrumentation.ts).
 *
 * Stored on globalThis so the same buffer is shared across all Next.js module
 * contexts within a process (instrumentation hook vs. route handlers use separate
 * module caches, so a plain module-level variable would give each its own copy).
 */

const MAX_LINES = 10;

const g = globalThis as any;
if (!g.__devLogBuffer) g.__devLogBuffer = [] as string[];

export function appendLog(line: string): void {
  const buf: string[] = g.__devLogBuffer;
  buf.push(`${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${line}`);
  if (buf.length > MAX_LINES) buf.shift();
}

export function getRecentLogs(): string[] {
  return [...(g.__devLogBuffer as string[])];
}
