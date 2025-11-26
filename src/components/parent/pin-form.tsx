
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle } from 'lucide-react';

export function PinForm({ onPinVerified, onOpenChange }: { onPinVerified: () => void, onOpenChange: (open: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/parent/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message || 'Incorrect PIN');
      }
      toast({ title: 'PIN Verified!' });
      onPinVerified();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter Parent PIN</DialogTitle>
          <DialogDescription>
            Please enter your 4-digit PIN to access this page.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="****"
            className="text-center text-2xl tracking-[1rem]"
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isLoading} className="w-full">
            {isLoading ? <LoaderCircle className="animate-spin" /> : 'Unlock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    