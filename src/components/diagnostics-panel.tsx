'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { useDiagnosticsOptional } from '@/hooks/use-diagnostics';
import { useToast } from '@/hooks/use-toast';

interface DiagnosticsPanelProps {
  title?: string;
  pageName: string;
  data: Record<string, unknown>;
  className?: string;
}

/**
 * A wrapper component for diagnostic panels that respects the system-wide
 * showDiagnosticsPanel setting. Only renders when diagnostics are enabled.
 *
 * Usage:
 * <DiagnosticsPanel
 *   pageName="my-page"
 *   data={{ foo: 'bar', nested: { value: 123 } }}
 * />
 */
export function DiagnosticsPanel({ title = 'Diagnostics', pageName, data, className }: DiagnosticsPanelProps) {
  const diagnostics = useDiagnosticsOptional();
  const { toast } = useToast();

  // Don't render if diagnostics are disabled or context is not available
  if (!diagnostics?.showDiagnosticsPanel) {
    return null;
  }

  const handleCopy = () => {
    const textToCopy = `Page: ${pageName}\n\n${title}\n${JSON.stringify(data, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
  };

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button variant="ghost" size="icon" onClick={handleCopy}>
          <Copy className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

/**
 * A simpler diagnostic output that just logs to console when client logging is enabled.
 * Useful for inline debugging without UI.
 */
export function useClientLog() {
  const diagnostics = useDiagnosticsOptional();

  return (label: string, ...args: unknown[]) => {
    if (diagnostics?.enableClientLogging) {
      console.log(`[${label}]`, ...args);
    }
  };
}
