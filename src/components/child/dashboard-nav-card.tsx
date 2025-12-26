'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type DashboardNavCardProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  badge?: number;
  variant?: 'default' | 'secondary';
};

export function DashboardNavCard({
  title,
  description,
  icon,
  href,
  badge,
  variant = 'default',
}: DashboardNavCardProps) {
  return (
    <Link href={href}>
      <Card
        className={cn(
          'h-full transition-all hover:scale-105 active:scale-95 cursor-pointer',
          'border-2 hover:shadow-xl',
          variant === 'default'
            ? 'border-primary/30 hover:border-primary bg-primary/5'
            : 'border-gray-200 hover:border-gray-300'
        )}
      >
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <div
              className={cn(
                'p-4 rounded-2xl',
                variant === 'default' ? 'bg-primary text-white' : 'bg-gray-100'
              )}
            >
              {icon}
            </div>
            {badge !== undefined && badge > 0 && (
              <Badge variant="secondary" className="text-lg px-3 py-1">
                {badge}
              </Badge>
            )}
          </div>
          <div>
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="text-base mt-2">{description}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
