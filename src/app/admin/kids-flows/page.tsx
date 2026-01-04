'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Save, Wand2, Sparkles, BookOpen, MessageCircle, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

export default function AdminKidsFlowsPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wizardEnabled, setWizardEnabled] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [gemini3Enabled, setGemini3Enabled] = useState(true);
  const [gemini4Enabled, setGemini4Enabled] = useState(true);
  const [friendsEnabled, setFriendsEnabled] = useState(true);

  // Fetch current config on mount
  useEffect(() => {
    if (!user || !isAdmin) return;

    const fetchConfig = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/kids-flows', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.config) {
            setWizardEnabled(result.config.wizardEnabled ?? true);
            setChatEnabled(result.config.chatEnabled ?? true);
            setGemini3Enabled(result.config.gemini3Enabled ?? true);
            setGemini4Enabled(result.config.gemini4Enabled ?? true);
            setFriendsEnabled(result.config.friendsEnabled ?? true);
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

    // Ensure at least one flow is enabled
    if (!wizardEnabled && !chatEnabled && !gemini3Enabled && !gemini4Enabled && !friendsEnabled) {
      toast({
        title: 'Invalid configuration',
        description: 'At least one story flow must be enabled.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/system-config/kids-flows', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wizardEnabled,
          chatEnabled,
          gemini3Enabled,
          gemini4Enabled,
          friendsEnabled,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({
          title: 'Saved',
          description: 'Kids flow configuration updated successfully.',
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
        <Alert variant="destructive" className="border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Deprecated Page</AlertTitle>
          <AlertDescription>
            This page is being replaced. Please use the{' '}
            <a href="/admin/storyGenerators" className="underline font-medium">Story Generators</a>{' '}
            admin page instead. Each generator now has an &quot;Enabled for Kids&quot; toggle in its General tab.
            This page will be removed in a future update.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <Wand2 className="h-5 w-5 text-amber-600" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="wizardEnabled" className="text-base font-medium">Magic Story Wizard</Label>
              <p className="text-sm text-muted-foreground">
                Answer a few fun questions to create a story
              </p>
            </div>
          </div>
          <Switch
            id="wizardEnabled"
            checked={wizardEnabled}
            onCheckedChange={setWizardEnabled}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <MessageCircle className="h-5 w-5 text-blue-600" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="chatEnabled" className="text-base font-medium">Create with Chat</Label>
              <p className="text-sm text-muted-foreground">
                Talk with the Story Guide step-by-step to build a tale
              </p>
            </div>
          </div>
          <Switch
            id="chatEnabled"
            checked={chatEnabled}
            onCheckedChange={setChatEnabled}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
              <Sparkles className="h-5 w-5 text-purple-600" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="gemini3Enabled" className="text-base font-medium">Creative Adventure (Gemini 3)</Label>
              <p className="text-sm text-muted-foreground">
                Free-form creative questions for imaginative stories
              </p>
            </div>
          </div>
          <Switch
            id="gemini3Enabled"
            checked={gemini3Enabled}
            onCheckedChange={setGemini3Enabled}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <BookOpen className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="gemini4Enabled" className="text-base font-medium">Guided Story (Gemini 4)</Label>
              <p className="text-sm text-muted-foreground">
                Structured age-appropriate questions with multiple choices
              </p>
            </div>
          </div>
          <Switch
            id="gemini4Enabled"
            checked={gemini4Enabled}
            onCheckedChange={setGemini4Enabled}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
              <Users className="h-5 w-5 text-orange-600" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="friendsEnabled" className="text-base font-medium">Fun with my friends</Label>
              <p className="text-sm text-muted-foreground">
                Create an adventure story featuring characters and friends
              </p>
            </div>
          </div>
          <Switch
            id="friendsEnabled"
            checked={friendsEnabled}
            onCheckedChange={setFriendsEnabled}
          />
        </div>

        <div className="flex justify-end pt-4">
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

        <div className="mt-6 p-4 bg-muted rounded-md">
          <h4 className="text-sm font-medium mb-2">Preview</h4>
          <p className="text-sm text-muted-foreground">
            Kids will see{' '}
            {[
              wizardEnabled && 'Magic Story Wizard',
              chatEnabled && 'Create with Chat',
              gemini3Enabled && 'Creative Adventure',
              gemini4Enabled && 'Guided Story',
              friendsEnabled && 'Fun with my friends',
            ].filter(Boolean).join(', ') || 'no options (at least one must be enabled)'}
            {' '}when creating a new story.
          </p>
        </div>
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
          <CardTitle>Kids Story Flows</CardTitle>
          <CardDescription>
            Configure which story generation flows are available in the Kids PWA (/kids endpoint).
            Changes take effect within 60 seconds (or immediately for new requests).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
