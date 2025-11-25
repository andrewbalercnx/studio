
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, PlusCircle } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, query, orderBy, writeBatch, serverTimestamp, getDocs } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { StoryOutputType } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const sampleOutputTypes: Omit<StoryOutputType, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
        name: "Picture Book (Classic)",
        status: "live",
        ageRange: "3-5",
        shortDescription: "A standard 8-page landscape book with simple prose.",
        childFacingLabel: "A little picture book about your day",
        category: "picture_book",
        layoutHints: {
            pageCount: 8,
            needsImages: true,
            preferredAspectRatio: "landscape",
            textDensity: "low"
        },
        aiHints: {
            style: "gentle, simple picture-book prose",
        },
        tags: ["book", "classic"]
    },
    {
        name: "Bedtime Poem",
        status: "live",
        ageRange: "3-5",
        shortDescription: "A single page, soothing rhyming poem.",
        childFacingLabel: "A sleepy-time poem",
        category: "poem",
        layoutHints: {
            pageCount: 1,
            needsImages: false,
        },
        aiHints: {
            style: "soft, soothing rhyming poem",
            allowRhyme: true,
        },
        tags: ["poem", "short", "bedtime"]
    },
    {
        name: "Coloring Pages",
        status: "draft",
        ageRange: "3-5",
        shortDescription: "A set of simple scenes with clear outlines for coloring.",
        childFacingLabel: "Your own coloring pages",
        category: "coloring_pages",
        layoutHints: {
            pageCount: 4,
            needsImages: true,
        },
        aiHints: {
            style: "very simple scenes with clear outlines, black and white only"
        },
        tags: ["coloring", "activity"]
    }
];

const sampleIds = ["picture_book_standard_v1", "bedtime_poem_v1", "coloring_pages_v1"];

const outputTypeSchema = z.object({
  name: z.string().min(3, "Name is required"),
  childFacingLabel: z.string().min(3, "Child-facing label is required"),
  shortDescription: z.string().min(10, "Description is required"),
  ageRange: z.string(),
  category: z.enum(["picture_book", "poem", "coloring_pages", "audio_script"]),
  status: z.enum(["live", "draft", "archived"]),
  'layoutHints.pageCount': z.coerce.number().optional(),
  'layoutHints.needsImages': z.boolean().optional(),
  'aiHints.style': z.string().optional(),
});


type OutputTypeFormValues = z.infer<typeof outputTypeSchema>;

