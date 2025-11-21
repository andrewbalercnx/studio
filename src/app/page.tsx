import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, BookHeart, Pencil } from 'lucide-react';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-12 sm:py-16 md:py-24">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-headline font-bold tracking-tight text-foreground">
            Turn Your Stories into Magical Picture Books
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground">
            With StoryPic Kids, you write the adventure, and our AI helps you create beautiful illustrations with you and your friends as the main characters!
          </p>
          <Button asChild size="lg" className="group mt-4">
            <Link href="/create">
              Start Your Story
              <Sparkles className="ml-2 h-5 w-5 transition-transform group-hover:scale-125" />
            </Link>
          </Button>
        </div>
        <div className="relative h-80 md:h-[500px] w-full">
           <Image
            src="https://picsum.photos/seed/hero/800/600"
            alt="A collage of illustrated storybook pages"
            fill
            priority
            className="rounded-xl object-cover shadow-2xl"
            data-ai-hint="storybook collage"
           />
        </div>
      </div>

      <div className="mt-24 md:mt-32">
        <h2 className="text-3xl font-headline font-bold text-center mb-12 text-foreground">
          How It Works in 3 Easy Steps
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="text-center border-2 border-transparent hover:border-primary hover:shadow-lg transition-all">
            <CardHeader>
              <div className="mx-auto bg-accent/20 p-4 rounded-full w-fit">
                <Pencil className="h-8 w-8 text-accent-foreground" />
              </div>
              <CardTitle>1. Write Your Tale</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Get creative with help from our AI story guide. It gives you fun ideas and questions to build your plot.</p>
            </CardContent>
          </Card>
          <Card className="text-center border-2 border-transparent hover:border-primary hover:shadow-lg transition-all">
            <CardHeader>
              <div className="mx-auto bg-accent/20 p-4 rounded-full w-fit">
                <Sparkles className="h-8 w-8 text-accent-foreground" />
              </div>
              <CardTitle>2. Create Characters</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Upload photos of you and your friends, choose an art style, and watch as AI transforms them into story characters.</p>
            </CardContent>
          </Card>
          <Card className="text-center border-2 border-transparent hover:border-primary hover:shadow-lg transition-all">
             <CardHeader>
              <div className="mx-auto bg-accent/20 p-4 rounded-full w-fit">
                <BookHeart className="h-8 w-8 text-accent-foreground" />
              </div>
              <CardTitle>3. See Your Book</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">See your story come to life in a beautiful digital book, ready to be shared or even printed!</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
