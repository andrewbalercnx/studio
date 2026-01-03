
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
import { Shield, Pen, User as UserIcon, HelpCircle, BookOpen, Target, Circle, CircleDot } from 'lucide-react';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useWizardTargetDiagnosticsOptional } from '@/hooks/use-wizard-target-diagnostics';
import { usePathRecordingOptional } from '@/hooks/use-path-recording';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
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
  const pathRecording = usePathRecordingOptional();
  const { canShowWizardTargets } = useAdminStatus();
  const roleClaims: RoleClaims | null = idTokenResult?.claims ? (idTokenResult.claims as RoleClaims) : null;
  const [liveWizards, setLiveWizards] = useState<HelpWizard[]>([]);
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [wizardTitle, setWizardTitle] = useState('');

  // Fetch live help wizards ordered by 'order' field
  // Note: We fetch all and filter/sort client-side to avoid requiring a composite index
  useEffect(() => {
    if (!firestore) {
      console.log('[Header] No firestore instance available');
      return;
    }

    console.log('[Header] Setting up helpWizards listener');
    const wizardsRef = collection(firestore, 'helpWizards');

    const unsubscribe = onSnapshot(wizardsRef, (snapshot) => {
      console.log('[Header] Got helpWizards snapshot, docs:', snapshot.docs.length);
      const wizards = snapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as HelpWizard))
        .filter(w => w.status === 'live')
        .filter(w => {
          // Filter by role: admins see all, writers see parent+writer, parents see only parent
          const wizardRole = w.role || 'parent'; // Default to parent for backwards compatibility
          if (roleClaims?.isAdmin) return true;
          if (roleClaims?.isWriter) return wizardRole === 'parent' || wizardRole === 'writer';
          return wizardRole === 'parent';
        })
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      console.log('[Header] Live wizards:', wizards.length, wizards.map(w => w.title));
      setLiveWizards(wizards);
    }, (error) => {
      console.error('[Header] Error fetching help wizards:', error);
    });

    return () => unsubscribe();
  }, [firestore, roleClaims?.isAdmin, roleClaims?.isWriter]);

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

  const handleToggleRecording = () => {
    if (!pathRecording) return;
    if (pathRecording.isRecording) {
      pathRecording.stopRecording();
      if (pathRecording.steps.length > 0) {
        setShowTitleDialog(true);
      }
    } else {
      pathRecording.startRecording();
    }
  };

  const handleSaveRecording = () => {
    pathRecording?.downloadWizard(wizardTitle);
    setShowTitleDialog(false);
    setWizardTitle('');
  };

  const handleCancelRecording = () => {
    pathRecording?.clearRecording();
    setShowTitleDialog(false);
    setWizardTitle('');
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
    <>
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={roleMode === 'child' && activeChildId ? `/child/${activeChildId}` : '/'}
            className="flex items-center space-x-2"
            data-wiz-target="header-logo"
          >
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
                      <DropdownMenuSubTrigger data-wiz-target="user-menu-help-tours">
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
                {canShowWizardTargets && wizardTargetDiagnostics && (
                  <DropdownMenuItem onClick={() => wizardTargetDiagnostics.toggle()}>
                    <Target className="mr-2 h-4 w-4" />
                    {wizardTargetDiagnostics.enabled ? 'Hide' : 'Show'} Wizard Targets
                  </DropdownMenuItem>
                )}
                {canShowWizardTargets && wizardTargetDiagnostics?.enabled && pathRecording && (
                  <DropdownMenuItem onClick={handleToggleRecording}>
                    {pathRecording.isRecording ? (
                      <>
                        <CircleDot className="mr-2 h-4 w-4 text-red-500" />
                        Stop Recording ({pathRecording.steps.length} steps)
                      </>
                    ) : (
                      <>
                        <Circle className="mr-2 h-4 w-4" />
                        Save My Path
                      </>
                    )}
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

    <Dialog open={showTitleDialog} onOpenChange={setShowTitleDialog}>
      <DialogContent className="sm:max-w-md" data-path-recording-ui>
        <DialogHeader>
          <DialogTitle>Save Recorded Path</DialogTitle>
          <DialogDescription>
            Enter a title for your wizard. You recorded {pathRecording?.steps.length ?? 0} steps.
            You can edit the descriptions after importing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="My Wizard Title"
            value={wizardTitle}
            onChange={(e) => setWizardTitle(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleCancelRecording}>
              Cancel
            </Button>
            <Button onClick={handleSaveRecording}>
              Download Wizard
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
