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
import { DEFAULT_IMAGE_PROMPT } from '@/lib/types';

export default function AdminImagePromptPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [enabled, setEnabled] = useState(false);

  // Fetch current config on mount
  useEffect(() => {
    if (!user || !isAdmin) return;

    const fetchConfig = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/image-prompt', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.config) {
            setImagePrompt(result.config.imagePrompt || DEFAULT_IMAGE_PROMPT);
            setEnabled(result.config.enabled ?? false);
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
      const response = await fetch('/api/admin/system-config/image-prompt', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imagePrompt,
          enabled,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({
          title: 'Saved',
          description: 'Image prompt configuration updated successfully.',
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
    setImagePrompt(DEFAULT_IMAGE_PROMPT);
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
            <Label htmlFor="enabled">Enable Global Image Prompt</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, this prompt will be prepended to all image generation requests.
              When disabled, only the per-style and scene prompts are used.
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
            <Label htmlFor="imagePrompt">Global Image Prompt</Label>
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
            id="imagePrompt"
            placeholder="Enter instructions that apply to all image generation..."
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            rows={10}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This prompt is prepended to all image generation requests. Use it to set
            global standards for image style, safety, and appropriateness.
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-md space-y-2">
          <h4 className="text-sm font-medium">How Image Prompts Work</h4>
          <p className="text-xs text-muted-foreground">
            Image generation prompts are built from multiple sources in this order:
          </p>
          <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
            <li><strong>Global Image Prompt</strong> (this setting) - General guidelines for all images</li>
            <li><strong>Art Style Prompt</strong> - From the selected image style (e.g., "watercolor illustration")</li>
            <li><strong>Style Example Images</strong> - Reference images from the image style</li>
            <li><strong>Scene Description</strong> - The specific scene to illustrate from the page</li>
            <li><strong>Character References</strong> - Photos/avatars of characters in the scene</li>
          </ol>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-md space-y-2">
          <h4 className="text-sm font-medium text-blue-800">Example Use Cases</h4>
          <ul className="text-xs text-blue-700 list-disc list-inside space-y-1">
            <li>Ensure all images are age-appropriate for young children</li>
            <li>Set consistent lighting or color preferences</li>
            <li>Specify that images should avoid certain themes</li>
            <li>Add accessibility considerations (e.g., high contrast)</li>
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

        {imagePrompt && (
          <div className="mt-6 p-4 bg-muted rounded-md">
            <h4 className="text-sm font-medium mb-2">Preview</h4>
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {imagePrompt}
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
          <CardTitle>Image Prompt Configuration</CardTitle>
          <CardDescription>
            Configure a global prompt that is prepended to all image generation requests.
            This allows you to set consistent guidelines for image style, safety, and appropriateness
            across all generated storybook illustrations. Changes take effect within 60 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
