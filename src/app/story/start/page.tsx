'use client';

import { useAppContext } from '@/hooks/use-app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, MessageCircle, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function StartStoryChoicePage() {
  const { activeChildProfile, activeChildProfileLoading } = useAppContext();

  if (activeChildProfileLoading) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Choose a Profile</CardTitle>
            <CardDescription>
              Please select a child profile from the parent dashboard before starting a new story.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/parent">Back to Parent Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-10 p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-headline">How do you want to create your story?</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Choose a way to begin your adventure, {activeChildProfile.displayName}.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Link href="/story/start/chat">
          <div className="flex cursor-pointer flex-col items-center gap-4 rounded-full border-4 border-transparent p-8 text-center transition-all hover:border-primary/50 hover:bg-primary/10">
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <MessageCircle className="h-16 w-16" />
            </div>
            <h2 className="text-2xl font-semibold">Create with Chat</h2>
            <p className="max-w-xs text-muted-foreground">Talk with the Story Guide step-by-step to build your tale.</p>
          </div>
        </Link>
        <Link href="/story/start/wizard">
          <div className="flex cursor-pointer flex-col items-center gap-4 rounded-full border-4 border-transparent p-8 text-center transition-all hover:border-primary/50 hover:bg-primary/10">
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Wand2 className="h-16 w-16" />
            </div>
            <h2 className="text-2xl font-semibold">Magic Story Wizard</h2>
            <p className="max-w-xs text-muted-foreground">Answer a few questions and let the AI create a full story for you!</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
