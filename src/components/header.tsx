import Link from 'next/link';
import { Logo } from '@/components/icons';
import { Button } from './ui/button';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
        <Link href="/" className="flex items-center space-x-2">
          <Logo />
        </Link>
        <nav>
          <Button asChild variant="ghost">
            <Link href="/create">
              Create Story
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
