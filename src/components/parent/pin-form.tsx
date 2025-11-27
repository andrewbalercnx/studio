
'use client';

import { useState, useEffect } from 'react';
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
import { LoaderCircle, AlertCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';
import { Label } from '@/components/ui/label';


export function PinForm({ onPinVerified, onOpenChange }: { onPinVerified: () => void, onOpenChange: (open: boolean) => void }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isFetchingProfile, setIsFetchingProfile] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const { toast } = useToast();

  const hasPinSetup = !!userProfile?.pinHash;

  useEffect(() => {
    if (!user || !firestore) {
      setIsFetchingProfile(false);
      return;
    }

    setIsFetchingProfile(true);
    const unsubscribe = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          setUserProfile(snapshot.data() as UserProfile);
        } else {
          setUserProfile(null);
        }
        setIsFetchingProfile(false);
      },
      (error) => {
        console.error('Failed to read user profile for PIN guard', error);
        toast({ title: 'Error', description: 'Could not fetch user profile for PIN check.', variant: 'destructive' });
        setUserProfile(null);
        setIsFetchingProfile(false);
      }
    );

    return () => unsubscribe();
  }, [user, firestore, toast]);

  const handleCreatePin = async () => {
    if (pin.length !== 4 || confirmPin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    if (pin !== confirmPin) {
      toast({ title: 'PINs do not match', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Error', description: 'You need to sign in again.', variant: 'destructive' });
      return;
    }

    setIsSettingPin(true);
    try {
      const idToken = await user.getIdToken(true);
      const query = new URLSearchParams({ idToken }).toString();
      const response = await fetch(`/api/parent/set-pin?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        cache: 'no-store',
        body: JSON.stringify({ pin, idToken }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result?.message || 'Failed to set PIN');
      }
      toast({ title: 'PIN created!' });
      setPin('');
      setConfirmPin('');
      onPinVerified();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Unable to set PIN.', variant: 'destructive' });
    } finally {
      setIsSettingPin(false);
    }
  };

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    if (!hasPinSetup) {
        toast({ title: 'Error', description: 'No PIN is set for this account.', variant: 'destructive'});
        return;
    }
    if (!user) {
      toast({ title: 'Error', description: 'You need to sign in again.', variant: 'destructive' });
      return;
    }

    setIsVerifying(true);
    try {
      const idToken = await user.getIdToken(true);
      const query = new URLSearchParams({ idToken }).toString();
      const response = await fetch(`/api/parent/verify-pin?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        cache: 'no-store',
        body: JSON.stringify({ pin, idToken }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        toast({
          title: result?.message || 'PIN verification failed',
          variant: 'destructive',
        });
        setPin('');
        return;
      }

      toast({ title: 'PIN verified!' });
      setPin('');
      onPinVerified();
    } catch (error: any) {
      console.error('Failed to verify PIN', error);
      toast({ title: 'Error', description: error.message || 'Unable to verify PIN.', variant: 'destructive' });
    } finally {
      setIsVerifying(false);
    }
  };

  if (isFetchingProfile) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex justify-center items-center p-8">
            <LoaderCircle className="animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!hasPinSetup) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="text-amber-500" /> Secure Your Parent Space
            </DialogTitle>
            <DialogDescription className="pt-2">
              Create a 4-digit Parent PIN to unlock parent-only tools.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-pin">New PIN</Label>
              <Input
                id="new-pin"
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="****"
                className="text-center tracking-[1rem]"
                autoComplete="one-time-code"
                disabled={isSettingPin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pin">Confirm PIN</Label>
              <Input
                id="confirm-pin"
                type="password"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="****"
                className="text-center tracking-[1rem]"
                autoComplete="one-time-code"
                disabled={isSettingPin}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-2">
            <Button onClick={handleCreatePin} disabled={isSettingPin} className="w-full">
              {isSettingPin ? <LoaderCircle className="animate-spin" /> : 'Create PIN'}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSettingPin}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
          onKeyDown={(e) => e.key === 'Enter' && !isVerifying && handleSubmit()}
          placeholder="****"
          className="text-center text-2xl tracking-[1rem]"
          autoComplete="one-time-code"
          disabled={isVerifying}
        />
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={isVerifying} className="w-full">
          {isVerifying ? <LoaderCircle className="animate-spin" /> : 'Unlock'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
}
