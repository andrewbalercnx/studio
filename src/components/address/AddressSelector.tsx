'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { LoaderCircle, Plus, ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { AddressCard } from './AddressCard';
import { AddressForm, type AddressFormData } from './AddressForm';
import type { SavedAddress, PrintOrderAddress } from '@/lib/types';

export type AddressSelectorProps = {
  onAddressSelected: (address: PrintOrderAddress) => void;
  selectedAddressId?: string | null;
  className?: string;
  label?: string;
  showAddNew?: boolean;
};

export function AddressSelector({
  onAddressSelected,
  selectedAddressId,
  className = '',
  label = 'Shipping Address',
  showAddNew = true,
}: AddressSelectorProps) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(selectedAddressId ?? null);

  // Add new address dialog
  const [formOpen, setFormOpen] = useState(false);

  const getIdToken = useCallback(async () => {
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken();
  }, []);

  const fetchAddresses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getIdToken();
      const response = await fetch('/api/user/addresses', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to fetch addresses');
      }
      setAddresses(data.addresses || []);

      // If no address selected and we have addresses, select the default
      if (!selectedId && data.addresses?.length > 0) {
        const defaultAddr = data.addresses.find((a: SavedAddress) => a.isDefault) || data.addresses[0];
        handleSelectAddress(defaultAddr);
      }
    } catch (err: any) {
      console.error('[AddressSelector] Error fetching addresses:', err);
      setError(err.message || 'Failed to load addresses');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, selectedId]);

  useEffect(() => {
    fetchAddresses();
  }, []);

  useEffect(() => {
    if (selectedAddressId !== undefined) {
      setSelectedId(selectedAddressId);
    }
  }, [selectedAddressId]);

  const handleSelectAddress = (address: SavedAddress) => {
    setSelectedId(address.id);
    setIsOpen(false);
    onAddressSelected({
      name: address.name,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    });
  };

  const handleFormSubmit = async (data: AddressFormData) => {
    const token = await getIdToken();
    const response = await fetch('/api/user/addresses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Failed to create address');
    }

    // Refresh addresses and select the new one
    await fetchAddresses();
    if (result.address) {
      handleSelectAddress(result.address);
    }
  };

  const selectedAddress = addresses.find((a) => a.id === selectedId);

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label>{label}</Label>
        <div className="flex items-center justify-center py-4 border rounded-lg">
          <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading addresses...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label>{label}</Label>
        <div className="text-center py-4 border rounded-lg">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchAddresses}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // No addresses yet
  if (addresses.length === 0) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Label>{label}</Label>
        <div className="text-center py-6 border rounded-lg bg-muted/50">
          <p className="text-sm text-muted-foreground mb-3">No saved addresses</p>
          {showAddNew && (
            <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Address
            </Button>
          )}
        </div>

        <AddressForm
          open={formOpen}
          onOpenChange={setFormOpen}
          onSubmit={handleFormSubmit}
        />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-auto py-3 px-4"
            type="button"
          >
            <div className="text-left">
              {selectedAddress ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    {selectedAddress.label && (
                      <span className="font-medium">{selectedAddress.label}</span>
                    )}
                    {selectedAddress.isDefault && (
                      <span className="text-xs text-muted-foreground">(Default)</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {selectedAddress.name}, {selectedAddress.line1}, {selectedAddress.city}, {selectedAddress.postalCode}
                  </div>
                </div>
              ) : (
                <span className="text-muted-foreground">Select an address</span>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-2">
          <div className="border rounded-lg overflow-hidden">
            {addresses.map((address, index) => (
              <div
                key={address.id}
                className={index < addresses.length - 1 ? 'border-b' : ''}
              >
                <AddressCard
                  address={address}
                  showActions={false}
                  selected={address.id === selectedId}
                  onClick={handleSelectAddress}
                  className="border-0 rounded-none"
                />
              </div>
            ))}

            {showAddNew && (
              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setFormOpen(true)}
                  type="button"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add New Address
                </Button>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AddressForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleFormSubmit}
      />
    </div>
  );
}