function OutputTypeForm({ editingType, onSave, onOpenChange }: { editingType?: StoryOutputType | null, onSave: () => void, onOpenChange: (open: boolean) => void }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);

    const { register, handleSubmit, control, formState: { errors } } = useForm<OutputTypeFormValues>({
        resolver: zodResolver(outputTypeSchema),
        defaultValues: {
            name: editingType?.name || '',
            childFacingLabel: editingType?.childFacingLabel || '',
            shortDescription: editingType?.shortDescription || '',
            ageRange: editingType?.ageRange || '3-5',
            category: editingType?.category || 'picture_book',
            status: editingType?.status || 'draft',
            'layoutHints.pageCount': editingType?.layoutHints?.pageCount,
            'layoutHints.needsImages': editingType?.layoutHints?.needsImages ?? true,
            'aiHints.style': editingType?.aiHints?.style || '',
        }
    });

    const onSubmit = async (data: OutputTypeFormValues) => {
        if (!firestore) return;
        setIsSaving(true);
        
        const docData: Partial<StoryOutputType> = {
            name: data.name,
            childFacingLabel: data.childFacingLabel,
            shortDescription: data.shortDescription,
            ageRange: data.ageRange,
            category: data.category,
            status: data.status,
            layoutHints: {
                pageCount: data['layoutHints.pageCount'],
                needsImages: data['layoutHints.needsImages'],
            },
            aiHints: {
                style: data['aiHints.style'],
            },
            updatedAt: serverTimestamp(),
        };

        try {
            if (editingType) {
                const docRef = doc(firestore, 'storyOutputTypes', editingType.id);
                await writeBatch(firestore).update(docRef, docData).commit();
                toast({ title: 'Success', description: 'Output type updated.' });
            } else {
                const id = `${slugify(data.name)}_v1`;
                docData.createdAt = serverTimestamp();
                docData.tags = [data.category]; // default tag
                const docRef = doc(firestore, 'storyOutputTypes', id);
                await writeBatch(firestore).set(docRef, docData, { merge: true }).commit();
                toast({ title: 'Success', description: 'New output type created.' });
            }
            onSave();
            onOpenChange(false);
        } catch (e: any) {
            toast({ title: 'Error saving', description: e.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
                <Label htmlFor="name">Name (for admins)</Label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <Label>Category</Label>
                    <Controller name="category" control={control} render={({ field }) => (
                         <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="picture_book">Picture Book</SelectItem>
                                <SelectItem value="poem">Poem</SelectItem>
                                <SelectItem value="coloring_pages">Coloring Pages</SelectItem>
                                <SelectItem value="audio_script">Audio Script</SelectItem>
                            </SelectContent>
                        </Select>
                    )} />
                </div>
                 <div className="space-y-1">
                    <Label>Status</Label>
                    <Controller name="status" control={control} render={({ field }) => (
                         <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="live">Live</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                    )} />
                </div>
            </div>

             <div className="space-y-1">
                <Label htmlFor="shortDescription">About this output</Label>
                <Textarea id="shortDescription" {...register('shortDescription')} />
                {errors.shortDescription && <p className="text-xs text-destructive">{errors.shortDescription.message}</p>}
            </div>

            <Card>
                <CardHeader><CardTitle className="text-base">Advanced Hints</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Label>Page Count</Label>
                        <Input type="number" {...register('layoutHints.pageCount')} />
                    </div>
                     <div className="flex items-center space-x-2">
                        <Controller name="layoutHints.needsImages" control={control} render={({ field }) => (
                           <Checkbox id="needsImages" checked={field.value} onCheckedChange={field.onChange} />
                        )} />
                        <Label htmlFor="needsImages">Needs Images?</Label>
                    </div>
                     <div className="space-y-1">
                        <Label>AI Style Notes</Label>
                        <Input {...register('aiHints.style')} placeholder="e.g. gentle, simple picture-book prose" />
                    </div>
                </CardContent>
            </Card>

            <Button type="submit" disabled={isSaving}>
                {isSaving ? <><LoaderCircle className="animate-spin mr-2"/> Saving...</> : 'Save Output Type'}
            </Button>
        </form>
    )
}

export default function AdminStoryOutputsPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [outputTypes, setOutputTypes] = useState<StoryOutputType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingType, setEditingType] = useState<StoryOutputType | null>(null);

  const handleCreateSampleData = useCallback(async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        sampleOutputTypes.forEach((type, index) => {
            const docRef = doc(firestore, "storyOutputTypes", sampleIds[index]);
            batch.set(docRef, { ...type, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        });
        await batch.commit();
        toast({ title: 'Success', description: 'Sample output types created.' });
    } catch (e: any) {
        console.error('Error seeding data:', e);
        toast({ title: 'Error Seeding Data', description: e.message, variant: 'destructive' });
    }
  }, [firestore, toast]);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const outputsRef = collection(firestore, 'storyOutputTypes');
    const q = query(outputsRef, orderBy('category'), orderBy('name'));
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        if (snapshot.empty && !loading) {
            handleCreateSampleData();
        }
        setOutputTypes(snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as StoryOutputType));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError("Could not fetch story output types.");
        setLoading(false);
        console.error("Firestore onSnapshot error:", err);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, handleCreateSampleData, loading]);
  
  const handleAddNew = () => {
      setEditingType(null);
      setIsFormOpen(true);
  }

  const handleEdit = (type: StoryOutputType) => {
      setEditingType(type);
      setIsFormOpen(true);
  }

  const diagnostics = {
    page: 'admin-storyOutputs',
    auth: { isAuthenticated, email: null, isAdmin, loading: authLoading, error: null },
    firestore: {
        collection: 'storyOutputTypes',
        count: outputTypes.length,
        sampleIds: outputTypes.slice(0, 3).map(o => o.id),
    },
    ...(error ? { firestoreError: error } : {})
  };

  const renderContent = () => {
    if (authLoading || loading) return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading output types...</span></div>;
    if (!isAuthenticated || !isAdmin) return <p>Admin access required.</p>;
    if (error) return <p className="text-destructive">{error}</p>;

    if (outputTypes.length === 0 && !loading) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No output types found. Seeding initial data...</p>
                <LoaderCircle className="h-8 w-8 animate-spin mx-auto" />
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {outputTypes.map((type) => (
                <Card key={type.id} className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center">
                            <span>{type.name}</span>
                            <Badge variant={type.status === 'live' ? 'default' : 'secondary'}>{type.status}</Badge>
                        </CardTitle>
                        <CardDescription>{type.ageRange} / {type.category}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow">
                        <p className="text-sm text-muted-foreground">{type.shortDescription}</p>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                         <div className="flex flex-wrap gap-1">
                            {type.tags?.map(tag => <Badge key={tag} variant="outline">{tag}</Badge>)}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(type)}>Edit</Button>
                    </CardFooter>
                </Card>
            ))}
        </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Story Output Types</h1>
                    <p className="text-muted-foreground">Manage the final products the app can create.</p>
                </div>
                <Button onClick={handleAddNew}><PlusCircle className="mr-2"/> Add New</Button>
            </div>

            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{editingType ? 'Edit Output Type' : 'Add New Output Type'}</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                   <OutputTypeForm editingType={editingType} onSave={() => {}} onOpenChange={setIsFormOpen} />
                </div>
            </DialogContent>
        </Dialog>
      
      {renderContent()}

      <Card className="mt-8">
        <CardHeader><CardTitle>Diagnostics</CardTitle></CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
