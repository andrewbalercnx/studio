'use client';

import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, LoaderCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminDashboardPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();
  const { toast } = useToast();

  const diagnostics = {
    page: 'admin-dashboard',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading,
      error,
    },
  };

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: admin-dashboard\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copied to clipboard!' });
  };
  
  const renderContent = () => {
    if (loading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (error) {
      return <p className="text-destructive">Error: {error}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }
    return (
      <div className="space-y-4">
        <p>Welcome to the Story Guide admin area.</p>
        <div className="flex flex-wrap gap-4">
          <Button asChild>
            <Link href="/parent/settings">Parent Settings</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/create">Create Data (Dev)</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyDesigner">Story Designer (Beta)</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/database">Database Manager</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/users">Manage Users</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/prompts">Manage Prompt Configs</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/upload">Upload JSON Configs</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/children">Children</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/sessions">Story Sessions</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyPhases">Story Phases</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyTypes">Story Types</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyOutputs">Story Outputs</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/print-layouts">Print Layouts</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/characters">Characters</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyBeatTest">Story Beat Test</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyArcTest">Story Arc Test</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/storyCompileTest">Story Compile Test</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/ai-logs">AI Flow Logs</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/helpWizards">Manage Help Wizards</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/regression">Regression Tests</Link>
          </Button>
           <Button asChild variant="destructive">
            <Link href="/firestore-test">Firestore Rules Tests</Link>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Admin Dashboard</CardTitle>
          <CardDescription>
            Welcome to the Story Guide admin area.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
      
      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Diagnostics</CardTitle>
          <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics}>
            <Copy className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
