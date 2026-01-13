'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { useToast } from '@/hooks/use-toast';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { LoaderCircle, ArrowLeft, Plus, Trash2, Pencil, MapPin, Building2, Save } from 'lucide-react';
import { PostcodeLookup } from '@/components/address';
import type { SavedAddress, SystemAddressConfig, PrintOrderAddress } from '@/lib/types';

type AddressFormData = {
  id?: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  label: string;
};

const EMPTY_ADDRESS: AddressFormData = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'GB',
  label: '',
};

export default function SystemAddressesPage() {
  const { isAdmin, loading: authLoading } = useAdminStatus();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [mixamBillToAddressId, setMixamBillToAddressId] = useState<string | null>(null);

  // Edit form state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<AddressFormData>(EMPTY_ADDRESS);
  const [showForm, setShowForm] = useState(false);

  // Delete confirmation
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const getIdToken = useCallback(async () => {
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken();
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getIdToken();
      const response = await fetch('/api/admin/system-config/addresses', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to fetch system addresses');
      }
      setAddresses(data.config?.addresses || []);
      setMixamBillToAddressId(data.config?.mixamBillToAddressId || null);
    } catch (err: any) {
      console.error('[SystemAddressesPage] Error:', err);
      setError(err.message || 'Failed to load system addresses');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (isAdmin) {
      fetchConfig();
    }
  }, [isAdmin, fetchConfig]);

  const handleSaveConfig = async () => {
    try {
      setSaving(true);
      const token = await getIdToken();
      const response = await fetch('/api/admin/system-config/addresses', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          addresses,
          mixamBillToAddressId,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to save system addresses');
      }
      toast({ title: 'System addresses saved successfully' });
      // Refresh to get server-processed data
      await fetchConfig();
    } catch (err: any) {
      console.error('[SystemAddressesPage] Save error:', err);
      toast({
        title: 'Error saving addresses',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddNew = () => {
    setEditingIndex(null);
    setFormData(EMPTY_ADDRESS);
    setShowForm(true);
  };

  const handleEdit = (index: number) => {
    const addr = addresses[index];
    setEditingIndex(index);
    setFormData({
      id: addr.id,
      name: addr.name,
      line1: addr.line1,
      line2: addr.line2 || '',
      city: addr.city,
      state: addr.state || '',
      postalCode: addr.postalCode,
      country: addr.country || 'GB',
      label: addr.label || '',
    });
    setShowForm(true);
  };

  const handleFormSubmit = () => {
    if (!formData.name || !formData.line1 || !formData.city || !formData.postalCode) {
      toast({
        title: 'Missing required fields',
        description: 'Please fill in name, address line 1, city, and postcode',
        variant: 'destructive',
      });
      return;
    }

    const newAddress: SavedAddress = {
      id: formData.id || `sys_${Date.now()}`,
      name: formData.name,
      line1: formData.line1,
      line2: formData.line2 || undefined,
      city: formData.city,
      state: formData.state,
      postalCode: formData.postalCode,
      country: formData.country || 'GB',
      label: formData.label || undefined,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (editingIndex !== null) {
      // Update existing
      const updated = [...addresses];
      updated[editingIndex] = { ...addresses[editingIndex], ...newAddress };
      setAddresses(updated);
    } else {
      // Add new
      setAddresses([...addresses, newAddress]);
    }

    setShowForm(false);
    setFormData(EMPTY_ADDRESS);
    setEditingIndex(null);
  };

  const handleDelete = (index: number) => {
    setDeleteIndex(index);
  };

  const confirmDelete = () => {
    if (deleteIndex === null) return;

    const addressToDelete = addresses[deleteIndex];
    const updated = addresses.filter((_, i) => i !== deleteIndex);
    setAddresses(updated);

    // Clear mixam bill-to if we're deleting it
    if (addressToDelete.id === mixamBillToAddressId) {
      setMixamBillToAddressId(null);
    }

    setDeleteIndex(null);
  };

  const handlePostcodeLookup = (addr: Omit<PrintOrderAddress, 'name'>) => {
    setFormData((prev) => ({
      ...prev,
      line1: addr.line1,
      line2: addr.line2 || '',
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country,
    }));
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto p-8 flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-destructive">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-destructive mb-4">{error}</p>
        <Button onClick={fetchConfig}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Admin
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            System Addresses
          </CardTitle>
          <CardDescription>
            Configure system-wide addresses used for Mixam billing and operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Address List */}
          {addresses.length === 0 ? (
            <div className="text-center py-8 border rounded-lg bg-muted/50">
              <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground mb-4">No system addresses configured</p>
              <Button onClick={handleAddNew}>
                <Plus className="mr-2 h-4 w-4" />
                Add First Address
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Mixam Bill-To Address</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Select which address should be used as the billing address for Mixam orders.
                </p>
                <RadioGroup
                  value={mixamBillToAddressId || ''}
                  onValueChange={(value) => setMixamBillToAddressId(value || null)}
                >
                  {addresses.map((addr, index) => (
                    <div
                      key={addr.id}
                      className="flex items-start gap-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <RadioGroupItem value={addr.id} id={addr.id} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <label htmlFor={addr.id} className="cursor-pointer">
                          <div className="flex items-center gap-2 mb-1">
                            {addr.label && (
                              <span className="font-medium text-sm">{addr.label}</span>
                            )}
                            {addr.id === mixamBillToAddressId && (
                              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                                Bill-To
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground space-y-0.5">
                            <p className="font-medium text-foreground">{addr.name}</p>
                            <p>{addr.line1}</p>
                            {addr.line2 && <p>{addr.line2}</p>}
                            <p>{addr.city}{addr.state && `, ${addr.state}`}</p>
                            <p>{addr.postalCode}</p>
                          </div>
                        </label>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(index)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(index)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <Button variant="outline" onClick={handleAddNew}>
                <Plus className="mr-2 h-4 w-4" />
                Add Address
              </Button>
            </div>
          )}

          {/* Save Button */}
          {addresses.length > 0 && (
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSaveConfig} disabled={saving}>
                {saving ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Form Dialog */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>{editingIndex !== null ? 'Edit Address' : 'Add New Address'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PostcodeLookup onAddressSelected={handlePostcodeLookup} />

              <div className="border-t pt-4 space-y-4">
                <div>
                  <Label htmlFor="label">Label</Label>
                  <Input
                    id="label"
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    placeholder="e.g. Head Office, Warehouse"
                  />
                </div>

                <div>
                  <Label htmlFor="name">
                    Contact Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="line1">
                    Address Line 1 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="line1"
                    value={formData.line1}
                    onChange={(e) => setFormData({ ...formData, line1: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="line2">Address Line 2</Label>
                  <Input
                    id="line2"
                    value={formData.line2}
                    onChange={(e) => setFormData({ ...formData, line2: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="city">
                      City <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="state">County</Label>
                    <Input
                      id="state"
                      value={formData.state}
                      onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="postalCode">
                    Postcode <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value.toUpperCase() })}
                    className="uppercase"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button onClick={handleFormSubmit}>
                  {editingIndex !== null ? 'Update' : 'Add'} Address
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteIndex !== null} onOpenChange={() => setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Address</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this system address
              {deleteIndex !== null && addresses[deleteIndex]?.label
                ? ` (${addresses[deleteIndex].label})`
                : ''}
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
