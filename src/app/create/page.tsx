'use client';

import { useState } from 'react';
import { Stepper } from '@/components/stepper';
import StoryWriter from '@/components/story-writer';
import CharacterCreator from '@/components/character-creator';
import BookPreview from '@/components/book-preview';
import type { Character, ArtStyle } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, BookCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { PartyPopper } from 'lucide-react';

const steps = [
  { id: '01', name: 'Write Your Story' },
  { id: '02', name: 'Create Characters' },
  { id: '03', name: 'Preview Your Book' },
];

export default function CreatePage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [story, setStory] = useState('');
  const [author, setAuthor] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedArtStyle, setSelectedArtStyle] = useState<ArtStyle | null>(null);

  const prev = () => {
    if (currentStep > 0) {
      setCurrentStep(step => step - 1);
    }
  };

  const next = () => {
    if (currentStep < steps.length) { // Allow going to a "finished" step
      setCurrentStep(step => step + 1);
    }
  };

  const startOver = () => {
    setStory('');
    setAuthor('');
    setCharacters([]);
    setSelectedArtStyle(null);
    setCurrentStep(0);
  }

  const isComplete = currentStep === steps.length;
  const stepToRender = isComplete ? steps.length - 1 : currentStep;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <div className="container pt-8 pb-4">
        <Stepper steps={steps} currentStep={currentStep} />
      </div>

      <div className="flex-grow container py-4">
        {stepToRender === 0 && !isComplete && (
          <StoryWriter
            story={story}
            setStory={setStory}
            author={author}
            setAuthor={setAuthor}
          />
        )}
        {stepToRender === 1 && !isComplete && (
          <CharacterCreator
            characters={characters}
            setCharacters={setCharacters}
            artStyle={selectedArtStyle}
            setArtStyle={setSelectedArtStyle}
          />
        )}
        {stepToRender === 2 && (
          <BookPreview 
            story={{ content: story, author: author, title: 'My Awesome Story' }} 
            characters={characters} 
            artStyle={selectedArtStyle} 
          />
        )}
        {isComplete && (
          <Card className="h-full flex flex-col items-center justify-center text-center p-8 bg-card/80">
            <PartyPopper className="h-16 w-16 text-primary mb-4" />
            <h2 className="text-3xl font-bold font-headline mb-2">You did it!</h2>
            <p className="text-muted-foreground mb-6 max-w-md">Your storybook is complete. You can go back to the preview, or start a brand new adventure.</p>
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setCurrentStep(steps.length - 1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Preview
              </Button>
              <Button onClick={startOver}>Start a New Story</Button>
            </div>
          </Card>
        )}
      </div>

      {!isComplete && (
        <div className="sticky bottom-0 bg-background/90 backdrop-blur-sm z-10">
          <div className="container py-4 border-t border-border">
            <div className="flex justify-between items-center">
              <Button onClick={prev} disabled={currentStep === 0} variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button onClick={next}>
                {currentStep === steps.length - 1 ? 'Finish' : 'Next'}
                {currentStep === steps.length - 1 ? <BookCheck className="ml-2 h-4 w-4" /> : <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
