
'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Home, Users, CreditCard, Settings, Smile } from 'lucide-react';
import { ParentGuard } from '@/components/parent/parent-guard';

const NAV_LINKS = [
  { href: '/parent', label: 'Overview', icon: Home },
  { href: '/parent/children', label: 'Manage Children', icon: Users },
  { href: '/parent/characters', label: 'Manage Characters', icon: Smile },
  { href: '/parent/orders', label: 'Orders', icon: CreditCard },
  { href: '/parent/settings', label: 'Settings', icon: Settings },
];

export default function ParentLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const layoutContent = (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8 lg:flex-row">
      <aside className="lg:w-64 space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-xl font-semibold">Parent Console</h2>
          <p className="text-sm text-muted-foreground">Manage profiles, security, and orders.</p>
        </div>
        <nav className="rounded-xl border bg-card p-2">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="flex-1">
        {children}
      </section>
    </div>
  );

  return <ParentGuard>{layoutContent}</ParentGuard>;
}
