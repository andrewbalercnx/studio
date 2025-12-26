'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function AdminCompilePromptPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compilePrompt, setCompilePrompt] = useState('');
  const [enabled, setEnabled] = useState(false);

  // Fetch current config on mount
  useEffect(() => {
    if (!user || !isAdmin) return;

    const fetchConfig = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/compile-prompt', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.config) {
            setCompilePrompt(result.config.compilePrompt || '');
            setEnabled(result.config.enabled || false);
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
      const response = await fetch('/api/admin/system-config/compile-prompt', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          compilePrompt,
          enabled,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({
          title: 'Saved',
          description: 'Compile prompt configuration updated successfully.',
        });
      } else {
        toast({
          title: 'Save failed',
          description: result.errorMessage || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Save failed',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
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
            <Label htmlFor="enabled">Enable Custom Compile Prompt</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, this prompt will be used to compile chat messages into story text
            </p>
          </div>
          <Switch
            id="enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="compilePrompt">Compile Prompt</Label>
          <Textarea
            id="compilePrompt"
            placeholder="Enter the prompt used to compile chat messages into story text..."
            value={compilePrompt}
            onChange={(e) => setCompilePrompt(e.target.value)}
            rows={15}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This prompt instructs the AI how to compile interactive chat sessions into a single story narrative.
            The prompt should describe the tone, style, and formatting requirements.
            Character context and output format instructions are added automatically.
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-md space-y-2">
          <h4 className="text-sm font-medium">Auto-appended Context</h4>
          <p className="text-xs text-muted-foreground">
            The following are automatically added to your prompt:
          </p>
          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
            <li>Story type name and description</li>
            <li>Main character name and ID placeholder</li>
            <li>Character reference list ($$id$$ = name mappings)</li>
            <li>Full character details (descriptions, pronouns, likes/dislikes)</li>
            <li>JSON output format specification</li>
          </ul>
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

        {compilePrompt && enabled && (
          <div className="mt-6 p-4 bg-muted rounded-md">
            <h4 className="text-sm font-medium mb-2">Preview (first 500 characters)</h4>
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {compilePrompt.slice(0, 500)}
              {compilePrompt.length > 500 && '...'}
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
          <CardTitle>Story Compile Prompt Configuration</CardTitle>
          <CardDescription>
            Configure the prompt used to compile interactive chat sessions into story text.
            This is used by the story-text-compile-flow when converting messages to a narrative.
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
