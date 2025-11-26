
'use client';

import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { useAppContext } from '@/hooks/use-app-context';

export default function WriterDashboardPage() {
  const { roleMode } = useAppContext();
  const { loading } = useAdminStatus();

  const renderContent = () => {
    if (loading || roleMode === 'unknown') {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    
    if (roleMode !== 'writer' && roleMode !== 'admin') {
      return <p>You do not have permission to view this page.</p>;
    }
    
    return (
        <div className="space-y-4">
          <p>Welcome to the Story Designer Hub. Manage creative assets for the application here.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
                <CardHeader>
                    <CardTitle>Story Types</CardTitle>
                    <CardDescription>Manage templates for story arcs and structures.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild><Link href="/admin/storyTypes">Manage Types</Link></Button>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Story Phases</CardTitle>
                    <CardDescription>Configure the different phases of story creation.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild><Link href="/admin/storyPhases">Manage Phases</Link></Button>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Prompt Configs</CardTitle>
                    <CardDescription>Edit the prompts that drive the AI's behavior.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild><Link href="/admin/prompts">Manage Prompts</Link></Button>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Story Outputs</CardTitle>
                    <CardDescription>Define final products like books and poems.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild><Link href="/admin/storyOutputs">Manage Outputs</Link></Button>
                </CardContent>
            </Card>
          </div>
        </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Writer Dashboard</CardTitle>
          <CardDescription>
            Creative tools for managing story content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
