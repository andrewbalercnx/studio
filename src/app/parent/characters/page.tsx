
'use client';

import { useMemo, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  where,
  writeBatch,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import type { Character } from '@/lib/types';
import { LoaderCircle, Plus, User, Pencil, X, Trash2, Smile, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { useUploadFile } from '@/firebase/storage/use-upload-file';
import NextImage from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function CharacterForm({ parentUid, onSave, character }: { parentUid: string; onSave: () => void; character?: Character | null }) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const isEditing = !!character;
  const [name, setName] = useState(character?.displayName ?? '');
  const [description, setDescription] = useState(character?.description ?? '');
  const [role, setRole] = useState<Character['role']>(character?.role ?? 'friend');
  const [traits, setTraits] = useState(character?.traits?.join(', ') ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async () => {
    if (!firestore || !name) {
      toast({ title: 'Please fill out all fields.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    const charId = character?.id ?? `${slugify(name)}-${Date.now().toString().slice(-6)}`;
    const docRef = doc(firestore, 'characters', charId);

    const payload: Partial<Character> = {
      displayName: name,
      description: description,
      ownerParentUid: parentUid,
      role: role,
      traits: traits.split(',').map(t => t.trim()).filter(Boolean),
      updatedAt: serverTimestamp() as any,
    };

    if (!isEditing) {
      payload.createdAt = serverTimestamp() as any;
      payload.avatarUrl = `https://picsum.photos/seed/${charId}/200/200`;
      payload.photos = [];
    }

    try {
      await setDoc(docRef, payload, { merge: true });
      toast({
        title: isEditing ? 'Character updated!' : 'Character created!',
        description: `${name} has been saved.`,
      });
      onSave();
    } catch (e: any) {
      toast({ title: 'Error saving character', description: e.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Character's Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as Character['role'])}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
                <SelectItem value="friend">Friend</SelectItem>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="pet">Pet</SelectItem>
                <SelectItem value="toy">Toy</SelectItem>
            </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g., A brave little bear who loves honey." />
      </div>
      <div className="space-y-2">
        <Label htmlFor="traits">Traits (comma-separated)</Label>
        <Input id="traits" value={traits} onChange={(e) => setTraits(e.target.value)} placeholder="e.g., brave, funny, curious" />
      </div>
      <Button onClick={handleSubmit} disabled={isSaving}>
        {isSaving ? <LoaderCircle className="animate-spin mr-2" /> : null}
        {isEditing ? 'Update Character' : 'Save Character'}
      </Button>
    </div>
  );
}

export default function ManageCharactersPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);

  const charactersQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'characters'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  useEffect(() => {
    if (!charactersQuery) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      charactersQuery,
      (snapshot) => {
        const characterList = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as Character));
        setCharacters(characterList);
        setLoading(false);
      },
      (error) => {
        toast({ title: 'Error loading characters', description: error.message, variant: 'destructive' });
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [charactersQuery, toast]);

  const openForm = (character: Character | null = null) => {
    setEditingCharacter(character);
    setIsFormOpen(true);
  };

  const handleDelete = async (characterId: string) => {
    if (!firestore || !window.confirm('Are you sure you want to delete this character?')) return;
    try {
      await deleteDoc(doc(firestore, 'characters', characterId));
      toast({ title: 'Character deleted' });
    } catch (e: any) {
      toast({ title: 'Error deleting character', description: e.message, variant: 'destructive' });
    }
  };

  const renderContent = () => {
    if (userLoading || loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span>Loading characters...</span>
        </div>
      );
    }
    if (!user) {
      return <p className="text-center text-muted-foreground py-8">You must be signed in to manage characters.</p>;
    }
    if (characters.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">No characters found.</p>
          <Button onClick={() => openForm()}>Create a character</Button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {characters.map((char) => (
          <Card key={char.id}>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={char.avatarUrl} alt={char.displayName} className="object-cover" />
                <AvatarFallback>{char.displayName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle>{char.displayName}</CardTitle>
                <CardDescription className="capitalize">{char.role}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {char.description && <p className="text-sm text-muted-foreground mb-3">{char.description}</p>}
              <div className="flex flex-wrap gap-1">
                {char.traits?.map((trait) => (
                  <Badge key={trait} variant="secondary">{trait}</Badge>
                ))}
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => openForm(char)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(char.id)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCharacter ? 'Edit Character' : 'Create New Character'}</DialogTitle>
            </DialogHeader>
            {user && <CharacterForm parentUid={user.uid} onSave={() => setIsFormOpen(false)} character={editingCharacter} />}
          </DialogContent>
        </Dialog>

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Manage Characters</h1>
          <Button onClick={() => openForm()}>
            <Plus className="mr-2" /> Add New Character
          </Button>
        </div>
        
        <Card>
          <CardContent className="pt-6">
            {renderContent()}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
