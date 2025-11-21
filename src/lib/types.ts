export type ArtStyle = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

export type Character = {
  id: string;
  name: string;
  originalPhotoUrl: string; // data URI
  transformedImageUrl: string; // data URI
};

export type Story = {
  title: string;
  content: string;
  author: string;
}
