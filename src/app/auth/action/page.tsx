'use client';

/**
 * Our own handler for Firebase Auth email links (password reset, email
 * verification, email change recovery), so the links in those emails point at
 * storypic.rcnx.io instead of Firebase's default page on firebaseapp.com.
 *
 * App Hosting does not serve Firebase's built-in /__/auth/action page. To use
 * this one, set Authentication → Templates → (any template) → Customize action
 * URL to https://storypic.rcnx.io/auth/action — one setting covers every
 * template. Firebase appends ?mode=…&oobCode=…&apiKey=…&continueUrl=…&lang=….
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | 'verifyAndChangeEmail';

type State =
  | { kind: 'loading' }
  | { kind: 'reset'; email: string }
  | { kind: 'done'; title: string; message: string; recoverEmail?: string }
  | { kind: 'error'; message: string };

const MIN_PASSWORD_LENGTH = 6;

/** Firebase action-code errors in words a parent understands. */
function explain(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/expired-action-code') return 'This link has expired. Ask for a new one and use it within an hour.';
  if (code === 'auth/invalid-action-code') return 'This link has already been used or is not valid. Ask for a new one.';
  if (code === 'auth/user-disabled') return 'This account has been disabled. Please contact us.';
  if (code === 'auth/user-not-found') return 'We could not find this account.';
  if (code === 'auth/weak-password') return `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  return 'Something went wrong with this link. Please ask for a new one.';
}

export default function AuthActionPage() {
  const auth = useAuth();
  const [params, setParams] = useState<{ mode: Mode | null; oobCode: string | null } | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({ mode: search.get('mode') as Mode | null, oobCode: search.get('oobCode') });
  }, []);

  useEffect(() => {
    if (!auth || !params) return;
    const { mode, oobCode } = params;
    if (!mode || !oobCode) {
      setState({ kind: 'error', message: 'This link is incomplete. Please use the full link from the email.' });
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelled) setState({ kind: 'reset', email });
        } else if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') {
          await applyActionCode(auth, oobCode);
          if (!cancelled)
            setState({
              kind: 'done',
              title: mode === 'verifyEmail' ? 'Email verified' : 'Email address changed',
              message: mode === 'verifyEmail' ? 'Thank you! Your email address is confirmed.' : 'Your account now uses your new email address.',
            });
        } else if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, oobCode);
          await applyActionCode(auth, oobCode);
          if (!cancelled)
            setState({
              kind: 'done',
              title: 'Email address restored',
              message: `Your account's email is back to ${info.data.email}. If you did not ask for the change, reset your password now.`,
              recoverEmail: info.data.email ?? undefined,
            });
        } else {
          setState({ kind: 'error', message: 'This link is not one we recognise.' });
        }
      } catch (error) {
        if (!cancelled) setState({ kind: 'error', message: explain(error) });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [auth, params]);

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !params?.oobCode || state.kind !== 'reset') return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await confirmPasswordReset(auth, params.oobCode, password);
      setState({ kind: 'done', title: 'Password changed', message: `You can now sign in as ${state.email} with your new password.` });
    } catch (error) {
      setFormError(explain(error));
    } finally {
      setBusy(false);
    }
  };

  const resendReset = async (email: string) => {
    if (!auth) return;
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setState({ kind: 'done', title: 'Check your email', message: `A link to reset your password is on its way to ${email}.` });
    } catch (error) {
      setState({ kind: 'error', message: explain(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-[calc(100vh-3.5rem)]">
      <Card className="w-full max-w-sm" data-testid="auth-action">
        {state.kind === 'loading' && (
          <CardContent className="flex items-center gap-2 pt-6">
            <LoaderCircle className="h-5 w-5 animate-spin" /> Checking your link…
          </CardContent>
        )}

        {state.kind === 'reset' && (
          <form onSubmit={submitReset}>
            <CardHeader>
              <CardTitle>Choose a new password</CardTitle>
              <CardDescription>For {state.email}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Lets password managers file the new password under this account on this site. */}
              <input type="email" name="username" autoComplete="username" value={state.email} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" name="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Type it again</Label>
                <Input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Save new password'}
              </Button>
            </CardFooter>
          </form>
        )}

        {state.kind === 'done' && (
          <>
            <CardHeader>
              <CardTitle>{state.title}</CardTitle>
              <CardDescription>{state.message}</CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-2">
              {state.recoverEmail && (
                <Button variant="outline" className="w-full" disabled={busy} onClick={() => resendReset(state.recoverEmail!)}>
                  Reset my password
                </Button>
              )}
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </CardFooter>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <CardHeader>
              <CardTitle>That link didn&apos;t work</CardTitle>
              <CardDescription>{state.message}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
