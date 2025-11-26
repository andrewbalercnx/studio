
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
import { getAuth } from 'firebase/auth';

export function PinForm({ onPinVerified, onOpenChange }: { onPinVerified: () => void, onOpenChange: (open: boolean) => void }) {
  const { user } = useUser();
  const firestore = useFirestore();
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [hasPinSetup, setHasPinSetup] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    async function checkPinStatus() {
      if (!user || !firestore) {
        setIsLoading(false);
        return;
      }
      try {
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().pinHash) {
          setHasPinSetup(true);
        } else {
          setHasPinSetup(false);
        }
      } catch (e) {
        console.error("Failed to check for PIN", e);
        setHasPinSetup(false);
      } finally {
        setIsLoading(false);
      }
    }
    checkPinStatus();
  }, [user, firestore]);

  const handleSubmit = async () => {
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
        const auth = getAuth();
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("You must be logged in to verify a PIN.");
        }
        const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/parent/verify-pin', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
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
      setPin('');
    } finally {
      setIsLoading(false);
    }
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
