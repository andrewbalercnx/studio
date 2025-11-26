
'use client';

import { useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle } from 'lucide-react';
import { ParentGuard } from '@/components/parent/parent-guard';
import { useEffect } from 'react';
import type { UserProfile } from '@/lib/types';
import { getAuth } from 'firebase/auth';

export default function ParentSettingsPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user || !firestore) return;
    const unsub = onSnapshot(doc(firestore, 'users', user.uid), (doc) => {
      setUserProfile(doc.data() as UserProfile);
    });
    return () => unsub();
  }, [user, firestore]);

  const handleSetPin = async () => {
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits', variant: 'destructive' });
      return;
    }
    if (pin !== confirmPin) {
      toast({ title: 'PINs do not match', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("You must be logged in to set a PIN.");
      }
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/parent/set-pin', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ pin }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.message || 'Failed to set PIN');
      }
      toast({ title: 'PIN has been set successfully!' });
      setPin('');
      setConfirmPin('');
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (userLoading) {
    return <div className="flex justify-center items-center h-screen"><LoaderCircle className="animate-spin" /></div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Parent Settings</CardTitle>
          <CardDescription>Manage your account settings and security.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">{userProfile?.pinHash ? 'Change your PIN' : 'Set your Parent PIN'}</h3>
            <p className="text-sm text-muted-foreground">
              This 4-digit PIN is used to access parent-only sections of the app.
            </p>
            <div className="space-y-2">
              <Label htmlFor="pin">New PIN</Label>
              <Input
                id="pin"
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPin">Confirm New PIN</Label>
              <Input
                id="confirmPin"
                type="password"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="****"
              />
            </div>
            <Button onClick={handleSetPin} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="animate-spin mr-2" /> : null}
              {userProfile?.pinHash ? 'Change PIN' : 'Set PIN'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
