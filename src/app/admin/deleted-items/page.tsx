'use client';

import { useMemo, useState, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteField,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import type { ChildProfile, Character, Story, StoryBookOutput } from '@/lib/types';
import {
  LoaderCircle,
  Trash2,
  RotateCcw,
  User,
  Smile,
  BookOpen,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { formatDistanceToNow } from 'date-fns';
import { useEffect } from 'react';

type DeletedChild = ChildProfile & { deletedAt: any; deletedBy: string };
type DeletedCharacter = Character & { deletedAt: any; deletedBy: string };
type DeletedStorybook = {
  id: string;
  storyId: string;
  title?: string;
  childId?: string;
  deletedAt: any;
  deletedBy: string;
  isNewModel: boolean;
};

function DeletedItemCard({
  item,
  type,
  onRestore,
  isRestoring,
}: {
  item: {
    id: string;
    name: string;
    avatarUrl?: string;
    deletedAt: any;
    deletedBy?: string;
    ownerEmail?: string;
  };
  type: 'child' | 'character' | 'storybook';
  onRestore: () => Promise<void>;
  isRestoring: boolean;
}) {
  const IconComponent = {
    child: User,
    character: Smile,
    storybook: BookOpen,
  }[type];

  const typeLabel = {
    child: 'Child Profile',
    character: 'Character',
    storybook: 'Storybook',
  }[type];

  const deletedDate = item.deletedAt?.toDate?.() || new Date();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        <Avatar className="h-12 w-12">
          <AvatarImage src={item.avatarUrl} alt={item.name} className="object-cover" />
          <AvatarFallback>
            <IconComponent className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-grow">
          <CardTitle className="text-base">{item.name}</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Badge variant="destructive" className="text-xs">
              <Trash2 className="mr-1 h-3 w-3" />
              Deleted
            </Badge>
            <span className="text-xs text-muted-foreground">{typeLabel}</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pb-2 text-sm text-muted-foreground">
        <p>Deleted {formatDistanceToNow(deletedDate, { addSuffix: true })}</p>
        {item.ownerEmail && (
          <p className="text-xs">Owner: {item.ownerEmail}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={onRestore}
          disabled={isRestoring}
          className="w-full"
        >
          {isRestoring ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          Restore
        </Button>
      </CardFooter>
    </Card>
  );
}

function DeletedSection<T extends { id: string }>({
  title,
  icon: Icon,
  items,
  type,
  onRestore,
  restoringId,
  getItemDetails,
}: {
  title: string;
  icon: React.ElementType;
  items: T[];
  type: 'child' | 'character' | 'storybook';
  onRestore: (item: T) => Promise<void>;
  restoringId: string | null;
  getItemDetails: (item: T) => {
    id: string;
    name: string;
    avatarUrl?: string;
    deletedAt: any;
    deletedBy?: string;
    ownerEmail?: string;
  };
}) {
  const [isOpen, setIsOpen] = useState(true);

  if (items.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-3 p-3 h-auto mb-2">
          <Icon className="h-5 w-5" />
          <span className="font-semibold">{title}</span>
          <Badge variant="secondary" className="ml-2">{items.length}</Badge>
          <div className="flex-grow" />
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
          {items.map((item) => {
            const details = getItemDetails(item);
            return (
              <DeletedItemCard
                key={details.id}
                item={details}
                type={type}
                onRestore={() => onRestore(item)}
                isRestoring={restoringId === details.id}
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function AdminDeletedItemsPage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const { toast } = useToast();

  const [deletedChildren, setDeletedChildren] = useState<DeletedChild[]>([]);
  const [deletedCharacters, setDeletedCharacters] = useState<DeletedCharacter[]>([]);
  const [deletedStorybooks, setDeletedStorybooks] = useState<DeletedStorybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringChildId, setRestoringChildId] = useState<string | null>(null);
  const [restoringCharacterId, setRestoringCharacterId] = useState<string | null>(null);
  const [restoringStorybookId, setRestoringStorybookId] = useState<string | null>(null);

  // Load deleted items
  const loadDeletedItems = useCallback(async () => {
    if (!firestore) return;

    setLoading(true);

    try {
      // Load deleted children
      const childrenQuery = query(
        collection(firestore, 'children'),
        where('deletedAt', '!=', null)
      );
      const childrenSnap = await getDocs(childrenQuery);
      const children = childrenSnap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as DeletedChild[];
      setDeletedChildren(children);

      // Load deleted characters
      const charactersQuery = query(
        collection(firestore, 'characters'),
        where('deletedAt', '!=', null)
      );
      const charactersSnap = await getDocs(charactersQuery);
      const characters = charactersSnap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      })) as DeletedCharacter[];
      setDeletedCharacters(characters);

      // Load deleted stories (legacy storybooks)
      const storiesQuery = query(
        collection(firestore, 'stories'),
        where('deletedAt', '!=', null)
      );
      const storiesSnap = await getDocs(storiesQuery);
      const storybooks: DeletedStorybook[] = [];

      for (const storyDoc of storiesSnap.docs) {
        const story = storyDoc.data() as Story & { deletedAt?: any; deletedBy?: string };
        if (story.deletedAt) {
          storybooks.push({
            id: storyDoc.id,
            storyId: storyDoc.id,
            title: story.metadata?.title || 'Untitled Story',
            childId: story.childId,
            deletedAt: story.deletedAt,
            deletedBy: story.deletedBy || '',
            isNewModel: false,
          });
        }
      }

      // Also check storybooks subcollections for new model
      // Note: This requires iterating through stories, which is expensive
      // For a full implementation, consider using a Cloud Function to maintain a deleted items collection
      const allStoriesQuery = query(collection(firestore, 'stories'));
      const allStoriesSnap = await getDocs(allStoriesQuery);

      for (const storyDoc of allStoriesSnap.docs) {
        try {
          const storybooksRef = collection(firestore, 'stories', storyDoc.id, 'storybooks');
          const deletedStorybooksQuery = query(
            storybooksRef,
            where('deletedAt', '!=', null)
          );
          const storybooksSnap = await getDocs(deletedStorybooksQuery);

          for (const sbDoc of storybooksSnap.docs) {
            const sb = sbDoc.data() as StoryBookOutput & { deletedAt?: any; deletedBy?: string };
            if (sb.deletedAt) {
              storybooks.push({
                id: sbDoc.id,
                storyId: storyDoc.id,
                title: sb.title || 'Untitled Storybook',
                childId: (storyDoc.data() as Story).childId,
                deletedAt: sb.deletedAt,
                deletedBy: sb.deletedBy || '',
                isNewModel: true,
              });
            }
          }
        } catch (err) {
          // Subcollection may not exist
          console.error('Error loading storybooks for story:', storyDoc.id, err);
        }
      }

      setDeletedStorybooks(storybooks);
    } catch (err) {
      console.error('Error loading deleted items:', err);
      toast({
        title: 'Error loading deleted items',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [firestore, toast]);

  useEffect(() => {
    if (firestore && isAdmin) {
      loadDeletedItems();
    }
  }, [firestore, isAdmin, loadDeletedItems]);

  // Restore handlers
  const handleRestoreChild = useCallback(
    async (child: DeletedChild) => {
      if (!firestore) return;

      setRestoringChildId(child.id);
      try {
        const docRef = doc(firestore, 'children', child.id);
        await updateDoc(docRef, {
          deletedAt: deleteField(),
          deletedBy: deleteField(),
          updatedAt: serverTimestamp(),
        });

        setDeletedChildren((prev) => prev.filter((c) => c.id !== child.id));
        toast({ title: 'Child profile restored', description: `${child.displayName} has been restored.` });
      } catch (err: any) {
        toast({
          title: 'Error restoring child',
          description: err.message || 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setRestoringChildId(null);
      }
    },
    [firestore, toast]
  );

  const handleRestoreCharacter = useCallback(
    async (character: DeletedCharacter) => {
      if (!firestore) return;

      setRestoringCharacterId(character.id);
      try {
        const docRef = doc(firestore, 'characters', character.id);
        await updateDoc(docRef, {
          deletedAt: deleteField(),
          deletedBy: deleteField(),
          updatedAt: serverTimestamp(),
        });

        setDeletedCharacters((prev) => prev.filter((c) => c.id !== character.id));
        toast({ title: 'Character restored', description: `${character.displayName} has been restored.` });
      } catch (err: any) {
        toast({
          title: 'Error restoring character',
          description: err.message || 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setRestoringCharacterId(null);
      }
    },
    [firestore, toast]
  );

  const handleRestoreStorybook = useCallback(
    async (storybook: DeletedStorybook) => {
      if (!firestore) return;

      setRestoringStorybookId(storybook.id);
      try {
        const docPath = storybook.isNewModel
          ? `stories/${storybook.storyId}/storybooks/${storybook.id}`
          : `stories/${storybook.storyId}`;

        const docRef = doc(firestore, docPath);
        await updateDoc(docRef, {
          deletedAt: deleteField(),
          deletedBy: deleteField(),
          updatedAt: serverTimestamp(),
        });

        setDeletedStorybooks((prev) => prev.filter((s) => s.id !== storybook.id));
        toast({ title: 'Storybook restored', description: `${storybook.title} has been restored.` });
      } catch (err: any) {
        toast({
          title: 'Error restoring storybook',
          description: err.message || 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setRestoringStorybookId(null);
      }
    },
    [firestore, toast]
  );

  const totalDeleted = deletedChildren.length + deletedCharacters.length + deletedStorybooks.length;

  if (adminLoading) {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">You must be an admin to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Deleted Items</h1>
          <p className="text-muted-foreground">
            {loading
              ? 'Loading...'
              : `${totalDeleted} ${totalDeleted === 1 ? 'item' : 'items'} waiting for restoration`}
          </p>
        </div>
        <Button variant="outline" onClick={loadDeletedItems} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      ) : totalDeleted === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Trash2 className="h-12 w-12 text-muted-foreground opacity-50" />
            <div className="text-center">
              <p className="font-medium">No deleted items</p>
              <p className="text-muted-foreground">
                Items deleted by parents will appear here for restoration.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DeletedSection
              title="Deleted Children"
              icon={User}
              items={deletedChildren}
              type="child"
              onRestore={handleRestoreChild}
              restoringId={restoringChildId}
              getItemDetails={(child) => ({
                id: child.id,
                name: child.displayName,
                avatarUrl: child.avatarUrl,
                deletedAt: child.deletedAt,
                deletedBy: child.deletedBy,
              })}
            />

            <DeletedSection
              title="Deleted Characters"
              icon={Smile}
              items={deletedCharacters}
              type="character"
              onRestore={handleRestoreCharacter}
              restoringId={restoringCharacterId}
              getItemDetails={(character) => ({
                id: character.id,
                name: character.displayName,
                avatarUrl: character.avatarUrl,
                deletedAt: character.deletedAt,
                deletedBy: character.deletedBy,
              })}
            />

            <DeletedSection
              title="Deleted Storybooks"
              icon={BookOpen}
              items={deletedStorybooks}
              type="storybook"
              onRestore={handleRestoreStorybook}
              restoringId={restoringStorybookId}
              getItemDetails={(storybook) => ({
                id: storybook.id,
                name: storybook.title || 'Untitled Storybook',
                deletedAt: storybook.deletedAt,
                deletedBy: storybook.deletedBy,
              })}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
