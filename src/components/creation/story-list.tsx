'use client';

/**
 * A child's Stories as the server lists them (`GET /api/stories`): newest
 * first, titles with names, status from the server. Shared by the kids PWA
 * and the web child shell; the page supplies the header and the links.
 */
import Link from 'next/link';
import { BookOpen, FileText, LoaderCircle, Pencil, Sparkles, Volume2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { storyStatusLabel, type StoryView } from '@/lib/stories/types';
import { cn } from '@/lib/utils';

export type StoryListProps = {
  stories: StoryView[];
  /** Continue a Story that is still being made (or retry one that got stuck). */
  playHref: (storyId: string) => string;
  /** Read a finished Story. */
  readHref: (storyId: string) => string;
  createHref: string;
};

function friendlyDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
}

export function StoryList({ stories, playHref, readHref, createHref }: StoryListProps) {
  if (stories.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
          <BookOpen className="h-10 w-10 text-amber-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-700">No stories yet</h3>
        <p className="text-gray-500">Create your first magical story!</p>
        <Button asChild className="bg-amber-500 hover:bg-amber-600">
          <Link href={createHref}>
            <Sparkles className="h-4 w-4 mr-2" />
            Create a Story
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {stories.map((story) => (
        <StoryListCard key={story.id} story={story} playHref={playHref(story.id)} readHref={readHref(story.id)} />
      ))}
    </div>
  );
}

function StoryListCard({ story, playHref, readHref }: { story: StoryView; playHref: string; readHref: string }) {
  const complete = story.status === 'complete';
  const title = story.title || (complete ? 'My Story' : 'A story in the making');
  const others = story.cast.filter((member) => member.role !== 'hero');
  const icon =
    story.status === 'complete' ? (
      <FileText className="h-7 w-7 text-purple-500" />
    ) : story.status === 'finishing' ? (
      <LoaderCircle className="h-7 w-7 text-amber-500 animate-spin" />
    ) : (
      <Pencil className="h-7 w-7 text-gray-400" />
    );

  return (
    <Card
      className={cn('border-2 transition-all', complete ? 'border-purple-200' : 'border-gray-200')}
      data-testid="story-card"
      data-story-status={story.status}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-4">
          <div
            className={cn(
              'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0',
              complete ? 'bg-gradient-to-br from-purple-100 to-pink-100' : 'bg-gray-100'
            )}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-gray-900 truncate flex-1">{title}</h3>
              {others.length > 0 && (
                <div className="flex -space-x-2 flex-shrink-0">
                  {others.slice(0, 3).map((member) => (
                    <Avatar key={member.castId} className="h-6 w-6 border-2 border-white">
                      {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.displayName} /> : null}
                      <AvatarFallback className="bg-amber-200 text-amber-800 text-xs">{member.displayName.charAt(0)}</AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              )}
            </div>
            <p className={cn('text-sm mt-1', complete ? 'text-purple-600' : 'text-gray-500')}>{storyStatusLabel(story.status)}</p>
            {story.synopsis ? (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{story.synopsis}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">{friendlyDate(story.createdAt)}</p>
            )}
          </div>
        </div>
        {complete && (
          <Button asChild size="sm" className="bg-purple-500 hover:bg-purple-600">
            <Link href={readHref}>
              <Volume2 className="h-4 w-4 mr-1" />
              Read Story
            </Link>
          </Button>
        )}
        {(story.status === 'creating' || story.status === 'failed') && (
          <Button asChild size="sm" variant="outline" className="border-amber-400 text-amber-700">
            <Link href={playHref}>
              <Wand2 className="h-4 w-4 mr-1" />
              {story.status === 'creating' ? 'Keep going' : 'Try again'}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
