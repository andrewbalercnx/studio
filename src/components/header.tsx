
'use client';

import Link from 'next/link';
import { Logo } from '@/components/icons';
import { Button } from './ui/button';
import { useUser } from '@/firebase/auth/use-user';
import { signOut } from 'firebase/auth';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { useAuth, useFirestore } from '@/firebase';
import { Badge } from './ui/badge';
import { Shield, Pen, User as UserIcon, HelpCircle, BookOpen, Target } from 'lucide-react';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useWizardTargetDiagnosticsOptional } from '@/hooks/use-wizard-target-diagnostics';
import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import type { HelpWizard } from '@/lib/types';

type RoleClaims = {
  isAdmin?: boolean;
  isWriter?: boolean;
  isParent?: boolean;
};

export default function Header() {
  const auth = useAuth();
  const firestore = useFirestore();
  const router = useRouter();
  const { user, idTokenResult } = useUser();
  const { roleMode, switchToParentMode, activeChildId, startWizard } = useAppContext();
  const { showPinModal } = useParentGuard();
  const wizardTargetDiagnostics = useWizardTargetDiagnosticsOptional();
  const roleClaims: RoleClaims | null = idTokenResult?.claims ? (idTokenResult.claims as RoleClaims) : null;
  const [liveWizards, setLiveWizards] = useState<HelpWizard[]>([]);

  // Fetch live help wizards ordered by 'order' field
  useEffect(() => {
    if (!firestore) return;

    const wizardsRef = collection(firestore, 'helpWizards');
    const q = query(
      wizardsRef,
      where('status', '==', 'live'),
      orderBy('order', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const wizards = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as HelpWizard));
      setLiveWizards(wizards);
    }, (error) => {
      console.error('Error fetching help wizards:', error);
    });

    return () => unsubscribe();
  }, [firestore]);

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  const handleSwitchToParent = () => {
    switchToParentMode();
    showPinModal();
    router.push('/parent');
  };

  const renderNavLinks = () => {
    switch (roleMode) {
      case 'admin':
      case 'writer':
        return (
          <>
            <Button asChild variant="ghost" data-wiz-target="nav-admin-dashboard"><Link href="/admin">Dashboard</Link></Button>
          </>
        );
      case 'child':
        // Simplified child mode - no nav links, only Switch to Parent button shown separately
        return null;
      case 'parent':
      default:
        // Simplified parent mode on home page - no nav links shown
        return null;
    }
  };

  const renderRoleBadges = () => {
    if (!roleClaims) return null;
    const { isAdmin, isWriter, isParent } = roleClaims;

    return (
      <div className="flex items-center gap-2">
        {isAdmin && <Badge variant="destructive" className="gap-1"><Shield className="h-3 w-3" /> Admin</Badge>}
        {isWriter && <Badge variant="secondary" className="gap-1"><Pen className="h-3 w-3"/> Writer</Badge>}
        {isParent && <Badge variant="outline" className="gap-1"><UserIcon className="h-3 w-3"/> Parent</Badge>}
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center space-x-2" data-wiz-target="header-logo">
            <Logo />
          </Link>
        </div>
        <nav className="flex items-center gap-4">
          {/* Show "Return to Parent" for child mode */}
          {roleMode === 'child' && (
            <Button asChild variant="ghost" data-wiz-target="nav-return-to-parent">
              <Link href="/parent/children">Return to Parent</Link>
            </Button>
          )}
          {/* Show "Switch to Parent" for parent mode */}
          {roleMode === 'parent' && (
            <Button asChild variant="ghost" data-wiz-target="nav-switch-to-parent">
              <Link href="/parent">Switch to Parent</Link>
            </Button>
          )}
          {renderNavLinks()}
          {user ? (
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full" data-wiz-target="header-user-menu">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.photoURL || undefined} alt={user.displayName || user.email || 'user'} className="object-cover" />
                    <AvatarFallback>{user.email?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">My Account</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {renderRoleBadges()}
                </div>
                <DropdownMenuSeparator />
                {(roleClaims?.isAdmin || roleClaims?.isWriter) && (
                    <DropdownMenuItem onClick={() => router.push('/admin')}>
                    Admin Dashboard
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push('/parent/settings')}>
                  Settings
                </DropdownMenuItem>
                {liveWizards.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <HelpCircle className="mr-2 h-4 w-4" />
                        Help Tours
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {liveWizards.map((wizard) => (
                          <DropdownMenuItem key={wizard.id} onClick={() => startWizard(wizard.id)}>
                            <BookOpen className="mr-2 h-4 w-4" />
                            {wizard.title}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
                {(roleClaims?.isAdmin || roleClaims?.isWriter) && wizardTargetDiagnostics && (
                  <DropdownMenuItem onClick={() => wizardTargetDiagnostics.toggle()}>
                    <Target className="mr-2 h-4 w-4" />
                    {wizardTargetDiagnostics.enabled ? 'Hide' : 'Show'} Wizard Targets
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
