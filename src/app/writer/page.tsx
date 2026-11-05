'use client';

import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoaderCircle, PenTool, Palette, MessageSquare, Sparkles, Mic, HelpCircle } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { PromptConfigsPanel } from '@/components/writer/prompt-configs-panel';
import { StoryOutputsPanel } from '@/components/writer/story-outputs-panel';
import { StoryPhasesPanel } from '@/components/writer/story-phases-panel';
import { StoryTypesPanel } from '@/components/writer/story-types-panel';

export default function WriterDashboardPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading, error } = useAdminStatus();

  const diagnostics = {
    page: 'writer-dashboard',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      isWriter,
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
    if (!isAdmin && !isWriter) {
      return <p>You are signed in but do not have writer or admin rights.</p>;
    }
    return (
      <div className="space-y-8">
        {/* Story Editor Section */}
        <Card data-wiz-target="writer-story-editor">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              Story Editor
            </CardTitle>
            <CardDescription>
              Manage the creative building blocks: story types, phases, prompts, and output templates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="types" className="space-y-4">
              <TabsList>
                <TabsTrigger value="types">Story Types</TabsTrigger>
                <TabsTrigger value="phases">Story Phases</TabsTrigger>
                <TabsTrigger value="prompts">Prompt Configs</TabsTrigger>
                <TabsTrigger value="outputs">Output Types</TabsTrigger>
              </TabsList>
              <TabsContent value="types">
                <StoryTypesPanel />
              </TabsContent>
              <TabsContent value="phases">
                <StoryPhasesPanel />
              </TabsContent>
              <TabsContent value="prompts">
                <PromptConfigsPanel />
              </TabsContent>
              <TabsContent value="outputs">
                <StoryOutputsPanel />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Output Configuration */}
        <Card data-wiz-target="writer-output-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Output Configuration
            </CardTitle>
            <CardDescription>
              Configure image styles, print layouts, and products
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/image-styles">Image Styles</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/print-layouts">Print Layouts</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/print-products">Print Products</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Prompts */}
        <Card data-wiz-target="writer-ai-prompts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              AI Prompts
            </CardTitle>
            <CardDescription>
              Configure prompts for AI story generation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/global-prompts">Global Prompt Prefix</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/compile-prompt">Compile Prompt</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/pagination-prompt">Pagination Prompt</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/image-prompt">Image Prompt</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/prompts">Prompt Configs</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Story Generators & Voice */}
        <Card data-wiz-target="writer-generators">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Story Generators & Voice
            </CardTitle>
            <CardDescription>
              Configure story generators and voice settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/storyGenerators">Story Generators</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/voice-config">
                    <Mic className="mr-2 h-4 w-4" /> Voice Recording Script
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/answer-animations">Answer Animations</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help Wizards */}
        <Card data-wiz-target="writer-help-wizards">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Help Wizards
            </CardTitle>
            <CardDescription>
              Create and manage help wizards for user guidance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/helpWizards">Manage Help Wizards</Link>
              </Button>
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
            Writer Dashboard
            <span className="text-xs font-mono text-muted-foreground">{process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || 'dev'}</span>
          </CardTitle>
          <CardDescription>
            Content creation and story configuration tools
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Manage story types, phases, prompts, output templates, and content settings. Changes save directly to Firestore.
        </CardContent>
      </Card>

      {renderContent()}

      <DiagnosticsPanel
        pageName="writer-dashboard"
        data={diagnostics}
        className="mt-8"
      />
    </div>
  );
}
