import { describe, expect, it } from 'vitest';
import { buildTicketDoc, isTicketStatus, TICKET_MESSAGE_MAX_LENGTH } from '@/lib/tickets';

const NOW = '2026-06-11T12:00:00.000Z';

describe('buildTicketDoc', () => {
  it('creates an open ticket with an auditable status history', () => {
    const result = buildTicketDoc({
      parentUid: 'parent-1',
      contactEmail: 'p@example.com',
      message: '  The book page is blank  ',
      pagePath: '/storybook/abc',
      diagnostics: { userAgent: 'UA', screenSize: '800x600' },
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket.status).toBe('open');
    expect(result.ticket.message).toBe('The book page is blank');
    expect(result.ticket.pagePath).toBe('/storybook/abc');
    expect(result.ticket.parentUid).toBe('parent-1');
    expect(result.ticket.contactEmail).toBe('p@example.com');
    expect(result.ticket.resolutionNote).toBeNull();
    expect(result.ticket.statusHistory).toHaveLength(1);
    expect(result.ticket.statusHistory[0]).toMatchObject({
      status: 'open',
      timestamp: NOW,
      source: 'parent',
    });
  });

  it('rejects missing message or page path (same contract as the old email-only report)', () => {
    expect(
      buildTicketDoc({ parentUid: 'p', message: '', pagePath: '/x', nowIso: NOW })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Message/) });
    expect(
      buildTicketDoc({ parentUid: 'p', message: '   ', pagePath: '/x', nowIso: NOW })
    ).toMatchObject({ ok: false });
    expect(
      buildTicketDoc({ parentUid: 'p', message: 'help', pagePath: undefined, nowIso: NOW })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Page path/) });
    expect(
      buildTicketDoc({ parentUid: '', message: 'help', pagePath: '/x', nowIso: NOW })
    ).toMatchObject({ ok: false });
  });

  it('truncates hostile-length messages', () => {
    const result = buildTicketDoc({
      parentUid: 'p',
      message: 'x'.repeat(TICKET_MESSAGE_MAX_LENGTH + 500),
      pagePath: '/x',
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket.message).toHaveLength(TICKET_MESSAGE_MAX_LENGTH);
  });

  it('sanitises diagnostics: scalars kept, nested values stringified, junk dropped', () => {
    const result = buildTicketDoc({
      parentUid: 'p',
      message: 'help',
      pagePath: '/x',
      nowIso: NOW,
      diagnostics: {
        ok: true,
        count: 3,
        long: 'y'.repeat(5000),
        nested: { a: 1 },
        skipped: undefined,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diag = result.ticket.diagnostics!;
    expect(diag.ok).toBe(true);
    expect(diag.count).toBe(3);
    expect((diag.long as string).length).toBe(1000);
    expect(diag.nested).toBe('{"a":1}');
    expect('skipped' in diag).toBe(false);
  });

  it('treats non-object diagnostics as absent', () => {
    const result = buildTicketDoc({
      parentUid: 'p',
      message: 'help',
      pagePath: '/x',
      nowIso: NOW,
      diagnostics: 'not-an-object',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket.diagnostics).toBeNull();
  });
});

describe('isTicketStatus', () => {
  it('recognises the three ticket statuses', () => {
    expect(isTicketStatus('open')).toBe(true);
    expect(isTicketStatus('in_progress')).toBe(true);
    expect(isTicketStatus('resolved')).toBe(true);
    expect(isTicketStatus('closed')).toBe(false);
  });
});
