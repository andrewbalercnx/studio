'use client';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoaderCircle, Plus, Edit, Sparkles, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { collection, getDocs } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StoryOutputType, PrintLayout } from '@/lib/types';
import { api } from '@/lib/api';
import { StoryOutputForm } from './shared';

// Story Outputs Panel
export function StoryOutputsPanel() {
  const firestore = useFirestore();
  const { user } = useUser();
  const outputsQuery = useMemo(() => (firestore ? collection(firestore, 'storyOutputTypes') : null), [firestore]);
  const { data: outputs, loading } = useCollection<StoryOutputType>(outputsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [printLayouts, setPrintLayouts] = useState<PrintLayout[]>([]);
  const [loadingLayouts, setLoadingLayouts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const defaultForm: StoryOutputForm = {
    name: '',
    shortDescription: '',
    ageRange: '',
    childFacingLabel: '',
    category: 'picture_book',
    status: 'draft',
    pageCount: '',
    imagePrompt: '',
    defaultPrintLayoutId: '',
    paginationPrompt: '',
  };
  const [form, setForm] = useState<StoryOutputForm>(defaultForm);

  // Load print layouts when dialog opens
  useEffect(() => {
    if (!dialogOpen || !firestore) return;
    setLoadingLayouts(true);
    getDocs(collection(firestore, 'printLayouts'))
      .then((snapshot) => {
        const layouts = snapshot.docs.map(d => ({ ...d.data(), id: d.id }) as PrintLayout);
        setPrintLayouts(layouts);
      })
      .catch((err) => {
        console.error('Error loading print layouts:', err);
      })
      .finally(() => setLoadingLayouts(false));
  }, [dialogOpen, firestore]);

  const openCreate = () => {
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (output: StoryOutputType) => {
    setForm({
      id: output.id,
      name: output.name,
      shortDescription: output.shortDescription || '',
      ageRange: output.ageRange || '',
      childFacingLabel: output.childFacingLabel || '',
      category: output.category,
      status: output.status || 'draft',
      pageCount: output.layoutHints?.pageCount ? String(output.layoutHints.pageCount) : '',
      imagePrompt: output.imagePrompt || '',
      defaultPrintLayoutId: output.defaultPrintLayoutId || '',
      paginationPrompt: output.paginationPrompt || '',
      imageUrl: output.imageUrl,
    });
    setDialogOpen(true);
  };

  const handleGenerateImage = async () => {
    if (!user || !form.id) {
      toast({ title: 'Error', description: 'Please save the output type first', variant: 'destructive' });
      return;
    }
    if (!form.imagePrompt) {
      toast({ title: 'Error', description: 'Please enter an image prompt first', variant: 'destructive' });
      return;
    }

    setIsGeneratingImage(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/storyOutputTypes/generateImage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ storyOutputTypeId: form.id }),
      });
      const result = await response.json();
      if (result.ok) {
        toast({ title: 'Success', description: 'Image generated successfully!' });
        if (result.imageUrl) {
          setForm(prev => ({ ...prev, imageUrl: result.imageUrl }));
        }
      } else {
        toast({ title: 'Error', description: result.errorMessage, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user || !form.id) {
      if (!form.id) {
        toast({ title: 'Error', description: 'Please save the output type first', variant: 'destructive' });
      }
      return;
    }

    // Clear the input so same file can be selected again
    event.target.value = '';

    setIsUploadingImage(true);
    try {
      // Convert file to data URL
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const token = await user.getIdToken();
      const response = await fetch('/api/storyOutputTypes/uploadImage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          storyOutputTypeId: form.id,
          dataUrl,
          fileName: file.name,
        }),
      });

      const result = await response.json();
      if (result.ok) {
        toast({ title: 'Success', description: 'Image uploaded successfully!' });
        if (result.imageUrl) {
          setForm(prev => ({ ...prev, imageUrl: result.imageUrl }));
        }
      } else {
        toast({ title: 'Error', description: result.errorMessage, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!form.name) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    // Parse page count - allow blank for unconstrained pagination
    const pageCountNum = form.pageCount ? Number(form.pageCount) : undefined;
    const payload: Record<string, any> = {
      name: form.name,
      shortDescription: form.shortDescription,
      ageRange: form.ageRange,
      childFacingLabel: form.childFacingLabel,
      category: form.category,
      status: form.status,
      layoutHints: {
        ...(pageCountNum !== undefined ? { pageCount: pageCountNum } : {}),
      },
    };
    // Handle optional fields - set to empty string or include value
    payload.imagePrompt = form.imagePrompt || '';
    payload.defaultPrintLayoutId = form.defaultPrintLayoutId || '';
    payload.paginationPrompt = form.paginationPrompt || '';

    try {
      if (form.id) {
        await api.catalog.admin.set('storyOutputTypes', form.id, payload, { merge: true });
      } else {
        await api.catalog.admin.create('storyOutputTypes', {
          ...payload,
        });
      }
      toast({ title: 'Output type saved' });
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error saving output type', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Define the final deliverables offered to families.</p>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" /> New Output Type
        </Button>
      </div>
      {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
      {!loading && outputs && outputs.length === 0 && <p className="text-sm text-muted-foreground">No output types yet.</p>}
      {!loading && outputs && outputs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Age Range</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outputs.map((output) => (
              <TableRow key={output.id}>
                <TableCell className="font-medium">{output.name}</TableCell>
                <TableCell className="capitalize">{output.category.replace('_', ' ')}</TableCell>
                <TableCell>{output.ageRange}</TableCell>
                <TableCell className="capitalize">{output.status}</TableCell>
                <TableCell>{output.layoutHints?.pageCount ?? '?'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(output)}>
                    <Edit className="mr-1 h-4 w-4" /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Output Type' : 'New Output Type'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Short Description</Label>
              <Textarea value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} rows={2} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Age Range</Label>
                <Input value={form.ageRange} onChange={(e) => setForm({ ...form, ageRange: e.target.value })} placeholder="3-5" />
              </div>
              <div className="grid gap-2">
                <Label>Child-facing Label</Label>
                <Input value={form.childFacingLabel} onChange={(e) => setForm({ ...form, childFacingLabel: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value as StoryOutputForm['category'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="picture_book">Picture Book</SelectItem>
                    <SelectItem value="poem">Poem</SelectItem>
                    <SelectItem value="coloring_pages">Coloring Pages</SelectItem>
                    <SelectItem value="audio_script">Audio Script</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as StoryOutputForm['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
                <Label>Page Count</Label>
                <Input type="number" value={form.pageCount} onChange={(e) => setForm({ ...form, pageCount: e.target.value })} placeholder="Leave blank for unconstrained" />
                <p className="text-xs text-muted-foreground">Optional: Leave blank to allow AI to determine page count</p>
            </div>
            <div className="grid gap-2">
                <Label>Image Prompt</Label>
                <Textarea
                  value={form.imagePrompt}
                  onChange={(e) => setForm({ ...form, imagePrompt: e.target.value })}
                  rows={2}
                  placeholder="Describe the image that will represent this output type to children"
                />
                {form.imageUrl && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Current image:</p>
                    <img src={form.imageUrl} alt="Current" className="w-24 h-24 rounded-md object-cover border" />
                  </div>
                )}
                {/* Hidden file input for upload */}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                <div className="flex gap-2 mt-2">
                  {form.id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleUploadClick}
                      disabled={isUploadingImage}
                    >
                      {isUploadingImage ? (
                        <><LoaderCircle className="h-4 w-4 animate-spin mr-2" /> Uploading...</>
                      ) : (
                        <><Upload className="h-4 w-4 mr-2" /> Upload Image</>
                      )}
                    </Button>
                  )}
                  {form.id && form.imagePrompt && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateImage}
                      disabled={isGeneratingImage}
                    >
                      {isGeneratingImage ? (
                        <><LoaderCircle className="h-4 w-4 animate-spin mr-2" /> Generating...</>
                      ) : (
                        <><Sparkles className="h-4 w-4 mr-2" /> {form.imageUrl ? 'Regenerate' : 'Generate'}</>
                      )}
                    </Button>
                  )}
                </div>
                {!form.id && (
                  <p className="text-xs text-muted-foreground">Save first to upload or generate an image</p>
                )}
            </div>
            <div className="grid gap-2">
                <Label>Default Print Layout</Label>
                <Select
                  value={form.defaultPrintLayoutId || '__none__'}
                  onValueChange={(value) => setForm({ ...form, defaultPrintLayoutId: value === '__none__' ? '' : value })}
                  disabled={loadingLayouts}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingLayouts ? 'Loading layouts...' : 'No layout (unconstrained)'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No layout (unconstrained)</SelectItem>
                    {printLayouts.map((layout) => (
                      <SelectItem key={layout.id} value={layout.id}>
                        {layout.name} ({layout.leafWidth}&quot; × {layout.leafHeight}&quot;)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Optional: Constrains image dimensions for this output type</p>
            </div>
            <div className="grid gap-2">
                <Label>Pagination Prompt</Label>
                <Textarea
                  value={form.paginationPrompt}
                  onChange={(e) => setForm({ ...form, paginationPrompt: e.target.value })}
                  rows={4}
                  placeholder="e.g., This is a rhyming poem - preserve the rhyme scheme when splitting across pages"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">Optional: Type-specific instructions prepended to the global pagination prompt</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Output Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
