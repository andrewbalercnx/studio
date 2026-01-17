'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, FlaskConical, Wand2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { DevTodoList } from '@/components/admin/DevTodoList';
import { useUser } from '@/firebase/auth/use-user';

export default function DevelopmentPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();

  const diagnostics = {
    page: 'development',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading,
      error,
    },
  };

  const renderContent = () => {
    if (loading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (error) {
      return <p className="text-destructive">Error: {error}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access this page.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights. This page is admin-only.</p>;
    }
    return (
      <div className="space-y-8">
        {/* Development Todo List */}
        <DevTodoList />

        {/* AI Flow Tests */}
        <Card data-wiz-target="dev-ai-tests">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              AI Flow Tests
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Test individual AI flows with sample data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/storyBeatTest">Story Beat</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/storyArcTest">Story Arc</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/storyCompileTest">Story Compile</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/paginationTest">Story Pagination</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/run-traces">Run Traces</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Run Traces aggregates all AI calls for a story session with full prompts, outputs, and costs.
            </p>
          </CardContent>
        </Card>

        {/* Regression & Rules Tests */}
        <Card data-wiz-target="dev-regression">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Regression & Rules Tests
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Run automated tests to verify system behavior
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/regression">Regression Tests</Link>
              </Button>
              <Button asChild variant="destructive" size="sm">
                <Link href="/firestore-test">Firestore Rules Tests</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Development Tools */}
        <Card data-wiz-target="dev-tools">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Development Tools
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Tools for creating test data and seeding the database
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/create">Create Data (Dev)</Link>
              </Button>
              <SeedStoryGeneratorsButton />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Development
            <span className="text-xs font-mono text-muted-foreground">{process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || 'dev'}</span>
          </CardTitle>
          <CardDescription>
            Testing and development tools for system maintenance
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">← Admin</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/writer">Writer →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {renderContent()}

      <DiagnosticsPanel
        pageName="development"
        data={diagnostics}
        className="mt-8"
      />
    </div>
  );
}

// Seed Story Generators Button
function SeedStoryGeneratorsButton() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeed = async () => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be signed in', variant: 'destructive' });
      return;
    }

    setIsSeeding(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/story-generators/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Story Generators Seeded',
          description: result.message,
        });
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to seed generators',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to seed generators',
        variant: 'destructive',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSeed}
      disabled={isSeeding}
    >
      {isSeeding ? (
        <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Seeding...</>
      ) : (
        <><Wand2 className="mr-2 h-4 w-4" /> Seed Generators</>
      )}
    </Button>
  );
}
