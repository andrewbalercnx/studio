
'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/firebase/auth/use-user';
import { Users, CreditCard, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ParentOverviewPage() {
  const { user } = useUser();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, Parent!</CardTitle>
          <CardDescription>This is your secure area to manage your family's account.</CardDescription>
        </CardHeader>
        <CardContent>
          <p>
            You are signed in as <span className="font-semibold">{user?.email}</span>. From here you can add or edit
            child profiles, review your orders, and manage your account settings.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Manage Children</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Profiles</div>
            <p className="text-xs text-muted-foreground">Add or edit your children's details and photos.</p>
          </CardContent>
          <CardFooter>
            <Button asChild size="sm">
              <Link href="/parent/children">Go to Children</Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Print Orders</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Orders</div>
            <p className="text-xs text-muted-foreground">Review your past and current print orders.</p>
          </CardContent>
           <CardFooter>
            <Button asChild size="sm">
              <Link href="/parent/orders">Go to Orders</Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settings</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Security</div>
            <p className="text-xs text-muted-foreground">Update your Parent PIN and other account settings.</p>
          </CardContent>
           <CardFooter>
            <Button asChild size="sm">
              <Link href="/parent/settings">Go to Settings</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
