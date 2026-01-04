'use client';

import {useEffect, useState, useMemo} from 'react';
import {useParams, useSearchParams} from 'next/navigation';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {LoaderCircle, BookOpen, Shield, Play} from 'lucide-react';
import type {StoryOutputPage} from '@/lib/types';
import {ImmersivePlayer} from '@/components/book-reader/immersive-player';

type ShareViewResponse = {
  ok: true;
  storyId: string;
  storybookId?: string;
  bookId: string;
  shareId: string;
  finalizationVersion: number;
  metadata: {
    bookTitle?: string;
    childName?: string;
  } | null;
  pages: Array<{
    pageNumber: number;
    kind: string;
    title?: string | null;
    bodyText?: string | null;
    displayText?: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
  }>;
  share: {
    expiresAt?: string | null;
    requiresPasscode: boolean;
    passcodeHint?: string | null;
  };
};

export default function StorybookSharePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const shareId = params?.shareId as string;
  const initialToken = searchParams?.get('token') ?? '';
  const [loading, setLoading] = useState(true);
  const [shareData, setShareData] = useState<ShareViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresToken, setRequiresToken] = useState(false);
  const [passcodeHint, setPasscodeHint] = useState<string | null>(null);
  const [passcodeInput, setPasscodeInput] = useState(initialToken ?? '');
  const [submittingPasscode, setSubmittingPasscode] = useState(false);
  const [showImmersivePlayer, setShowImmersivePlayer] = useState(false);

  const fetchShare = async (token?: string | null) => {
    setLoading(true);
    setError(null);
    setRequiresToken(false);
    try {
      const url = new URL('/api/storyBook/share', window.location.origin);
      url.searchParams.set('shareId', shareId);
      if (token) {
        url.searchParams.set('token', token);
      }
      const response = await fetch(url.toString());
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        if (data?.requiresToken) {
          setRequiresToken(true);
          setPasscodeHint(data?.passcodeHint ?? null);
          setShareData(null);
          return;
        }
        throw new Error(data?.errorMessage || 'Unable to load storybook.');
      }
      setShareData(data as ShareViewResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected error loading share link.';
      setError(message);
      setShareData(null);
    } finally {
      setLoading(false);
      setSubmittingPasscode(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetchShare(initialToken || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  const handleSubmitPasscode = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittingPasscode(true);
    await fetchShare(passcodeInput);
  };

  const heroTitle = shareData?.metadata?.bookTitle ?? 'Shared Storybook';
  const childName = shareData?.metadata?.childName;

  // Convert API response pages to StoryOutputPage format for ImmersivePlayer
  const storyPages: StoryOutputPage[] = useMemo(() => {
    if (!shareData?.pages) return [];
    return shareData.pages.map((page, index) => ({
      id: `page-${index}`,
      pageNumber: page.pageNumber,
      kind: page.kind as StoryOutputPage['kind'],
      title: page.title ?? undefined,
      bodyText: page.bodyText ?? undefined,
      displayText: page.displayText ?? page.bodyText ?? undefined,
      imageUrl: page.imageUrl ?? undefined,
      audioUrl: page.audioUrl ?? undefined,
      createdAt: null,
      updatedAt: null,
    }));
  }, [shareData?.pages]);

  // Get cover image for the welcome screen
  const coverImage = storyPages.find(p => p.kind === 'cover_front')?.imageUrl || storyPages[0]?.imageUrl;

  // If showing immersive player, render it fullscreen
  if (showImmersivePlayer && shareData) {
    return (
      <ImmersivePlayer
        pages={storyPages}
        bookTitle={heroTitle}
        onPlayAgain={() => {
          // Reset to start
        }}
        onExit={() => setShowImmersivePlayer(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Loading state */}
      {loading && (
        <div className="flex min-h-screen items-center justify-center">
          <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex min-h-screen items-center justify-center px-4">
          <Card className="mx-auto max-w-md text-center">
            <CardHeader>
              <CardTitle>Link unavailable</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => fetchShare(passcodeInput || undefined)}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Passcode required state */}
      {!loading && !error && requiresToken && (
        <div className="flex min-h-screen items-center justify-center px-4">
          <Card className="mx-auto max-w-md">
            <CardHeader className="space-y-2 text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Shield className="h-5 w-5" />
                Passcode Required
              </CardTitle>
              <CardDescription>
                This family protected their book with a secret code.
                {passcodeHint ? ` Hint: ends with ${passcodeHint}.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleSubmitPasscode}>
                <Input
                  placeholder="Enter passcode"
                  value={passcodeInput}
                  onChange={(event) => setPasscodeInput(event.target.value)}
                  autoFocus
                />
                <Button type="submit" disabled={submittingPasscode} className="w-full">
                  {submittingPasscode && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Unlock Storybook
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Welcome/Cover screen - ready to read */}
      {!loading && !error && !requiresToken && shareData && (
        <div className="relative min-h-screen">
          {/* Background cover image */}
          {coverImage && (
            <div
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{backgroundImage: `url(${coverImage})`}}
            />
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />

          {/* Content */}
          <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
            {/* Logo/Brand */}
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-white/70">
              StoryPic Kids
            </p>

            {/* Title */}
            <h1 className="mb-2 text-center text-4xl font-headline text-white drop-shadow-lg sm:text-5xl md:text-6xl">
              {heroTitle}
            </h1>

            {/* Child name */}
            {childName && (
              <p className="mb-8 text-center text-xl text-white/80">
                A story made for {childName}
              </p>
            )}

            {/* Play button */}
            <button
              onClick={() => setShowImmersivePlayer(true)}
              className="group mb-8 flex flex-col items-center gap-4 transition-transform hover:scale-105"
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/90 shadow-2xl transition-all group-hover:bg-white group-hover:shadow-primary/30">
                <Play className="h-12 w-12 text-primary fill-primary ml-1" />
              </div>
              <span className="text-lg font-medium text-white">Tap to read</span>
            </button>

            {/* Share info */}
            <div className="mt-auto flex flex-wrap items-center justify-center gap-4 text-sm text-white/60">
              {shareData.share.requiresPasscode && (
                <span className="flex items-center gap-1">
                  <Shield className="h-4 w-4" />
                  Protected
                </span>
              )}
              <span className="flex items-center gap-1">
                <BookOpen className="h-4 w-4" />
                {storyPages.length} pages
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !requiresToken && !shareData && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
          <BookOpen className="h-10 w-10" />
          <p>Nothing to show yet. Ask the parent to double-check the link.</p>
        </div>
      )}
    </div>
  );
}
