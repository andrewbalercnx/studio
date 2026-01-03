'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, LoaderCircle, Send } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useToast } from '@/hooks/use-toast';

interface ReportIssueButtonProps {
  /** Additional diagnostic data to include in the report */
  diagnostics?: Record<string, any>;
  /** Custom class name for the button */
  className?: string;
}

export function ReportIssueButton({ diagnostics, className }: ReportIssueButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const pathname = usePathname();
  const { user } = useUser();
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be signed in to report an issue',
        variant: 'destructive',
      });
      return;
    }

    if (!message.trim()) {
      toast({
        title: 'Error',
        description: 'Please describe the issue',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/report-issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: message.trim(),
          pagePath: pathname,
          diagnostics: {
            ...diagnostics,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            screenSize: typeof window !== 'undefined'
              ? `${window.innerWidth}x${window.innerHeight}`
              : undefined,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast({
          title: 'Issue Reported',
          description: 'Thank you! Your issue has been sent to our maintenance team.',
        });
        setMessage('');
        setOpen(false);
      } else {
        toast({
          title: 'Failed to Report Issue',
          description: data.error || 'Please try again later',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to report issue',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          title="Report an issue"
        >
          <AlertTriangle className="h-4 w-4" />
          <span className="sr-only">Report Issue</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Report an Issue
          </DialogTitle>
          <DialogDescription>
            Describe the problem you&apos;re experiencing. Our maintenance team will be notified immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="issue-message">What went wrong?</Label>
            <Textarea
              id="issue-message"
              placeholder="Please describe the issue you encountered..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            <p>The following information will be included:</p>
            <ul className="mt-1 list-disc list-inside">
              <li>Current page: {pathname}</li>
              <li>Your email: {user?.email}</li>
              <li>Browser and screen information</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSending || !message.trim()}>
            {isSending ? (
              <>
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
