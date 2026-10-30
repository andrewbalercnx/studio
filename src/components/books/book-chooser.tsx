'use client';

/**
 * The child's two choices once a story is finished (ADR-0011): what kind of
 * book (the Form) and how it looks (the Style). Choosing a Style creates the
 * Book with `POST /api/books`; length and density default from the Form on
 * the server. Used by the kids PWA and the web child shell.
 */
import { useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Book, Check, LoaderCircle, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useCreateBook } from '@/hooks/use-books';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { styleSuitsAge, useBookCatalog, type FormOption, type StyleOption } from './use-book-catalog';

export type BookChooserProps = {
  storyId: string;
  /** The child's age, to offer only Styles that suit it (null: all). */
  childAge: number | null;
  /** Called once the Book exists; the caller navigates to its progress view. */
  onCreated: (bookId: string) => void;
  /** Leave the chooser from the first step. */
  onExit: () => void;
};

export function BookChooser({ storyId, childAge, onCreated, onExit }: BookChooserProps) {
  const { toast } = useToast();
  const { forms, styles, loading, error } = useBookCatalog();
  const { createBook, pending } = useCreateBook();
  const [form, setForm] = useState<FormOption | null>(null);
  const [chosenStyleId, setChosenStyleId] = useState<string | null>(null);

  const suitableStyles = useMemo(() => styles.filter((style) => styleSuitsAge(style, childAge)), [styles, childAge]);

  const chooseStyle = async (style: StyleOption) => {
    if (!form || pending) return;
    setChosenStyleId(style.id);
    try {
      const result = await createBook({ storyId, formId: form.id, styleId: style.id });
      // Funnel: Book creation started (ids only, no PII).
      track(ANALYTICS_EVENTS.storybookGenerationStarted, { bookId: result.bookId, outputTypeId: form.id, styleId: style.id });
      onCreated(result.bookId);
    } catch (err) {
      console.error('[BookChooser] Could not create the book', err);
      toast({
        title: 'Oops!',
        description: err instanceof Error ? err.message : 'We could not start your book. Please try again.',
        variant: 'destructive',
      });
      setChosenStyleId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-4 text-center">
        <span className="text-5xl" role="img" aria-label="books">📚</span>
        <p className="text-amber-800">{error} Let&apos;s try again!</p>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex flex-col">
        <header className="px-4 py-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-amber-700" aria-label="Back" onClick={onExit}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 text-center">
            <p className="text-sm text-amber-700">Step 1 of 2</p>
          </div>
          <div className="w-10" />
        </header>
        <main className="flex-1 px-4 pb-8">
          <div className="max-w-md mx-auto space-y-6">
            <div className="text-center space-y-2">
              <Book className="h-12 w-12 mx-auto text-amber-600" />
              <h1 className="text-2xl font-bold text-amber-900">Choose Your Book Type</h1>
              <p className="text-amber-700">How would you like your story to look?</p>
            </div>
            <div className="space-y-3">
              {forms.map((option) => (
                <button key={option.id} onClick={() => setForm(option)} className="w-full text-left">
                  <Card className="border-2 transition-all hover:shadow-lg border-amber-200 hover:border-amber-400 bg-white">
                    <CardContent className="p-5">
                      <h3 className="text-lg font-bold text-gray-900">{option.childFacingLabel || option.name}</h3>
                      {option.shortDescription && <p className="text-sm text-gray-600 mt-1">{option.shortDescription}</p>}
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
            {forms.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No book types available right now.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="px-4 py-4 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="text-amber-700"
          aria-label="Back"
          disabled={pending}
          onClick={() => setForm(null)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 text-center">
          <p className="text-sm text-amber-700">Step 2 of 2</p>
        </div>
        <div className="w-10" />
      </header>
      <main className="flex-1 px-4 pb-8">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2">
            <Palette className="h-12 w-12 mx-auto text-amber-600" />
            <h1 className="text-2xl font-bold text-amber-900">Pick Your Art Style</h1>
            <p className="text-amber-700">Tap the picture you like best!</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {suitableStyles.map((style) => {
              const chosen = chosenStyleId === style.id;
              return (
                <button
                  key={style.id}
                  onClick={() => chooseStyle(style)}
                  disabled={pending}
                  className={cn(
                    'relative flex flex-col items-center gap-2 transition-all hover:scale-105 active:scale-95',
                    pending && !chosen && 'opacity-50'
                  )}
                >
                  <div
                    className={cn(
                      'relative w-28 h-28 rounded-full overflow-hidden border-4 transition-all shadow-lg',
                      chosen ? 'border-amber-500 ring-4 ring-amber-300' : 'border-amber-200 hover:border-amber-400'
                    )}
                  >
                    {style.sampleImageUrl ? (
                      <Image src={style.sampleImageUrl} alt={style.title || 'Art style'} fill className="object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                        <span className="text-3xl">🎨</span>
                      </div>
                    )}
                    {chosen && (
                      <div className="absolute inset-0 bg-amber-500/30 flex items-center justify-center">
                        {pending ? (
                          <LoaderCircle className="h-10 w-10 animate-spin text-white drop-shadow-lg" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-amber-500 flex items-center justify-center">
                            <Check className="h-8 w-8 text-white" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-gray-800 text-center">{style.title}</p>
                </button>
              );
            })}
          </div>
          {suitableStyles.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No art styles available right now.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
