'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoaderCircle, Search, MapPin } from 'lucide-react';
import type { PostcodeLookupAddress, PostcodeLookupResponse } from '@/app/api/postcode/lookup/route';
import type { PrintOrderAddress } from '@/lib/types';

export type PostcodeLookupProps = {
  onAddressSelected: (address: Omit<PrintOrderAddress, 'name'>) => void;
  onManualEntry?: () => void;
  className?: string;
};

export function PostcodeLookup({
  onAddressSelected,
  onManualEntry,
  className = '',
}: PostcodeLookupProps) {
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<PostcodeLookupAddress[] | null>(null);
  const [formattedPostcode, setFormattedPostcode] = useState<string>('');

  const handleSearch = async () => {
    if (!postcode.trim()) {
      setError('Please enter a postcode');
      return;
    }

    setLoading(true);
    setError(null);
    setAddresses(null);

    try {
      const response = await fetch(
        `/api/postcode/lookup?postcode=${encodeURIComponent(postcode.trim())}`
      );
      const data: PostcodeLookupResponse = await response.json();

      if (!data.ok) {
        setError(data.error || 'Failed to lookup postcode');
        return;
      }

      if (!data.addresses || data.addresses.length === 0) {
        setError('No addresses found for this postcode');
        return;
      }

      setAddresses(data.addresses);
      setFormattedPostcode(data.postcode || postcode.trim().toUpperCase());
    } catch (err) {
      console.error('[PostcodeLookup] Error:', err);
      setError('Failed to lookup postcode. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleSelectAddress = (addr: PostcodeLookupAddress) => {
    onAddressSelected({
      line1: addr.line1,
      line2: addr.line2 || undefined,
      city: addr.city,
      state: addr.county,
      postalCode: addr.postalCode,
      country: addr.country,
    });
    // Clear the lookup after selection
    setAddresses(null);
    setPostcode('');
  };

  const handleManualEntry = () => {
    setAddresses(null);
    setPostcode('');
    setError(null);
    onManualEntry?.();
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="space-y-2">
        <Label htmlFor="postcode-lookup">Find address by postcode</Label>
        <div className="flex gap-2">
          <Input
            id="postcode-lookup"
            type="text"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="e.g. SW1A 1AA"
            className="flex-1 uppercase"
            disabled={loading}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleSearch}
            disabled={loading || !postcode.trim()}
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">Find</span>
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {addresses && addresses.length > 0 && (
        <div className="space-y-2">
          <Label>Select your address ({addresses.length} found)</Label>
          <div className="max-h-60 overflow-y-auto border rounded-md">
            {addresses.map((addr) => (
              <button
                key={addr.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent transition-colors border-b last:border-b-0 flex items-start gap-2"
                onClick={() => handleSelectAddress(addr)}
              >
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                <span className="text-sm">{addr.displayAddress}</span>
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleManualEntry}
            className="text-muted-foreground"
          >
            Can&apos;t find your address? Enter manually
          </Button>
        </div>
      )}

      {!addresses && !loading && onManualEntry && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={handleManualEntry}
          className="text-muted-foreground p-0 h-auto"
        >
          Or enter address manually
        </Button>
      )}
    </div>
  );
}
