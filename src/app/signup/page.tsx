
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { useAuth, useFirestore } from '@/firebase';
import { doc, setDoc, serverTimestamp }from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { createHmac } from 'crypto';

function hashPin(pin: string): string {
    // This should ideally use a server-side endpoint with a secret salt,
    // but for client-side hashing, we'll use a placeholder.
    // IMPORTANT: In a real app, move this to a Cloud Function.
    const salt = process.env.NEXT_PUBLIC_PIN_SALT || 'default-super-secret-salt';
    return createHmac('sha256', salt).update(pin).digest('hex');
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
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      const pinHash = hashPin(pin);

      // Create a user document in Firestore
      await setDoc(doc(firestore, 'users', user.uid), {
        id: user.uid,
        email: user.email,
        roles: {
            admin: false,
            writer: false,
            parent: true,
        },
        pinHash: pinHash,
        createdAt: serverTimestamp(),
      });
      
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
            <Input id="email" type="email" placeholder="m@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
           <div className="space-y-2">
            <Label htmlFor="pin">4-Digit Parent PIN</Label>
            <Input id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={4} placeholder="****" />
          </div>
           <div className="space-y-2">
            <Label htmlFor="confirmPin">Confirm PIN</Label>
            <Input id="confirmPin" type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} maxLength={4} placeholder="****" />
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
