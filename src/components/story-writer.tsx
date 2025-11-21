'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from './ui/label';
import { Lightbulb, LoaderCircle } from 'lucide-react';
import { storySuggestionAndGuidance } from '@/ai/flows/story-suggestion-and-guidance';
import { useToast } from '@/hooks/use-toast';

type StoryWriterProps = {
  story: string;
  setStory: (story: string) => void;
  author: string;
  setAuthor: (author: string) => void;
};

export default function StoryWriter({ story, setStory, author, setAuthor }: StoryWriterProps) {
  const [previousResponses, setPreviousResponses] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>('Click the lightbulb to get a story idea!');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const getSuggestion = async () => {
    setIsLoading(true);
    setSuggestion(null);
    try {
      const result = await storySuggestionAndGuidance({ previousResponses });
      const fullResponse = result.storySuggestion ? `${result.storySuggestion} ${result.nextQuestion}` : result.nextQuestion;
      setSuggestion(fullResponse);
      setPreviousResponses(prev => [...prev, story]);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Oh no!',
        description: 'Something went wrong while getting a suggestion. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Let's Write an Adventure!</CardTitle>
        <CardDescription>
          Start writing your amazing story below. If you need a little help, click the lightbulb for ideas!
        </CardDescription>
      </CardHeader>
      <CardContent className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div>
            <Label htmlFor="author">Author's Name</Label>
            <Input 
              id="author" 
              placeholder="Your name here" 
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="text-lg"
            />
          </div>
          <div>
            <Label htmlFor="story">Your Story</Label>
            <Textarea
              id="story"
              placeholder="Once upon a time..."
              className="min-h-[300px] text-lg"
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col space-y-4">
            <Label>Story Helper</Label>
            <Card className="bg-accent/20 flex-grow">
              <CardContent className="p-4 h-full flex flex-col items-center justify-center text-center">
                {isLoading && <LoaderCircle className="h-8 w-8 animate-spin text-primary" />}
                {suggestion && !isLoading && <p className="text-lg text-accent-foreground">{suggestion}</p>}
              </CardContent>
            </Card>
            <Button onClick={getSuggestion} disabled={isLoading} variant="outline" className='group'>
              <Lightbulb className="mr-2 h-5 w-5 text-yellow-400 group-hover:scale-110 transition-transform" />
              Get a Hint
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
