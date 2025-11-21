import data from './placeholder-images.json';
import type { ArtStyle } from '@/lib/types';

export type ImagePlaceholder = {
  id: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

export const PlaceHolderImages: ImagePlaceholder[] = data.placeholderImages;


export const ArtStyles: ArtStyle[] = data.placeholderImages.map(p => ({
  id: p.id,
  name: p.imageHint.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
  description: p.description,
  imageUrl: p.imageUrl,
  imageHint: p.imageHint,
}));
