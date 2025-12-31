'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DEFAULT_PAGINATION_PROMPT } from '@/lib/types';

export default function AdminPaginationPromptPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paginationPrompt, setPaginationPrompt] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Fetch current config on mount
  useEffect(() => {
    if (!user || !isAdmin) return;

    const fetchConfig = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/pagination-prompt', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.config) {
            setPaginationPrompt(result.config.paginationPrompt || DEFAULT_PAGINATION_PROMPT);
            setEnabled(result.config.enabled ?? true);
          }
        }
      } catch (err) {
        console.error('Error fetching config:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [user, isAdmin]);

  const handleSave = async () => {
    if (!user) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/system-config/pagination-prompt', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          paginationPrompt,
          enabled,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({
          title: 'Saved',
          description: 'Pagination prompt configuration updated successfully.',
        });
      } else {
        toast({
          title: 'Save failed',
          description: result.errorMessage || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = () => {
    setPaginationPrompt(DEFAULT_PAGINATION_PROMPT);
    toast({
      title: 'Reset to default',
      description: 'Click Save to apply the default prompt.',
    });
  };

  const renderContent = () => {
    if (authLoading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (authError) {
      return <p className="text-destructive">Error: {authError}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }

    if (loading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="enabled">Enable Custom Pagination Prompt</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, this prompt will be used to paginate stories into book pages.
              When disabled, the default prompt is used.
            </p>
          </div>
          <Switch
            id="enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="paginationPrompt">Pagination Prompt</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetToDefault}
              className="text-xs"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset to Default
            </Button>
          </div>
          <Textarea
            id="paginationPrompt"
            placeholder="Enter the prompt used to paginate story text into book pages..."
            value={paginationPrompt}
            onChange={(e) => setPaginationPrompt(e.target.value)}
            rows={18}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This prompt instructs the AI how to divide story text into pages for a picture book.
            The prompt should specify page length guidelines, how to handle character placeholders,
            and how to create image descriptions for each page.
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-md space-y-2">
          <h4 className="text-sm font-medium">Auto-appended Context</h4>
          <p className="text-xs text-muted-foreground">
            The following are automatically added to your prompt by the pagination flow:
          </p>
          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
            <li>Style hints from the story output type</li>
            <li>Rhyme preservation instructions (if applicable)</li>
            <li>Target page count (from output type, or flexible)</li>
            <li>Character reference list ($$id$$ = name mappings)</li>
            <li>Full character details for context</li>
            <li>The story text to paginate</li>
            <li>JSON output format specification</li>
          </ul>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md space-y-2">
          <h4 className="text-sm font-medium text-amber-800">Per-Output-Type Override</h4>
          <p className="text-xs text-amber-700">
            Individual Story Output Types can have their own pagination prompt that overrides this global default.
            Edit output types at{' '}
            <Link href="/admin/storyOutputs" className="underline hover:no-underline">
              /admin/storyOutputs
            </Link>
            {' '}to set a custom prompt for specific output types.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>

        {paginationPrompt && (
          <div className="mt-6 p-4 bg-muted rounded-md">
            <h4 className="text-sm font-medium mb-2">Preview (first 500 characters)</h4>
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {paginationPrompt.slice(0, 500)}
              {paginationPrompt.length > 500 && '...'}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Admin
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pagination Prompt Configuration</CardTitle>
          <CardDescription>
            Configure the default prompt used to divide story text into pages for picture books.
            This is used by the story-pagination-flow when creating storybook pages.
            Changes take effect within 60 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
