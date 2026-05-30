/**
 * In-memory ring buffer for recent server-side log lines.
 * Only populated in non-production environments (via console monkey-patch in instrumentation.ts).
 * Module-level singleton — works because Next.js server modules are cached per process.
 */

const MAX_LINES = 10;
const buffer: string[] = [];

export function appendLog(line: string): void {
  buffer.push(`${new Date().toISOString().replace('T', ' ').replace('Z', '')} ${line}`);
  if (buffer.length > MAX_LINES) buffer.shift();
}

export function getRecentLogs(): string[] {
  return [...buffer];
}
