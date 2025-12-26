'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { PrintStoryBook, PrintStoryBookPage } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Download, RefreshCw, ExternalLink, CheckCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export default function PrintStoryBookPagesEditor() {
  const params = useParams<{ bookId: string; printStoryBookId: string }>();
  const { bookId, printStoryBookId } = params;
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const { isParentGuardValidated, showPinModal } = useParentGuard();

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isGeneratingPDFs, setIsGeneratingPDFs] = useState(false);

  // Fetch the PrintStoryBook document
  const printStoryBookRef = useMemo(
    () => (firestore && printStoryBookId ? doc(firestore, 'printStoryBooks', printStoryBookId) : null),
    [firestore, printStoryBookId]
  );
  const { data: printStoryBook, loading: printStoryBookLoading } = useDocument<PrintStoryBook>(printStoryBookRef);

  const pages = printStoryBook?.pages || [];
  const currentPage = pages[currentPageIndex];

  const handleGeneratePDFs = async () => {
    if (!user || !firestore || !printStoryBook) {
      return;
    }

    // Verify parent guard
    if (!isParentGuardValidated) {
      showPinModal();
      return;
    }

    setIsGeneratingPDFs(true);

    try {
      const response = await fetch(`/api/printStoryBooks/${printStoryBookId}/generate-pdfs`, {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.details || result?.error || 'Failed to generate PDFs');
      }

      toast({
        title: 'PDFs Generated',
        description: 'Your printable PDFs are ready!',
      });

      // Only navigate to order page on first generation (not regeneration)
      if (printStoryBook.pdfStatus !== 'ready') {
        router.push(`/storybook/${bookId}/order?printStoryBookId=${printStoryBookId}`);
      }
    } catch (error) {
      console.error('Error generating PDFs:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate PDFs. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingPDFs(false);
    }
  };

  const getPageTypeBadge = (type: PrintStoryBookPage['type']) => {
    const badges: Record<PrintStoryBookPage['type'], { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
      cover_front: { label: 'Front Cover', variant: 'default' },
      cover_back: { label: 'Back Cover', variant: 'default' },
      endpaper_front: { label: 'Front Endpaper', variant: 'secondary' },
      endpaper_back: { label: 'Back Endpaper', variant: 'secondary' },
      interior: { label: 'Interior', variant: 'outline' },
    };
    const badge = badges[type];
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Please sign in to continue.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (printStoryBookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!printStoryBook) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertTitle>Print storybook not found</AlertTitle>
              <AlertDescription>
                The print storybook you're looking for doesn't exist or you don't have permission to view it.
              </AlertDescription>
            </Alert>
            <div className="mt-4">
              <Link href={`/story/${bookId}`}>
                <Button variant="outline" className="w-full">
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back to Story
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <Link href={`/storybook/${bookId}/print-layout`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to Layout Selection
          </Button>
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">{printStoryBook.title}</h1>
            <p className="text-muted-foreground">
              Review and adjust your pages before generating PDFs
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Total Pages</div>
            <div className="text-2xl font-bold">{pages.length}</div>
          </div>
        </div>
      </div>

      {/* Page Navigation */}
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="outline"
          onClick={() => setCurrentPageIndex(Math.max(0, currentPageIndex - 1))}
          disabled={currentPageIndex === 0}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Previous
        </Button>

        <div className="text-center">
          <div className="text-sm text-muted-foreground">Page</div>
          <div className="text-lg font-semibold">
            {currentPageIndex + 1} of {pages.length}
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => setCurrentPageIndex(Math.min(pages.length - 1, currentPageIndex + 1))}
          disabled={currentPageIndex === pages.length - 1}
        >
          Next
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Current Page Preview */}
      {currentPage && (
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Page {currentPage.pageNumber}</CardTitle>
              {getPageTypeBadge(currentPage.type)}
            </div>
            <CardDescription>
              {currentPage.type === 'interior' && 'Interior page content'}
              {currentPage.type === 'cover_front' && 'Front cover of your book'}
              {currentPage.type === 'cover_back' && 'Back cover of your book'}
              {currentPage.type === 'endpaper_front' && 'Front endpaper (decorative)'}
              {currentPage.type === 'endpaper_back' && 'Back endpaper (decorative)'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-lg p-8 min-h-[500px]">
              <div className="bg-white rounded shadow-lg p-8 max-w-2xl mx-auto aspect-[8.5/11]">
                {/* Text Content */}
                {currentPage.displayText && (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-muted-foreground">Text</span>
                    </div>
                    <div className="prose prose-sm">
                      {currentPage.displayText}
                    </div>
                  </div>
                )}

                {/* Image Content */}
                {currentPage.imageUrl && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-muted-foreground">Image</span>
                    </div>
                    <div className="border rounded overflow-hidden">
                      <img
                        src={currentPage.imageUrl}
                        alt={`Page ${currentPage.pageNumber}`}
                        className="w-full h-auto"
                      />
                    </div>
                  </div>
                )}

                {/* Empty Page */}
                {!currentPage.displayText && !currentPage.imageUrl && (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <p className="text-sm">This page is blank</p>
                      {(currentPage.type === 'endpaper_front' || currentPage.type === 'endpaper_back') && (
                        <p className="text-xs mt-2">Endpapers are typically decorative</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Page Thumbnails Grid */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">All Pages</h2>
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {pages.map((page, index) => (
            <button
              key={index}
              onClick={() => setCurrentPageIndex(index)}
              className={`aspect-[8.5/11] rounded border-2 transition-all hover:shadow-md ${
                currentPageIndex === index
                  ? 'border-primary shadow-lg'
                  : 'border-muted hover:border-primary/50'
              }`}
            >
              <div className="bg-white h-full flex flex-col items-center justify-center p-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {page.pageNumber}
                </div>
                {page.displayText && <FileText className="h-3 w-3 mt-1 text-muted-foreground" />}
                {page.imageUrl && <ImageIcon className="h-3 w-3 mt-1 text-muted-foreground" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* PDF Status Section */}
      {printStoryBook.pdfStatus === 'ready' && (printStoryBook.coverPdfUrl || printStoryBook.interiorPdfUrl) && (
        <Card className="mb-8 border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <CardTitle className="text-green-800">PDFs Ready</CardTitle>
            </div>
            <CardDescription className="text-green-700">
              Your printable PDFs have been generated and are ready for ordering.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {printStoryBook.coverPdfUrl && (
                <a
                  href={printStoryBook.coverPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-green-700 hover:text-green-900 underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Cover PDF
                </a>
              )}
              {printStoryBook.interiorPdfUrl && (
                <a
                  href={printStoryBook.interiorPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-green-700 hover:text-green-900 underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  View Interior PDF
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* PDF Error Status */}
      {printStoryBook.pdfStatus === 'error' && (
        <Alert variant="destructive" className="mb-8">
          <AlertTitle>PDF Generation Failed</AlertTitle>
          <AlertDescription>
            {printStoryBook.pdfErrorMessage || 'An error occurred while generating the PDFs. Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center gap-4">
        <Link href={`/story/${bookId}`}>
          <Button variant="outline">Cancel</Button>
        </Link>

        <div className="flex gap-4">
          {printStoryBook.pdfStatus === 'ready' && (
            <>
              <Button
                variant="outline"
                onClick={handleGeneratePDFs}
                disabled={isGeneratingPDFs}
              >
                {isGeneratingPDFs ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate PDFs
                  </>
                )}
              </Button>
              <Link href={`/storybook/${bookId}/order?printStoryBookId=${printStoryBookId}`}>
                <Button>
                  <Download className="mr-2 h-4 w-4" />
                  Order Print Book
                </Button>
              </Link>
            </>
          )}

          {printStoryBook.pdfStatus !== 'ready' && (
            <Button onClick={handleGeneratePDFs} disabled={isGeneratingPDFs}>
              {isGeneratingPDFs ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Generating PDFs...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Generate PDFs
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
