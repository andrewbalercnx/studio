
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
import Link from 'next/link';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';
import { createHmac } from 'crypto';

function hashPin(pin: string): string {
    const salt = process.env.NEXT_PUBLIC_PIN_SALT || 'default-super-secret-salt';
    if (!salt) {
        console.warn('PIN_SALT environment variable is not set. Using a default salt.');
    }
    return createHmac('sha256', salt).update(pin).digest('hex');
}


export function PinForm({ onPinVerified, onOpenChange }: { onPinVerified: () => void, onOpenChange: (open: boolean) => void }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const { toast } = useToast();

  const hasPinSetup = !!userProfile?.pinHash;

  useEffect(() => {
    async function checkPinStatus() {
      if (!user || !firestore) {
        setIsLoading(false);
        return;
      }
      try {
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        }
      } catch (e) {
        console.error("Failed to check for PIN", e);
        toast({ title: "Error", description: "Could not fetch user profile for PIN check.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }
    checkPinStatus();
  }, [user, firestore, toast]);

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    if (!userProfile?.pinHash) {
        toast({ title: 'Error', description: 'No PIN is set for this account.', variant: 'destructive'});
        return;
    }

    setIsLoading(true);
    
    const enteredPinHash = hashPin(pin);

    if (enteredPinHash === userProfile.pinHash) {
        toast({ title: 'PIN Verified!' });
        onPinVerified();
    } else {
        toast({ title: 'Incorrect PIN', variant: 'destructive' });
        setPin('');
    }

    setIsLoading(false);
  };

  if (isLoading) {
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
            <DialogTitle className="flex items-center gap-2"><AlertCircle className="text-amber-500" /> Parent PIN Required</DialogTitle>
            <DialogDescription className="pt-2">
              To protect sensitive areas, you need to set up a 4-digit Parent PIN first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
             <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button asChild>
                <Link href="/parent/settings">Go to Settings</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
     )
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
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="****"
            className="text-center text-2xl tracking-[1rem]"
            autoComplete="one-time-code"
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
