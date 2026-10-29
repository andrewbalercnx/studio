'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStoryView } from '@/hooks/use-stories';
import { storyStatusLabel } from '@/lib/stories/types';
import { useBooks, useCreateBook } from '@/hooks/use-books';
import { BookCard, useBookCatalog } from '@/components/books';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, Plus, Book } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export default function StoryDetailPage({ params }: { params: Promise<{ storyId: string }> }) {
  const resolvedParams = use(params);
  const storyId = resolvedParams.storyId;
  const router = useRouter();
  const { toast } = useToast();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { createBook, pending: isCreating } = useCreateBook();
  const { forms, styles } = useBookCatalog();
  // Books from the server pipeline for this story (status from the server).
  const { books, loading: booksLoading } = useBooks({ storyId });
  const [selectedOutputTypeId, setSelectedOutputTypeId] = useState<string>('');
  const [selectedImageStyleId, setSelectedImageStyleId] = useState<string>('');

  // The Story as the server renders it (names resolved, status from the server).
  const { story, loading: storyLoading, error: storyError } = useStoryView(storyId);
  const childName = story?.cast.find((member) => member.role === 'hero')?.displayName;

  const handleCreateBook = async () => {
    if (!story || !selectedOutputTypeId || !selectedImageStyleId) {
      toast({ title: 'Error', description: 'Please choose a book type and an art style', variant: 'destructive' });
      return;
    }
    try {
      const result = await createBook({ storyId, formId: selectedOutputTypeId, styleId: selectedImageStyleId });
      setIsCreateDialogOpen(false);
      setSelectedOutputTypeId('');
      setSelectedImageStyleId('');
      router.push(`/books/${result.bookId}`);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create the book',
        variant: 'destructive',
      });
    }
  };

  if (storyLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading story...</p>
      </div>
    );
  }

  if (storyError || !story) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Story Not Found</CardTitle>
            <CardDescription>We couldn&apos;t find that story.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href="/">Go Home</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-5xl space-y-8">
      {/* Story Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-3xl">{story.title || 'Untitled Story'}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                Created for {childName || 'your child'}
                <Badge variant="outline">{storyStatusLabel(story.status)}</Badge>
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={story.status !== 'complete'}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Book
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create a New Book</DialogTitle>
                  <DialogDescription>
                    Choose what kind of book and how it looks.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Book type</Label>
                    <Select value={selectedOutputTypeId} onValueChange={setSelectedOutputTypeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select book type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {forms.map((form) => (
                          <SelectItem key={form.id} value={form.id}>
                            {form.childFacingLabel || form.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Art style</Label>
                    <Select value={selectedImageStyleId} onValueChange={setSelectedImageStyleId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select art style..." />
                      </SelectTrigger>
                      <SelectContent>
                        {styles.map((style) => (
                          <SelectItem key={style.id} value={style.id}>
                            {style.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    The number of pages comes from the book type. The book keeps being made if you close this page.
                  </p>

                  <Button
                    onClick={handleCreateBook}
                    disabled={isCreating || !selectedOutputTypeId || !selectedImageStyleId}
                    className="w-full"
                  >
                    {isCreating ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Book'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none">
            <p className="text-muted-foreground whitespace-pre-wrap line-clamp-6">
              {story.text ?? 'This story is still being made.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Books (server pipeline) */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Books</h2>
        {booksLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            <span>Loading books...</span>
          </div>
        ) : books.length > 0 ? (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} href={`/books/${book.id}`} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <Book className="h-12 w-12 text-muted-foreground" />
              <div>
                <p className="font-medium">No books yet</p>
                <p className="text-sm text-muted-foreground">Create your first book from this story!</p>
              </div>
              <Button onClick={() => setIsCreateDialogOpen(true)} disabled={story.status !== 'complete'}>
                <Plus className="mr-2 h-4 w-4" />
                Create Book
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}
