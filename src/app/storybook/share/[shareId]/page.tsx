'use client';

import {useEffect, useMemo, useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {LoaderCircle, BookOpen, Shield, Image as ImageIcon} from 'lucide-react';

type ShareViewResponse = {
  ok: true;
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
    imageUrl?: string | null;
  }>;
  share: {
    expiresAt?: string | null;
    requiresPasscode: boolean;
    passcodeHint?: string | null;
  };
};

type SharePageProps = {
  params: {shareId: string};
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function StorybookSharePage({params, searchParams}: SharePageProps) {
  const {shareId} = params;
  const initialToken = typeof searchParams?.token === 'string' ? searchParams.token : '';
  const [loading, setLoading] = useState(true);
  const [shareData, setShareData] = useState<ShareViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresToken, setRequiresToken] = useState(false);
  const [passcodeHint, setPasscodeHint] = useState<string | null>(null);
  const [passcodeInput, setPasscodeInput] = useState(initialToken ?? '');
  const [submittingPasscode, setSubmittingPasscode] = useState(false);

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
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error loading share link.');
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

  const shareExpires = useMemo(() => {
    if (!shareData?.share?.expiresAt) return null;
    try {
      return new Date(shareData.share.expiresAt).toLocaleString();
    } catch {
      return shareData.share.expiresAt;
    }
  }, [shareData]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">StoryPic Share</p>
          <h1 className="text-4xl font-headline">{heroTitle}</h1>
          {childName && <p className="text-muted-foreground">Made for {childName}</p>}
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
          </div>
        ) : error ? (
          <Card className="mx-auto max-w-md text-center">
            <CardHeader>
              <CardTitle>Link unavailable</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => fetchShare(passcodeInput || undefined)}>Try again</Button>
            </CardContent>
          </Card>
        ) : requiresToken ? (
          <Card className="mx-auto max-w-md">
            <CardHeader className="space-y-2 text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Shield className="h-5 w-5" />
                Passcode Required
              </CardTitle>
              <CardDescription>
                This family protected their book with a secret code.{passcodeHint ? ` Hint: ends with ${passcodeHint}.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleSubmitPasscode}>
                <Input
                  placeholder="Enter passcode"
                  value={passcodeInput}
                  onChange={(event) => setPasscodeInput(event.target.value)}
                />
                <Button type="submit" disabled={submittingPasscode} className="w-full">
                  {submittingPasscode && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Unlock Storybook
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : shareData ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white/70 px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">Version v{shareData.finalizationVersion}</Badge>
                {shareData.share.requiresPasscode && (
                  <Badge variant="outline" className="gap-1">
                    <Shield className="h-3 w-3" /> Protected
                  </Badge>
                )}
                {shareExpires && <span>Expires {shareExpires}</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => fetchShare(passcodeInput || undefined)}>
                Refresh
              </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {shareData.pages.map((page) => (
                <Card key={`${page.pageNumber}-${page.kind}`}>
                  <CardHeader className="space-y-1">
                    <CardTitle className="text-lg">{page.title || page.kind.replace(/_/g, ' ')}</CardTitle>
                    <CardDescription>Page {page.pageNumber}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {page.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={page.imageUrl}
                        alt={page.title ?? `Page ${page.pageNumber}`}
                        className="h-56 w-full rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                    {page.bodyText ? (
                      <p className="text-sm leading-relaxed">{page.bodyText}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">No narration on this spread.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}

        {!loading && !error && !requiresToken && !shareData && (
          <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <BookOpen className="h-10 w-10" />
            <p>Nothing to show yet. Ask the parent to double-check the link.</p>
          </div>
        )}
      </div>
    </div>
  );
}
