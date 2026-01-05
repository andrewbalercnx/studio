'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Save, RotateCcw, Mic } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DEFAULT_VOICE_RECORDING_TEXT } from '@/lib/types';

export default function AdminVoiceConfigPage() {
  const { isAuthenticated, isAdmin, loading: authLoading, error: authError } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voiceRecordingText, setVoiceRecordingText] = useState('');
  const [originalText, setOriginalText] = useState('');

  // Fetch current config on mount
  useEffect(() => {
    if (!user || !isAdmin) return;

    const fetchConfig = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/system-config/voice', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.config) {
            const text = result.config.voiceRecordingText || DEFAULT_VOICE_RECORDING_TEXT;
            setVoiceRecordingText(text);
            setOriginalText(text);
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
      const response = await fetch('/api/admin/system-config/voice', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voiceRecordingText,
        }),
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        setOriginalText(voiceRecordingText);
        toast({
          title: 'Saved',
          description: 'Voice recording text updated successfully.',
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

  const handleReset = () => {
    setVoiceRecordingText(DEFAULT_VOICE_RECORDING_TEXT);
    toast({
      title: 'Reset to default',
      description: 'Click Save to apply the default text.',
    });
  };

  const hasChanges = voiceRecordingText !== originalText;
  const wordCount = voiceRecordingText.split(/\s+/).filter(Boolean).length;

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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="voiceRecordingText">Voice Recording Script</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset to Default
            </Button>
          </div>
          <Textarea
            id="voiceRecordingText"
            placeholder="Enter the text for users to read when recording their voice..."
            value={voiceRecordingText}
            onChange={(e) => setVoiceRecordingText(e.target.value)}
            rows={20}
            className="font-mono text-sm"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>
              This text is displayed to parents when they record a family voice.
              It should include varied speech patterns for best voice clone quality.
            </p>
            <span>{wordCount} words</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          {hasChanges && (
            <span className="text-sm text-amber-600">Unsaved changes</span>
          )}
          <div className="flex gap-2 ml-auto">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
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
        </div>

        {voiceRecordingText && (
          <div className="mt-6 p-4 bg-muted rounded-md">
            <h4 className="text-sm font-medium mb-2">Preview (as shown to parents)</h4>
            <div className="text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
              {voiceRecordingText}
            </div>
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
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Recording Configuration
          </CardTitle>
          <CardDescription>
            Configure the text that parents read aloud when creating a family voice clone.
            The text should include varied speech patterns, emotional tones, and pacing
            to help the AI capture the full range of the speaker's voice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
