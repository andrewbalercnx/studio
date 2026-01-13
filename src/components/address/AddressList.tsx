'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddressCard } from './AddressCard';
import { AddressForm, type AddressFormData } from './AddressForm';
import type { SavedAddress } from '@/lib/types';

export type AddressListProps = {
  className?: string;
};

export function AddressList({ className = '' }: AddressListProps) {
  const { toast } = useToast();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingAddress, setDeletingAddress] = useState<SavedAddress | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
    } catch (err: any) {
      console.error('[AddressList] Error fetching addresses:', err);
      setError(err.message || 'Failed to load addresses');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const handleAddClick = () => {
    setEditingAddress(null);
    setFormOpen(true);
  };

  const handleEditClick = (address: SavedAddress) => {
    setEditingAddress(address);
    setFormOpen(true);
  };

  const handleDeleteClick = (address: SavedAddress) => {
    setDeletingAddress(address);
    setDeleteDialogOpen(true);
  };

  const handleSetDefault = async (address: SavedAddress) => {
    try {
      const token = await getIdToken();
      const response = await fetch(`/api/user/addresses/${address.id}/default`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to set default');
      }
      toast({ title: 'Default address updated' });
      await fetchAddresses();
    } catch (err: any) {
      console.error('[AddressList] Error setting default:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to set default address',
        variant: 'destructive',
      });
    }
  };

  const handleFormSubmit = async (data: AddressFormData) => {
    const token = await getIdToken();

    if (editingAddress) {
      // Update existing address
      const response = await fetch(`/api/user/addresses/${editingAddress.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error || 'Failed to update address');
      }
      toast({ title: 'Address updated' });
    } else {
      // Create new address
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
      toast({ title: 'Address added' });
    }

    await fetchAddresses();
  };

  const handleDeleteConfirm = async () => {
    if (!deletingAddress) return;

    try {
      setDeleteLoading(true);
      const token = await getIdToken();
      const response = await fetch(`/api/user/addresses/${deletingAddress.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to delete address');
      }
      toast({ title: 'Address deleted' });
      setDeleteDialogOpen(false);
      await fetchAddresses();
    } catch (err: any) {
      console.error('[AddressList] Error deleting address:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete address',
        variant: 'destructive',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchAddresses}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      {addresses.length === 0 ? (
        <div className="text-center py-8 border rounded-lg bg-muted/50">
          <p className="text-muted-foreground mb-4">No saved addresses yet</p>
          <Button onClick={handleAddClick}>
            <Plus className="mr-2 h-4 w-4" />
            Add Your First Address
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3">
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                onEdit={handleEditClick}
                onDelete={handleDeleteClick}
                onSetDefault={handleSetDefault}
              />
            ))}
          </div>
          <Button variant="outline" onClick={handleAddClick}>
            <Plus className="mr-2 h-4 w-4" />
            Add New Address
          </Button>
        </div>
      )}

      {/* Add/Edit Form Dialog */}
      <AddressForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleFormSubmit}
        initialData={editingAddress}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Address</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this address
              {deletingAddress?.label && ` (${deletingAddress.label})`}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
