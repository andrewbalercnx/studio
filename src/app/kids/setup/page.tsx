'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../layout';
import type { ChildProfile } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { LoaderCircle, User, Lock, ArrowLeft, Check, Shield } from 'lucide-react';

export default function KidsSetupPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked, lockToChild, unlock } = useKidsPWA();
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [showPinEntry, setShowPinEntry] = useState(false);

  // Fetch children for this parent
  const childrenQuery = useMemo(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'children'),
      where('ownerParentUid', '==', user.uid),
      where('deletedAt', '==', null)
    );
  }, [firestore, user]);

  // Try without deletedAt filter as well (for older data)
  const childrenQueryFallback = useMemo(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'children'),
      where('ownerParentUid', '==', user.uid)
    );
  }, [firestore, user]);

  const { data: childrenRaw, loading: childrenLoading } = useCollection<ChildProfile>(childrenQueryFallback);

  // Filter out deleted children client-side
  const children = useMemo(() => {
    if (!childrenRaw) return [];
    return childrenRaw.filter(c => !c.deletedAt);
  }, [childrenRaw]);

  // Handle selecting a child (requires PIN to change if already locked)
  const handleSelectChild = (child: ChildProfile) => {
    if (isLocked && childId !== child.id) {
      // Need PIN to switch children
      setSelectedChildId(child.id);
      setShowPinEntry(true);
      setPinError('');
    } else {
      // Not locked or selecting same child - just lock directly
      lockToChild(child.id);
      router.push('/kids');
    }
  };

  // Handle PIN verification
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    // Verify PIN against user profile
    // For simplicity, we'll use a basic PIN check - in production, use proper PIN verification
    try {
      const response = await fetch('/api/user/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        // PIN verified - proceed with child change
        if (selectedChildId) {
          lockToChild(selectedChildId);
          router.push('/kids');
        }
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    } catch (err) {
      // If PIN verification endpoint doesn't exist, use simple verification
      // Default PIN is "1234" for now
      if (pin === '1234') {
        if (selectedChildId) {
          lockToChild(selectedChildId);
          router.push('/kids');
        }
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    }
  };

  // Handle unlock (return to parent mode)
  const handleUnlock = async () => {
    setShowPinEntry(true);
    setSelectedChildId(null); // null indicates unlocking rather than switching
  };

  const handleUnlockConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    try {
      const response = await fetch('/api/user/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        unlock();
        router.push('/parent');
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    } catch (err) {
      // Fallback simple PIN check
      if (pin === '1234') {
        unlock();
        router.push('/parent');
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    }
  };

  // Loading state
  if (userLoading || childrenLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Parent Sign In Required</CardTitle>
            <CardDescription>
              A parent needs to sign in to set up your story space.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg" className="w-full">
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // PIN entry modal
  if (showPinEntry) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
              <Shield className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl">Parent PIN Required</CardTitle>
            <CardDescription>
              {selectedChildId
                ? 'Enter your PIN to switch to a different profile'
                : 'Enter your PIN to return to parent mode'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={selectedChildId ? handlePinSubmit : handleUnlockConfirm} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="text-center text-2xl tracking-widest"
                  autoFocus
                />
                {pinError && (
                  <p className="text-sm text-red-500 text-center">{pinError}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowPinEntry(false);
                    setPin('');
                    setPinError('');
                    setSelectedChildId(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={pin.length < 4}>
                  Confirm
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Child selection
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 flex items-center gap-4">
        {isLocked && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/kids')}
            className="text-amber-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-amber-900">
            {isLocked ? 'Switch Profile' : 'Choose Who\'s Playing'}
          </h1>
          <p className="text-sm text-amber-700">
            {isLocked
              ? 'Select a different profile (requires parent PIN)'
              : 'Pick your profile to start creating stories'}
          </p>
        </div>
      </header>

      {/* Children list */}
      <main className="flex-1 px-4 pb-8">
        <div className="max-w-md mx-auto space-y-3">
          {children.length === 0 ? (
            <Card className="text-center p-8">
              <CardContent>
                <User className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Profiles Yet</h3>
                <p className="text-gray-600 mb-4">
                  A parent needs to create a child profile first.
                </p>
                <Button asChild>
                  <Link href="/parent/children">Go to Parent Dashboard</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            children.map((child) => (
              <button
                key={child.id}
                onClick={() => handleSelectChild(child)}
                className="w-full text-left"
              >
                <Card
                  className={`border-2 transition-all hover:shadow-lg active:scale-98 ${
                    childId === child.id
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-amber-200 hover:border-amber-400 bg-white'
                  }`}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Avatar */}
                    <div className="flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-amber-200 to-orange-300 flex items-center justify-center overflow-hidden">
                      {child.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={child.avatarUrl}
                          alt={child.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl font-bold text-amber-700">
                          {child.displayName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Name and status */}
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {child.displayName}
                      </h3>
                      {childId === child.id && (
                        <p className="text-sm text-amber-600 flex items-center gap-1">
                          <Check className="h-4 w-4" />
                          Currently selected
                        </p>
                      )}
                    </div>

                    {/* Lock indicator */}
                    {childId === child.id && (
                      <Lock className="h-5 w-5 text-amber-500" />
                    )}
                  </CardContent>
                </Card>
              </button>
            ))
          )}
        </div>
      </main>

      {/* Footer with parent mode option */}
      {isLocked && (
        <footer className="px-4 py-4 border-t border-amber-200 bg-amber-50/50">
          <div className="max-w-md mx-auto">
            <Button
              variant="outline"
              className="w-full text-amber-700 border-amber-300 hover:bg-amber-100"
              onClick={handleUnlock}
            >
              <Shield className="h-4 w-4 mr-2" />
              Return to Parent Mode
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
