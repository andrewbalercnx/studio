
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, setDoc, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

function slugify(text: string) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const auth = useAuth();
  const firestore = useFirestore();

  const handleSignUp = async () => {
    if (!auth || !firestore) {
      toast({
        title: 'Error',
        description: 'Firebase services are not available.',
        variant: 'destructive',
      });
      return;
    }
    if (pin.length !== 4) {
      toast({ title: 'PIN must be 4 digits.', variant: 'destructive' });
      return;
    }
    if (pin !== confirmPin) {
      toast({ title: 'PINs do not match.', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      // 1. Create the Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Prepare user profile and first child in a batch write
      const batch = writeBatch(firestore);

      // User profile doc
      const userDocRef = doc(firestore, 'users', user.uid);
      batch.set(userDocRef, {
        id: user.uid,
        email: user.email,
        roles: {
            isAdmin: false,
            isWriter: false,
            isParent: true,
        },
        createdAt: serverTimestamp(),
      });

      // Default child doc
      const childName = "My First Child";
      const childId = `${slugify(childName)}-${Date.now().toString().slice(-6)}`;
      const childDocRef = doc(firestore, 'children', childId);
      batch.set(childDocRef, {
        id: childId,
        displayName: childName,
        ownerParentUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        avatarUrl: `https://picsum.photos/seed/${childId}/200/200`,
        photos: [],
      });
      
      // 3. Commit the batch
      await batch.commit();
      
      // 4. Call the API to securely set the PIN hash
      const idToken = await user.getIdToken();
      const pinResponse = await fetch('/api/parent/set-pin', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`,
          },
          body: JSON.stringify({ pin }),
      });

      if (!pinResponse.ok) {
          const errorResult = await pinResponse.json();
          // This is a soft failure; the user is created but PIN isn't. They can set it later.
          toast({
            title: 'Warning: Could not set PIN',
            description: errorResult.message || 'Please try setting your PIN from the settings page.',
            variant: 'destructive',
          });
      }

      toast({ title: 'Account created successfully!' });
      router.push('/');
    } catch (error: any) {
      toast({
        title: 'Sign-up failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an Account</CardTitle>
          <CardDescription>Start your storytelling journey.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="m@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
           <div className="space-y-2">
            <Label htmlFor="pin">4-Digit Parent PIN</Label>
            <Input 
              id="pin" 
              type="text"
              inputMode="numeric"
              pattern="[0-9]*" 
              value={pin} 
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} 
              maxLength={4} 
              placeholder="****"
              autoComplete="one-time-code"
              style={{ MozAppearance: 'textfield', WebkitAppearance: 'none', appearance: 'none' }}
              className="tracking-[0.5em]"
            />
          </div>
           <div className="space-y-2">
            <Label htmlFor="confirmPin">Confirm PIN</Label>
            <Input 
              id="confirmPin" 
              type="text"
              inputMode="numeric"
              pattern="[0-9]*" 
              value={confirmPin} 
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} 
              maxLength={4} 
              placeholder="****"
              autoComplete="one-time-code"
              style={{ MozAppearance: 'textfield', WebkitAppearance: 'none', appearance: 'none' }}
              className="tracking-[0.5em]"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button onClick={handleSignUp} disabled={isLoading} className="w-full">
            {isLoading ? 'Creating Account...' : 'Sign Up'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
