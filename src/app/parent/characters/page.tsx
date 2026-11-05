'use client';

/**
 * The family's characters (slice 5.7b). Read and changed through
 * `/api/characters/**`; the browser never writes character documents.
 */
import { useState, useCallback } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { LoaderCircle, Plus, Pencil, Smile } from 'lucide-react';
import { DeleteButton, UndoBanner, useDeleteWithUndo } from '@/components/shared/DeleteWithUndo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { EntityEditor } from '@/components/shared/EntityEditor';
import { peopleApi, type CharacterView, type PersonView } from '@/lib/people/api';
import { useCharacters, useChildren } from '@/lib/people/use-people';

export default function ManageCharactersPage() {
  const { user, loading: userLoading } = useUser();
  const { toast } = useToast();
  const { items: characters, loading, reload, replace } = useCharacters();
  const { items: children } = useChildren();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<CharacterView | null>(null);
  const { deletedItem, markAsDeleted, clearDeletedItem } = useDeleteWithUndo();

  const openForm = (character: CharacterView | null = null) => {
    setEditingCharacter(character);
    setIsFormOpen(true);
  };

  const handleSaved = useCallback((saved?: PersonView) => {
    if (saved?.kind === 'character') replace(saved);
    setIsFormOpen(false);
  }, [replace]);

  const handleLikenessChange = useCallback((person: PersonView) => {
    if (person.kind === 'character') replace(person);
  }, [replace]);

  const handleDeleteCharacter = useCallback(async (characterId: string) => {
    const character = characters.find(c => c.id === characterId);
    if (!character) return;
    try {
      await peopleApi.remove('character', characterId);
      await reload();
      markAsDeleted({ id: characterId, name: character.displayName, type: 'character' });
      toast({ title: 'Character deleted', description: `${character.displayName} has been removed.` });
    } catch (error) {
      toast({ title: 'Could not delete', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  }, [characters, markAsDeleted, reload, toast]);

  const handleUndoDelete = useCallback(async (characterId: string) => {
    try {
      await peopleApi.restore('character', characterId);
      await reload();
      toast({ title: 'Undo successful', description: 'The character has been restored.' });
    } catch (error) {
      toast({ title: 'Could not restore', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  }, [reload, toast]);

  const visibleCharacters = characters;

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
        <div className="text-center py-10 border-2 border-dashed rounded-lg" data-wiz-target="add-first-character">
          <Smile className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Add a story companion</h2>
          <p className="text-muted-foreground mb-4 max-w-md mx-auto">
            Characters are the friends who join your child&apos;s adventures — a pet, a grandparent,
            a favourite toy. They&apos;re optional, but familiar faces make stories feel like home.
          </p>
          <Button onClick={() => openForm()}>
            <Plus className="mr-2 h-4 w-4" />
            Create a character
          </Button>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleCharacters.map((char) => (
          <Card key={char.id} data-wiz-target={`character-card-${char.id}`}>
            <CardHeader className="flex flex-row items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={char.likeness.avatar ?? undefined} alt={char.displayName} className="object-cover" />
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
              {(char.likes?.length > 0 || char.dislikes.length > 0) ? (
                <div className="space-y-2">
                  {char.likes.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Likes:</p>
                      <div className="flex flex-wrap gap-1">
                        {char.likes.map((like) => (
                          <Badge key={like} variant="secondary" className="text-xs">{like}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {char.dislikes.length > 0 && (
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
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingCharacter ? 'Edit Character' : 'Create New Character'}</DialogTitle>
            </DialogHeader>
            {user && (
              <EntityEditor
                entityType="character"
                entity={editingCharacter}
                childOptions={children}
                onSave={handleSaved}
                onCancel={() => setIsFormOpen(false)}
                onLikenessChange={handleLikenessChange}
              />
            )}
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
