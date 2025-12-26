
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
} from './ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/hooks/use-app-context';
import { useAuth } from '@/firebase';
import { Badge } from './ui/badge';
import { Shield, Pen, User as UserIcon, HelpCircle } from 'lucide-react';
import { useParentGuard } from '@/hooks/use-parent-guard';

type RoleClaims = {
  isAdmin?: boolean;
  isWriter?: boolean;
  isParent?: boolean;
};

export default function Header() {
  const auth = useAuth();
  const router = useRouter();
  const { user, idTokenResult } = useUser();
  const { roleMode, switchToParentMode, activeChildId, startWizard } = useAppContext();
  const { showPinModal } = useParentGuard();
  const roleClaims: RoleClaims | null = idTokenResult?.claims ? (idTokenResult.claims as RoleClaims) : null;

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
        return (
          <>
            <Button asChild variant="ghost"><Link href="/admin">Dashboard</Link></Button>
            <Button asChild variant="ghost"><Link href="/admin/users">Users</Link></Button>
            <Button asChild variant="ghost"><Link href="/writer">Writer Tools</Link></Button>
          </>
        );
      case 'writer':
        return (
          <>
            <Button asChild variant="ghost"><Link href="/writer">Story Designer</Link></Button>
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
          <Link href="/" className="flex items-center space-x-2">
            <Logo />
          </Link>
        </div>
        <nav className="flex items-center gap-4">
          {/* Show "Return to Parent" for child mode */}
          {roleMode === 'child' && (
            <Button asChild variant="ghost">
              <Link href="/parent/children">Return to Parent</Link>
            </Button>
          )}
          {/* Show "Switch to Parent" for parent mode */}
          {roleMode === 'parent' && (
            <Button asChild variant="ghost">
              <Link href="/parent">Switch to Parent</Link>
            </Button>
          )}
          {renderNavLinks()}
          {user ? (
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
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
                {roleClaims?.isAdmin && (
                    <DropdownMenuItem onClick={() => router.push('/admin')}>
                    Admin Dashboard
                    </DropdownMenuItem>
                )}
                 {roleClaims?.isWriter && !roleClaims?.isAdmin && (
                    <DropdownMenuItem onClick={() => router.push('/writer')}>
                    Writer Dashboard
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push('/parent/settings')}>
                  Settings
                </DropdownMenuItem>
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
