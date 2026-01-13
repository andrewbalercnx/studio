'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoaderCircle } from 'lucide-react';
import { PostcodeLookup } from './PostcodeLookup';
import type { SavedAddress, PrintOrderAddress } from '@/lib/types';

export type AddressFormData = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  label?: string;
  isDefault?: boolean;
};

export type AddressFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddressFormData) => Promise<void>;
  initialData?: SavedAddress | null;
  title?: string;
  description?: string;
};

const LABEL_SUGGESTIONS = ['Home', 'Work', "Parent's", "Grandparent's", 'Other'];

export function AddressForm({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title,
  description,
}: AddressFormProps) {
  const [formData, setFormData] = useState<AddressFormData>({
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'GB',
    label: '',
    isDefault: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  const isEditing = !!initialData;

  useEffect(() => {
    if (open) {
      if (initialData) {
        setFormData({
          name: initialData.name || '',
          line1: initialData.line1 || '',
          line2: initialData.line2 || '',
          city: initialData.city || '',
          state: initialData.state || '',
          postalCode: initialData.postalCode || '',
          country: initialData.country || 'GB',
          label: initialData.label || '',
          isDefault: initialData.isDefault || false,
        });
        setShowManualEntry(true);
      } else {
        setFormData({
          name: '',
          line1: '',
          line2: '',
          city: '',
          state: '',
          postalCode: '',
          country: 'GB',
          label: '',
          isDefault: false,
        });
        setShowManualEntry(false);
      }
      setError(null);
    }
  }, [open, initialData]);

  const handleAddressSelected = (address: Omit<PrintOrderAddress, 'name'>) => {
    setFormData((prev) => ({
      ...prev,
      line1: address.line1,
      line2: address.line2 || '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    }));
    setShowManualEntry(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name.trim()) {
      setError('Recipient name is required');
      return;
    }
    if (!formData.line1.trim()) {
      setError('Address line 1 is required');
      return;
    }
    if (!formData.city.trim()) {
      setError('City is required');
      return;
    }
    if (!formData.postalCode.trim()) {
      setError('Postcode is required');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        line2: formData.line2 || undefined,
        label: formData.label || undefined,
      });
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save address');
    } finally {
      setSubmitting(false);
    }
  };

  const defaultTitle = isEditing ? 'Edit Address' : 'Add New Address';
  const defaultDescription = isEditing
    ? 'Update the address details below.'
    : 'Search by postcode to find your address, or enter it manually.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title || defaultTitle}</DialogTitle>
          <DialogDescription>{description || defaultDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Postcode lookup (only for new addresses) */}
          {!isEditing && !showManualEntry && (
            <PostcodeLookup
              onAddressSelected={handleAddressSelected}
              onManualEntry={() => setShowManualEntry(true)}
            />
          )}

          {/* Manual entry form */}
          {(isEditing || showManualEntry) && (
            <>
              {/* Label field with suggestions */}
              <div className="space-y-2">
                <Label htmlFor="label">Label (optional)</Label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {LABEL_SUGGESTIONS.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      variant={formData.label === suggestion ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFormData({ ...formData, label: suggestion })}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g. Home, Work"
                />
              </div>

              {/* Recipient name */}
              <div className="space-y-2">
                <Label htmlFor="name">
                  Recipient Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Full name"
                  required
                />
              </div>

              {/* Address line 1 */}
              <div className="space-y-2">
                <Label htmlFor="line1">
                  Address Line 1 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="line1"
                  value={formData.line1}
                  onChange={(e) => setFormData({ ...formData, line1: e.target.value })}
                  placeholder="House number and street"
                  required
                />
              </div>

              {/* Address line 2 */}
              <div className="space-y-2">
                <Label htmlFor="line2">Address Line 2</Label>
                <Input
                  id="line2"
                  value={formData.line2}
                  onChange={(e) => setFormData({ ...formData, line2: e.target.value })}
                  placeholder="Apartment, suite, etc."
                />
              </div>

              {/* City and County/Region */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">
                    City/Town <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">County/Region</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  />
                </div>
              </div>

              {/* Postcode */}
              <div className="space-y-2">
                <Label htmlFor="postalCode">
                  Postcode <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="postalCode"
                  value={formData.postalCode}
                  onChange={(e) => setFormData({ ...formData, postalCode: e.target.value.toUpperCase() })}
                  placeholder="SW1A 1AA"
                  className="uppercase"
                  required
                />
              </div>

              {/* Country (disabled, UK only) */}
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value="United Kingdom"
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Currently only shipping to UK addresses
                </p>
              </div>

              {/* Set as default checkbox */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isDefault"
                  checked={formData.isDefault}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isDefault: checked === true })
                  }
                />
                <Label htmlFor="isDefault" className="text-sm font-normal cursor-pointer">
                  Set as default shipping address
                </Label>
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            {(isEditing || showManualEntry) && (
              <Button type="submit" disabled={submitting}>
                {submitting && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Save Changes' : 'Add Address'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
