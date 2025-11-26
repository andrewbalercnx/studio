
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

export default function Header() {
  const auth = useAuth();
  const router = useRouter();
  const { user, idTokenResult } = useUser();
  const { roleMode, switchToParentMode } = useAppContext();

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
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
      case 'parent':
      case 'child':
      default:
        return (
          <>
            <Button asChild variant="ghost"><Link href="/parent">Home</Link></Button>
            <Button asChild variant="ghost"><Link href="/stories">My Stories</Link></Button>
            <Button asChild variant="ghost"><Link href="/parent/children">Manage Children</Link></Button>
          </>
        );
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <Logo />
          {roleMode === 'child' && (
            <Button variant="outline" size="sm" onClick={switchToParentMode} className="ml-4">
              Switch to Parent
            </Button>
          )}
        </Link>
        <nav className="flex items-center gap-4">
          {renderNavLinks()}
          {user ? (
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.photoURL || undefined} alt={user.displayName || user.email || 'user'} />
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
                {idTokenResult?.claims.isAdmin && (
                    <DropdownMenuItem onClick={() => router.push('/admin')}>
                    Admin Dashboard
                    </DropdownMenuItem>
                )}
                 {idTokenResult?.claims.isWriter && !idTokenResult?.claims.isAdmin && (
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
