export type ArtStyle = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

export type Character = {
  id: string;
  name:string;
  originalPhotoUrl: string; // URL from Firebase Storage
  transformedImageUrl: string; // URL from Firebase Storage
};

export type Story = {
  title: string;
  content: string;
  author: string;
}
