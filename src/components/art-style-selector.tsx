'use client';
import Image from 'next/image';
import { ArtStyles } from '@/lib/placeholder-images';
import type { ArtStyle } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle } from 'lucide-react';

type ArtStyleSelectorProps = {
  selectedStyle: ArtStyle | null;
  setSelectedStyle: (style: ArtStyle | null) => void;
};

export default function ArtStyleSelector({ selectedStyle, setSelectedStyle }: ArtStyleSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {ArtStyles.map((style) => (
        <Card
          key={style.id}
          className={cn(
            'cursor-pointer transition-all relative',
            selectedStyle?.id === style.id
              ? 'border-primary border-2 shadow-lg'
              : 'border-border hover:border-primary/50'
          )}
          onClick={() => setSelectedStyle(style)}
        >
          {selectedStyle?.id === style.id && (
            <div className="absolute -top-2 -right-2 bg-primary rounded-full z-10">
              <CheckCircle className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          <CardContent className="p-2 space-y-2">
            <div className="aspect-video relative w-full overflow-hidden rounded-md">
              <Image
                src={style.imageUrl}
                alt={style.name}
                fill
                className="object-cover transition-transform hover:scale-105"
                data-ai-hint={style.imageHint}
              />
            </div>
            <p className="font-semibold text-center text-sm">{style.name}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
