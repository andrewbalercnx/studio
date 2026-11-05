'use client';

/** The parent's support tickets (Sprint W3-C): tracked issue reports and where they're up to. */
import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { ReportIssueButton } from '@/components/report-issue-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TicketStatus } from '@/lib/types';

type TicketRow = {
  id: string;
  message: string;
  pagePath: string;
  status: TicketStatus;
  resolutionNote: string | null;
  createdAtIso: string | null;
  updatedAtIso: string | null;
};

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function ticketBadgeVariant(status: TicketStatus): 'secondary' | 'default' | 'outline' {
  if (status === 'resolved') return 'default';
  if (status === 'in_progress') return 'outline';
  return 'secondary';
}

function friendlyIsoDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function SupportTickets() {
  const { user } = useUser();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const loadTickets = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/tickets', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.ok && data?.ok) setTickets(data.tickets as TicketRow[]);
    } catch {
      // Tickets are a secondary surface — fail quietly.
    } finally {
      setTicketsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LifeBuoy className="h-5 w-5" />
              Support Tickets
            </CardTitle>
            <CardDescription>
              Issues you&apos;ve reported and where they&apos;re up to.
            </CardDescription>
          </div>
          <ReportIssueButton onReported={loadTickets} />
        </CardHeader>
        <CardContent>
          {ticketsLoading ? (
            <div className="flex justify-center py-4">
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tickets && tickets.length > 0 ? (
            <ul className="divide-y">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ticket.message}</p>
                    <p className="text-xs text-muted-foreground">
                      #{ticket.id.slice(-6)}
                      {friendlyIsoDate(ticket.createdAtIso) ? ` · Reported ${friendlyIsoDate(ticket.createdAtIso)}` : ''}
                    </p>
                    {ticket.status === 'resolved' && ticket.resolutionNote && (
                      <p className="mt-1 text-xs text-emerald-700">{ticket.resolutionNote}</p>
                    )}
                  </div>
                  <Badge variant={ticketBadgeVariant(ticket.status)} className="shrink-0">
                    {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              No tickets — if anything goes wrong, use &quot;Report Issue&quot; and we&apos;ll track it here.
            </p>
          )}
        </CardContent>
      </Card>
  );
}
