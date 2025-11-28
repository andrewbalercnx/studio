'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { LoaderCircle, CheckCircle2 } from 'lucide-react';
import type { StoryBookFinalization } from '@/lib/types';

type PrintOrderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  finalization?: StoryBookFinalization | null;
  onSuccess?: (orderId: string) => void;
};

type FormState = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  quantity: number;
  contactEmail: string;
};

const DEFAULT_COUNTRY = 'USA';

export function PrintOrderDialog({ open, onOpenChange, bookId, finalization, onSuccess }: PrintOrderDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const defaultName = useMemo(() => {
    if (finalization?.finalizedMetadata?.childName) {
      return `${finalization.finalizedMetadata.childName}'s Family`;
    }
    if (finalization?.lockedByDisplayName) {
      return finalization.lockedByDisplayName;
    }
    return finalization?.lockedByEmail ?? '';
  }, [finalization]);
  const [formValues, setFormValues] = useState<FormState>({
    name: defaultName ?? '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: DEFAULT_COUNTRY,
    quantity: 1,
    contactEmail: user?.email ?? '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormValues((prev) => ({
        ...prev,
        name: prev.name || defaultName || '',
        contactEmail: prev.contactEmail || user?.email || '',
      }));
      setLastOrderId(null);
    }
  }, [open, defaultName, user]);

  const handleChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = field === 'quantity' ? Number(event.target.value || 0) : event.target.value;
    setFormValues((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({ title: 'Sign in required', description: 'Please sign in again to place an order.', variant: 'destructive' });
      return;
    }
    if (!formValues.name || !formValues.line1 || !formValues.city || !formValues.state || !formValues.postalCode) {
      toast({ title: 'Missing fields', description: 'Please complete the shipping address.', variant: 'destructive' });
      return;
    }
    if (formValues.quantity < 1) {
      toast({ title: 'Quantity must be at least 1', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/printOrders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookId,
          quantity: formValues.quantity,
          shippingAddress: {
            name: formValues.name,
            line1: formValues.line1,
            line2: formValues.line2 ?? '',
            city: formValues.city,
            state: formValues.state,
            postalCode: formValues.postalCode,
            country: formValues.country,
          },
          contactEmail: formValues.contactEmail,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.errorMessage || 'Failed to create print order.');
      }
      toast({ title: 'Order created', description: 'We saved your shipping details.' });
      setLastOrderId(result.orderId);
      onSuccess?.(result.orderId);
    } catch (error: any) {
      toast({ title: 'Order failed', description: error?.message ?? 'Unexpected error creating order.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!user || !lastOrderId) return;
    setMarkingPaid(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/printOrders/${lastOrderId}/pay`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.errorMessage || 'Failed to mark as paid.');
      }
      toast({ title: 'Marked as paid', description: 'Payment has been simulated.' });
    } catch (error: any) {
      toast({ title: 'Payment update failed', description: error?.message ?? 'Could not mark as paid.', variant: 'destructive' });
    } finally {
      setMarkingPaid(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Printed Copies</DialogTitle>
          <DialogDescription>
            Confirm the shipping details for your storybook. Printable PDF version {finalization?.version ?? 1} is attached to this order request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ship-name">Recipient Name</Label>
              <Input id="ship-name" value={formValues.name} onChange={handleChange('name')} placeholder="Who should we mail it to?" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ship-line1">Street Address</Label>
              <Input id="ship-line1" value={formValues.line1} onChange={handleChange('line1')} placeholder="123 Storybook Lane" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ship-line2">Apartment / Suite (optional)</Label>
              <Input id="ship-line2" value={formValues.line2 ?? ''} onChange={handleChange('line2')} placeholder="Unit, floor, etc." />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label htmlFor="ship-city">City</Label>
                <Input id="ship-city" value={formValues.city} onChange={handleChange('city')} placeholder="City" />
              </div>
              <div>
                <Label htmlFor="ship-state">State / Region</Label>
                <Input id="ship-state" value={formValues.state} onChange={handleChange('state')} placeholder="State or region" />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label htmlFor="ship-postal">Postal Code</Label>
                <Input id="ship-postal" value={formValues.postalCode} onChange={handleChange('postalCode')} placeholder="Zip / postal code" />
              </div>
              <div>
                <Label htmlFor="ship-country">Country</Label>
                <Input id="ship-country" value={formValues.country} onChange={handleChange('country')} placeholder="Country" />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={1}
                  value={formValues.quantity}
                  onChange={handleChange('quantity')}
                />
              </div>
              <div>
                <Label htmlFor="contact-email">Contact Email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={formValues.contactEmail}
                  onChange={handleChange('contactEmail')}
                  placeholder="you@example.com"
                />
              </div>
            </div>
          </div>
          {finalization?.printablePdfUrl ? (
            <p className="rounded-md bg-muted/40 p-3 text-sm">
              Printable file:{' '}
              <a href={finalization.printablePdfUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
                download PDF
              </a>
            </p>
          ) : (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              A printable PDF has not been generated yet. You can still submit the address and generate the PDF afterwards.
            </p>
          )}
          {lastOrderId && (
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Order #{lastOrderId.slice(-6)} created.
              </p>
              <p className="text-muted-foreground">Use the test payment button below or review the order later in Parent → Orders.</p>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-col gap-3 sm:flex-col">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Close
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit Order Request
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!lastOrderId || markingPaid}
            onClick={handleMarkPaid}
            className="w-full"
          >
            {markingPaid ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            Mark as Paid (test)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
