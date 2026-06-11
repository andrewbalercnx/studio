'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { useResolvePlaceholders } from '@/hooks/use-resolve-placeholders';
import {
  replaceNamesWithPlaceholders,
  type ActorNameMapping,
} from '@/lib/replace-names-with-placeholders';
import { MAX_IMAGE_PROMPT_LENGTH, MAX_PAGE_TEXT_LENGTH } from '@/lib/storybook-page-edit';
import type { StoryOutputPage } from '@/lib/types';
import { LoaderCircle, Pencil, Sparkles } from 'lucide-react';

/**
 * Per-page editor for the parent book view (Sprint W2-C).
 *
 * Lets a parent (a) edit the page text, (b) edit the image-generation prompt,
 * and (c) trigger a single-page repaint. Server-first: edits go through
 * POST /api/storybookV2/pageEdit; regeneration is delegated back to the host
 * (which calls the existing POST /api/storybookV2/images single-page path).
 *
 * Placeholder handling: stored text/prompts use $$id$$ placeholders. The
 * dialog shows the resolved (display-name) form and converts names back to
 * placeholders on save via replaceNamesWithPlaceholders.
 */
export type PageEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: StoryOutputPage | null;
  storyId: string;
  storybookId: string;
  /** Actor name <-> $$id$$ mappings for placeholder round-tripping. */
  actors: ActorNameMapping[];
  /** Disables saving/regeneration (book locked or a generation job running). */
  disabled?: boolean;
  /** Called after a successful save. */
  onSaved?: (result: { textChanged: boolean; promptChanged: boolean; audioReset: boolean }) => void;
  /** Trigger a single-page image regeneration (host owns the images-route call). */
  onRegenerate?: (pageId: string, additionalPrompt?: string) => void;
};

export function PageEditorDialog({
  open,
  onOpenChange,
  page,
  storyId,
  storybookId,
  actors,
  disabled = false,
  onSaved,
  onRegenerate,
}: PageEditorDialogProps) {
  const { user } = useUser();
  const { toast } = useToast();

  const rawText = page ? page.displayText || page.bodyText || '' : '';
  const rawPrompt = page?.imagePrompt || '';
  const { resolvedText } = useResolvePlaceholders(rawText || null);
  const { resolvedText: resolvedPrompt } = useResolvePlaceholders(rawPrompt || null);

  const [pageText, setPageText] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [additionalPrompt, setAdditionalPrompt] = useState('');
  const [initializedForPage, setInitializedForPage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // (Re)initialize the fields when the dialog opens for a page, preferring the
  // resolved (display-name) form once it arrives.
  useEffect(() => {
    if (!open || !page?.id) {
      setInitializedForPage(null);
      return;
    }
    if (initializedForPage === page.id) return;
    setPageText(resolvedText ?? rawText);
    setImagePrompt(resolvedPrompt ?? rawPrompt);
    setAdditionalPrompt('');
    setInitializedForPage(page.id);
  }, [open, page?.id, resolvedText, resolvedPrompt, rawText, rawPrompt, initializedForPage]);

  const textDirty = pageText !== (resolvedText ?? rawText);
  const promptDirty = imagePrompt !== (resolvedPrompt ?? rawPrompt);
  const pageHasArt = !!page?.imagePrompt;

  const saveEdits = async (): Promise<boolean> => {
    if (!page?.id) return false;
    if (!textDirty && !promptDirty) return true; // nothing to save
    if (!user) {
      toast({ title: 'Sign in required', description: 'Please sign in again.', variant: 'destructive' });
      return false;
    }
    if (promptDirty && imagePrompt.trim().length === 0) {
      toast({ title: 'Picture prompt cannot be empty', variant: 'destructive' });
      return false;
    }

    setIsSaving(true);
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = { storyId, storybookId, pageId: page.id };
      if (textDirty) {
        body.pageText = replaceNamesWithPlaceholders(pageText, actors);
      }
      if (promptDirty) {
        body.imagePrompt = replaceNamesWithPlaceholders(imagePrompt, actors);
      }
      const response = await fetch('/api/storybookV2/pageEdit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.errorMessage || 'Failed to save the page edit.');
      }
      onSaved?.({
        textChanged: !!result.textChanged,
        promptChanged: !!result.promptChanged,
        audioReset: !!result.audioReset,
      });
      return true;
    } catch (error: any) {
      toast({
        title: 'Save failed',
        description: error?.message ?? 'Unable to save the page edit.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const saved = await saveEdits();
    if (saved) {
      toast({ title: 'Page updated' });
      onOpenChange(false);
    }
  };

  const handleSaveAndRepaint = async () => {
    if (!page?.id) return;
    const saved = await saveEdits();
    if (!saved) return;
    const extra = additionalPrompt.trim()
      ? replaceNamesWithPlaceholders(additionalPrompt.trim(), actors)
      : undefined;
    onOpenChange(false);
    onRegenerate?.(page.id, extra);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Edit Page {page ? page.pageNumber + 1 : ''}
          </DialogTitle>
          <DialogDescription>
            Change the words, adjust the picture description, or repaint this page&apos;s picture.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="page-text">Page text</Label>
            <Textarea
              id="page-text"
              value={pageText}
              onChange={(e) => setPageText(e.target.value)}
              rows={3}
              maxLength={MAX_PAGE_TEXT_LENGTH}
              placeholder="The words shown (and read aloud) on this page"
            />
            <p className="text-xs text-muted-foreground">
              Editing the text resets this page&apos;s narration so it can be re-recorded to match.
            </p>
          </div>

          {pageHasArt && (
            <div className="space-y-2">
              <Label htmlFor="image-prompt">Picture description</Label>
              <Textarea
                id="image-prompt"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={4}
                maxLength={MAX_IMAGE_PROMPT_LENGTH}
                placeholder="What the picture on this page should show"
              />
              <p className="text-xs text-muted-foreground">
                Changes take effect when the picture is repainted.
              </p>
            </div>
          )}

          {pageHasArt && onRegenerate && (
            <div className="space-y-2">
              <Label htmlFor="additional-prompt">One-time repaint instructions (optional)</Label>
              <Textarea
                id="additional-prompt"
                value={additionalPrompt}
                onChange={(e) => setAdditionalPrompt(e.target.value)}
                rows={2}
                placeholder="e.g. Make the sky pink, show everyone smiling..."
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || disabled || (!textDirty && !promptDirty)}>
            {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          {pageHasArt && onRegenerate && (
            <Button onClick={handleSaveAndRepaint} disabled={isSaving || disabled} variant="default">
              {isSaving ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Save &amp; repaint picture
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
