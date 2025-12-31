
'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
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
  deleteField,
  getDoc,
} from 'firebase/firestore';
import type { Character, ChildProfile } from '@/lib/types';
import { LoaderCircle, Plus, User, Pencil, Smile, Image as ImageIcon } from 'lucide-react';
import { DeleteButton, UndoBanner, useDeleteWithUndo } from '@/components/shared/DeleteWithUndo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
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
import { EntityEditor } from '@/components/shared/EntityEditor';
import { VoiceSelector } from '@/components/parent/VoiceSelector';

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Wrapper to use EntityEditor for characters
function CharacterForm({ parentUid, onSave, character, children }: { parentUid: string; onSave: () => void; character?: Character | null; children: ChildProfile[] }) {
  return (
    <EntityEditor
      entityType="character"
      entity={character}
      parentUid={parentUid}
      children={children}
      onSave={onSave}
      onCancel={onSave}
    />
  );
}

export default function ManageCharactersPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

  const charactersQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'characters'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  const childrenQuery = useMemo(() => {
    if (!user || !firestore) return null;
    return query(collection(firestore, 'children'), where('ownerParentUid', '==', user.uid));
  }, [user, firestore]);

  useEffect(() => {
    if (!charactersQuery || !firestore) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Track if component is still mounted
    let isMounted = true;

    // Also fetch help-character for wizard demonstrations
    const fetchHelpCharacter = async () => {
      try {
        const helpCharDoc = await getDoc(doc(firestore, 'characters', 'help-character'));
        if (helpCharDoc.exists() && isMounted) {
          return { ...helpCharDoc.data(), id: helpCharDoc.id } as Character;
        }
      } catch {
        // Silently fail - help-character is optional for wizard demos
      }
      return null;
    };

    const unsubscribe = onSnapshot(
      charactersQuery,
      async (snapshot) => {
        const characterList = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as Character));

        // Include help-character if it exists (for wizard demonstrations)
        const helpCharacter = await fetchHelpCharacter();
        if (helpCharacter && !characterList.some(c => c.id === 'help-character')) {
          characterList.push(helpCharacter);
        }

        if (isMounted) {
          setCharacters(characterList);
          setLoading(false);
        }
      },
      (error) => {
        if (isMounted) {
          toast({ title: 'Error loading characters', description: error.message, variant: 'destructive' });
          setLoading(false);
        }
      }
    );
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [charactersQuery, firestore]);

  useEffect(() => {
    if (!childrenQuery) return;
    const unsubscribe = onSnapshot(
      childrenQuery,
      (snapshot) => {
        const childrenList = snapshot.docs.map((d) => ({ ...d.data(), id: d.id } as ChildProfile));
        setChildren(childrenList);
      },
      (error) => {
        toast({ title: 'Error loading children', description: error.message, variant: 'destructive' });
      }
    );
    return () => unsubscribe();
  }, [childrenQuery]);

  const openForm = (character: Character | null = null) => {
    setEditingCharacter(character);
    setIsFormOpen(true);
  };

  const handleDeleteCharacter = useCallback(async (characterId: string) => {
    if (!firestore || !user) return;
    const character = characters.find(c => c.id === characterId);
    if (!character) return;

    const charRef = doc(firestore, 'characters', characterId);
    await updateDoc(charRef, {
      deletedAt: serverTimestamp(),
      deletedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    markAsDeleted({ id: characterId, name: character.displayName, type: 'character' });
    toast({ title: 'Character deleted', description: `${character.displayName} has been removed.` });
  }, [firestore, user, characters, markAsDeleted, toast]);

  const handleUndoDelete = useCallback(async (characterId: string) => {
    if (!firestore) return;
    const charRef = doc(firestore, 'characters', characterId);
    await updateDoc(charRef, {
      deletedAt: deleteField(),
      deletedBy: deleteField(),
      updatedAt: serverTimestamp(),
    });
    toast({ title: 'Undo successful', description: 'The character has been restored.' });
  }, [firestore, toast]);

  // Filter out deleted characters
  const visibleCharacters = useMemo(() => {
    return characters.filter(char => !char.deletedAt);
  }, [characters]);

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
    if (visibleCharacters.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">No characters found.</p>
          <Button onClick={() => openForm()}>Create a character</Button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleCharacters.map((char) => (
          <Card key={char.id} data-wiz-target={`character-card-${char.id}`}>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={char.avatarUrl} alt={char.displayName} className="object-cover" />
                <AvatarFallback>{char.displayName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle>{char.displayName}</CardTitle>
                <CardDescription>
                  {char.type}{char.type === 'Family' && char.relationship ? ` (${char.relationship})` : ''} {char.childId ? '· Child-specific' : '· Family-wide'}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {char.description && <p className="text-sm text-muted-foreground mb-3">{char.description}</p>}
              {(char.likes?.length > 0 || char.dislikes?.length > 0) ? (
                <div className="space-y-2">
                  {char.likes?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Likes:</p>
                      <div className="flex flex-wrap gap-1">
                        {char.likes.map((like) => (
                          <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {char.dislikes?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Dislikes:</p>
                      <div className="flex flex-wrap gap-1">
                        {char.dislikes.map((dislike) => (
                          <Badge key={dislike} variant="destructive" className="text-xs opacity-70">{dislike}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => openForm(char)} data-wiz-target={`character-edit-${char.id}`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <DeleteButton
                item={{ id: char.id, name: char.displayName }}
                itemType="character"
                onDelete={handleDeleteCharacter}
                buttonVariant="ghost"
                className="text-destructive"
              />
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
            {user && <CharacterForm parentUid={user.uid} onSave={() => setIsFormOpen(false)} character={editingCharacter} children={children} />}
          </DialogContent>
        </Dialog>

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Manage Characters</h1>
          <Button onClick={() => openForm()} data-wiz-target="characters-add-button">
            <Plus className="mr-2" /> Add New Character
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            {renderContent()}
          </CardContent>
        </Card>
      </div>

      <UndoBanner
        deletedItem={deletedItem}
        onUndo={handleUndoDelete}
        onDismiss={clearDeletedItem}
      />
    </>
  );
}
