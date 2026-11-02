
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import Link from 'next/link';

/** Our own reset email (POST /api/auth/password-reset): its link opens /auth/action on this site. */
async function requestPasswordReset(email: string): Promise<void> {
  const response = await fetch('/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error?.message ?? `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
}

/** Firebase sign-in errors in plain words. Wrong email and wrong password read the same on purpose. */
function signInErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'The email or password is incorrect. Check them, or use "Forgot password?" to set a new one.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or use "Forgot password?".';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact us.';
    case 'auth/network-request-failed':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const auth = useAuth();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      toast({
        title: 'Error',
        description: 'Authentication service is not available.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      track(ANALYTICS_EVENTS.loginCompleted, { method: 'password' });
      toast({ title: 'Signed in successfully!' });
      router.push('/');
    } catch (error: any) {
      toast({
        title: 'Sign-in failed',
        description: signInErrorMessage(error?.code),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      toast({ title: 'Enter your email first', description: 'Type the email you signed up with, then tap "Forgot password?" again.' });
      return;
    }
    setIsSendingReset(true);
    try {
      // The server answers the same whether or not the address has an account,
      // so the form cannot be used to probe for accounts.
      await requestPasswordReset(email.trim());
    } catch (error: any) {
      toast({
        title: error?.status === 400 ? 'That email address is not valid' : 'We could not send the email just now',
        description: error?.status === 400 ? undefined : 'Please try again in a minute.',
        variant: 'destructive',
      });
      setIsSendingReset(false);
      return;
    }
    toast({
      title: 'Check your email',
      description: `If ${email.trim()} has an account, a link to reset its password is on its way.`,
    });
    setIsSendingReset(false);
  };

  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome Back!</CardTitle>
          <CardDescription>Sign in to continue to your storybook.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSignIn}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" placeholder="m@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isSendingReset}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {isSendingReset ? 'Sending…' : 'Forgot password?'}
                </button>
              </div>
              <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? 'Signing In...' : 'Sign In'}
            </Button>
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link href="/signup" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
