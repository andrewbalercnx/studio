'use client';
import { useState, useEffect } from 'react';
import type { ArtStyle, Character } from '@/lib/types';
import ArtStyleSelector from './art-style-selector';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { PlusCircle, LoaderCircle, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useToast } from '@/hooks/use-toast';
import { transformImageToCharacter } from '@/ai/flows/character-image-transformation';
import Image from 'next/image';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useUser } from '@/firebase/auth/use-user';
import { useRouter } from 'next/navigation';
import { useUploadFile } from '@/firebase/storage/use-upload-file';
import { useFirestore } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';

type CharacterCreatorProps = {
  characters: Character[];
  setCharacters: (characters: Character[]) => void;
  artStyle: ArtStyle | null;
  setArtStyle: (style: ArtStyle | null) => void;
};

export default function CharacterCreator({ characters, setCharacters, artStyle, setArtStyle }: CharacterCreatorProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login?redirect=/create');
    }
  }, [user, userLoading, router]);

  if (userLoading || !user) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>1. Choose an Art Style</CardTitle>
            <CardDescription>This style will be used for all your characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <ArtStyleSelector selectedStyle={artStyle} setSelectedStyle={setArtStyle} />
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>2. Add Your Characters</CardTitle>
            <CardDescription>Upload photos of yourself, friends, or family!</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full" disabled={!artStyle}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {artStyle ? 'Add a New Character' : 'Please select an art style first'}
                </Button>
              </DialogTrigger>
              <AddCharacterDialog 
                artStyle={artStyle!} 
                onCharacterCreated={(char) => setCharacters([...characters, char])}
                closeDialog={() => setIsDialogOpen(false)}
              />
            </Dialog>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {characters.map(char => (
                <Card key={char.id} className="relative group">
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <Avatar className="h-24 w-24">
                      <AvatarImage src={char.transformedImageUrl} alt={char.name}/>
                      <AvatarFallback>{char.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <p className="font-semibold">{char.name}</p>
                     <Button 
                        variant="destructive" 
                        size="icon" 
                        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setCharacters(characters.filter(c => c.id !== char.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete {char.name}</span>
                      </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AddCharacterDialog({ artStyle, onCharacterCreated, closeDialog }: { artStyle: ArtStyle, onCharacterCreated: (character: Character) => void, closeDialog: () => void }) {
  const [name, setName] = useState('');
  const [photoDataUri, setPhotoDataUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { uploadFile } = useUploadFile();
  const firestore = useFirestore();
  const { user } = useUser();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoDataUri(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!name || !photoDataUri || !artStyle || !user || !firestore) {
      toast({ title: 'Please fill out all fields and be signed in.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      // 1. Transform the image
      const result = await transformImageToCharacter({
        photoDataUri,
        artStyleDescription: artStyle.imageHint
      });

      const characterId = new Date().toISOString();

      // 2. Upload both original and transformed images to Firebase Storage
      const originalPhotoUrl = await uploadFile(`characters/${characterId}_original.png`, photoDataUri);
      const transformedImageUrl = await uploadFile(`characters/${characterId}_transformed.png`, result.transformedImageDataUri);

      // 3. Create character object
      const newCharacter: Character = {
        id: characterId,
        name,
        originalPhotoUrl, // URL from storage
        transformedImageUrl, // URL from storage
      };

      // 4. Save character metadata to Firestore
      await setDoc(doc(firestore, `users/${user.uid}/characters`, characterId), newCharacter);

      onCharacterCreated(newCharacter);
      toast({ title: `Character "${name}" created!` });
      closeDialog();
    } catch (error) {
      console.error(error);
      toast({
        title: 'Character creation failed',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create a New Character</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div>
          <Label htmlFor="character-name">Character's Name</Label>
          <Input id="character-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="photo">Upload Photo</Label>
          <Input id="photo" type="file" accept="image/*" onChange={handleFileChange} />
        </div>
        {photoDataUri && (
          <div className="w-full flex justify-center">
            <Image src={photoDataUri} alt="Preview" width={150} height={150} className="rounded-lg object-cover" />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={closeDialog}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={isLoading || !name || !photoDataUri}>
          {isLoading ? <LoaderCircle className="animate-spin" /> : 'Create Character'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
