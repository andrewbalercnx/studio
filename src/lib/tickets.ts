/**
 * Support tickets (Sprint W3-C).
 *
 * Pure helpers for turning a parent issue report into a tracked `tickets`
 * document. Kept free of Firebase imports so creation logic is unit-testable;
 * the API route supplies timestamps/persistence.
 */
import type { SupportTicket, TicketStatus } from '@/lib/types';

export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'resolved'];

export const TICKET_MESSAGE_MAX_LENGTH = 5000;
export const TICKET_PAGE_PATH_MAX_LENGTH = 512;

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

export type BuildTicketInput = {
  parentUid: string;
  contactEmail?: string | null;
  message: unknown;
  pagePath: unknown;
  diagnostics?: unknown;
  /** ISO timestamp for the statusHistory entry (route passes new Date().toISOString()). */
  nowIso: string;
};

export type BuildTicketResult =
  | { ok: true; ticket: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt'> }
  | { ok: false; error: string };

/**
 * Keep diagnostics storable: plain JSON object, scalar-ish values, capped so a
 * hostile/buggy client can't bloat the doc. Anything unusable becomes null.
 */
function sanitizeDiagnostics(diagnostics: unknown): Record<string, unknown> | null {
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return null;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(diagnostics as Record<string, unknown>)) {
    if (count >= 30) break;
    if (value === undefined) continue;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, 1000);
    } else {
      // Nested objects/arrays: store a truncated JSON string rather than dropping entirely.
      try {
        out[key] = JSON.stringify(value).slice(0, 1000);
      } catch {
        continue;
      }
    }
    count++;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate + shape a new ticket document. Mirrors the previous report-issue
 * validation (message and pagePath required) and adds tracked-ticket fields:
 * status starts 'open' with an auditable statusHistory.
 */
export function buildTicketDoc(input: BuildTicketInput): BuildTicketResult {
  if (!input.parentUid || typeof input.parentUid !== 'string') {
    return { ok: false, error: 'parentUid is required' };
  }
  if (!input.message || typeof input.message !== 'string' || input.message.trim().length === 0) {
    return { ok: false, error: 'Message is required' };
  }
  if (!input.pagePath || typeof input.pagePath !== 'string') {
    return { ok: false, error: 'Page path is required' };
  }

  const ticket: Omit<SupportTicket, 'id' | 'createdAt' | 'updatedAt'> = {
    parentUid: input.parentUid,
    contactEmail: input.contactEmail ?? null,
    message: input.message.trim().slice(0, TICKET_MESSAGE_MAX_LENGTH),
    pagePath: input.pagePath.slice(0, TICKET_PAGE_PATH_MAX_LENGTH),
    status: 'open',
    statusHistory: [
      {
        status: 'open',
        timestamp: input.nowIso,
        note: 'Ticket created from parent issue report',
        source: 'parent',
      },
    ],
    resolutionNote: null,
    diagnostics: sanitizeDiagnostics(input.diagnostics),
  };

  return { ok: true, ticket };
}
