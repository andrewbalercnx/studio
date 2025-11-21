'use client'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "./ui/carousel";
import { Button } from "./ui/button";
import type { ArtStyle, Character, Story } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";

type BookPreviewProps = {
    story: Story;
    characters: Character[];
    artStyle: ArtStyle | null;
}

const chunkStory = (text: string, chunkSize = 50) => {
    const words = text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
        chunks.push(words.slice(i, i + chunkSize).join(' '));
    }
    return chunks;
}

export default function BookPreview({ story, characters, artStyle }: BookPreviewProps) {
    const { toast } = useToast();
    const storyPages = chunkStory(story.content);
    
    const handlePrint = () => {
        toast({
            title: "Printing Coming Soon!",
            description: "Our print-on-demand service is being set up. Check back soon to order your physical book!",
        });
    };

    return (
        <div className="h-full flex flex-col items-center gap-8">
            <Carousel className="w-full max-w-lg">
                <CarouselContent>
                    {/* Front Cover */}
                    <CarouselItem>
                        <Card className="aspect-[4/5]">
                            <CardContent className="flex flex-col h-full items-center justify-center p-6 text-center bg-primary/20 relative">
                                <h2 className="text-3xl font-bold font-headline mb-4">{story.title}</h2>
                                {characters.length > 0 && (
                                    <div className="relative w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 border-background shadow-lg">
                                        <Image src={characters[0].transformedImageUrl} alt="Main character" fill className="object-cover"/>
                                    </div>
                                )}
                                <p className="mt-4 text-xl">by {story.author || 'A talented author'}</p>
                            </CardContent>
                        </Card>
                    </CarouselItem>
                    
                    {/* Story Pages */}
                    {storyPages.map((pageText, index) => (
                        <CarouselItem key={index}>
                             <Card className="aspect-[4/5]">
                                <CardContent className="flex flex-col h-full p-6 md:p-8">
                                    <div className="flex-grow grid grid-cols-1 gap-4 items-center">
                                       {index % 2 === 1 && characters[index % characters.length] && (
                                            <div className="relative h-48 w-full rounded-lg overflow-hidden">
                                                 <Image src={characters[index % characters.length].transformedImageUrl} alt={`Character illustration`} fill className="object-cover"/>
                                            </div>
                                        )}
                                        <p className="text-base md:text-lg leading-relaxed flex-grow">{pageText}</p>
                                        {index % 2 === 0 && characters[index % characters.length] && (
                                            <div className="relative h-48 w-full rounded-lg overflow-hidden">
                                                 <Image src={characters[index % characters.length].transformedImageUrl} alt={`Character illustration`} fill className="object-cover"/>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-center text-sm text-muted-foreground mt-4">- {index + 1} -</p>
                                </CardContent>
                            </Card>
                        </CarouselItem>
                    ))}

                    {/* Back Cover */}
                    <CarouselItem>
                        <Card className="aspect-[4/5]">
                            <CardContent className="flex flex-col h-full items-center justify-center p-6 text-center bg-primary/20">
                                <h2 className="text-4xl font-bold font-headline">The End</h2>
                                {artStyle && 
                                    <div className="my-8 relative w-24 h-24 rounded-lg overflow-hidden border-2 border-background shadow-md">
                                        <Image src={artStyle.imageUrl} alt={artStyle.name} fill className="object-cover"/>
                                    </div>
                                }
                                <p className="text-muted-foreground">A StoryPic Kids Creation</p>
                            </CardContent>
                        </Card>
                    </CarouselItem>
                </CarouselContent>
                <CarouselPrevious className="-left-4 md:-left-12" />
                <CarouselNext className="-right-4 md:-right-12" />
            </Carousel>
            
            <Button size="lg" onClick={handlePrint}>
                Order a Printed Copy
            </Button>
        </div>
    );
}
