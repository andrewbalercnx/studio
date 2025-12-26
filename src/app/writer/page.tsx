
'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { collection, doc, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StoryPhase, PromptConfig, StoryOutputType } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, ExternalLink } from 'lucide-react';
import Link from 'next/link';

// StoryTypesPanel - Now redirects to /admin/storyTypes which has the full editor with promptConfig
function StoryTypesPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Story Types</CardTitle>
        <CardDescription>Arc templates, prompt configuration, and metadata for the story catalog.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">
            Story Types are now managed in the Admin section with the full Prompt Config editor.
          </p>
          <Button asChild>
            <Link href="/admin/storyTypes">
              <ExternalLink className="mr-2 h-4 w-4" /> Open Story Types Editor
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type StoryPhaseForm = {
  id?: string;
  name: string;
  description: string;
  phaseType: 'warmup' | 'storyBeat' | 'ending';
  choiceCount: string;
  allowMore: boolean;
  orderIndex: string;
  status: 'draft' | 'live';
};

type PromptConfigForm = {
  id?: string;
  phase: string;
  levelBand: string;
  status: 'draft' | 'live';
  languageCode: string;
  version: string;
  systemPrompt: string;
  modeInstructions: string;
  allowedChatMoves: string;
  modelName: string;
  modelTemperature: string;
};

type StoryOutputForm = {
  id?: string;
  name: string;
  shortDescription: string;
  ageRange: string;
  childFacingLabel: string;
  category: 'picture_book' | 'poem' | 'coloring_pages' | 'audio_script';
  status: 'draft' | 'live' | 'archived';
  pageCount: string;
};

export default function StoryEditorWorkspace() {
  return (
    <div className="container mx-auto px-4 py-6 sm:py-10">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Story Editor</CardTitle>
          <CardDescription>Manage the creative building blocks for StoryPic.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Writers can add or edit story types, phases, prompt configs, and output templates without touching the admin console. Changes save directly to Firestore.
        </CardContent>
      </Card>

      <Tabs defaultValue="types" className="space-y-4">
        <TabsList>
          <TabsTrigger value="types">Story Types</TabsTrigger>
          <TabsTrigger value="phases">Story Phases</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Configs</TabsTrigger>
          <TabsTrigger value="outputs">Output Types</TabsTrigger>
        </TabsList>
        <TabsContent value="types">
          <StoryTypesPanel />
        </TabsContent>
        <TabsContent value="phases">
          <StoryPhasesPanel />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptConfigsPanel />
        </TabsContent>
        <TabsContent value="outputs">
          <StoryOutputsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StoryPhasesPanel() {
  const firestore = useFirestore();
  const phasesQuery = useMemo(() => (firestore ? collection(firestore, 'storyPhases') : null), [firestore]);
  const { data: phases, loading } = useCollection<StoryPhase>(phasesQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const defaultForm: StoryPhaseForm = {
    name: '',
    description: '',
    phaseType: 'storyBeat',
    choiceCount: '0',
    allowMore: false,
    orderIndex: '0',
    status: 'draft',
  };
  const [form, setForm] = useState<StoryPhaseForm>(defaultForm);

  const openCreate = () => {
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (phase: StoryPhase) => {
    setForm({
      id: phase.id,
      name: phase.name,
      description: phase.description || '',
      phaseType: phase.phaseType,
      choiceCount: String(phase.choiceCount ?? 0),
      allowMore: !!phase.allowMore,
      orderIndex: String(phase.orderIndex ?? 0),
      status: phase.status || 'draft',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!form.name) {
      toast({ title: 'Missing name', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    const payload = {
      name: form.name,
      description: form.description,
      phaseType: form.phaseType,
      choiceCount: Number(form.choiceCount) || 0,
      allowMore: form.allowMore,
      orderIndex: Number(form.orderIndex) || 0,
      status: form.status,
      updatedAt: serverTimestamp(),
    };

    try {
      if (form.id) {
        await setDoc(doc(firestore, 'storyPhases', form.id), payload, { merge: true });
      } else {
        await addDoc(collection(firestore, 'storyPhases'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: 'Story phase saved' });
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error saving phase', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Story Phases</CardTitle>
          <CardDescription>Configure each step of the story engine.</CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Phase
        </Button>
      </CardHeader>
      <CardContent>
        {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {!loading && phases && phases.length === 0 && <p className="text-sm text-muted-foreground">No phases yet.</p>}
        {!loading && phases && phases.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Choices</TableHead>
                <TableHead>Allow More</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {phases.map((phase) => (
                <TableRow key={phase.id}>
                  <TableCell className="font-medium">{phase.name}</TableCell>
                  <TableCell className="capitalize">{phase.phaseType}</TableCell>
                  <TableCell>{phase.choiceCount}</TableCell>
                  <TableCell>{phase.allowMore ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{phase.orderIndex}</TableCell>
                  <TableCell className="capitalize">{phase.status}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(phase)}>
                      <Edit className="mr-1 h-4 w-4" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Story Phase' : 'New Story Phase'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Phase Type</Label>
                <Select value={form.phaseType} onValueChange={(value) => setForm({ ...form, phaseType: value as StoryPhaseForm['phaseType'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warmup">Warmup</SelectItem>
                    <SelectItem value="storyBeat">Story Beat</SelectItem>
                    <SelectItem value="ending">Ending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as StoryPhaseForm['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Choice Count</Label>
                <Input type="number" value={form.choiceCount} onChange={(e) => setForm({ ...form, choiceCount: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Order Index</Label>
                <Input type="number" value={form.orderIndex} onChange={(e) => setForm({ ...form, orderIndex: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Allow "More Options"</Label>
                <p className="text-xs text-muted-foreground">Permits the user to request additional beats.</p>
              </div>
              <Switch checked={form.allowMore} onCheckedChange={(value) => setForm({ ...form, allowMore: value })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Phase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PromptConfigsPanel() {
  const firestore = useFirestore();
  const promptsQuery = useMemo(() => (firestore ? collection(firestore, 'promptConfigs') : null), [firestore]);
  const { data: prompts, loading } = useCollection<PromptConfig>(promptsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const defaultForm: PromptConfigForm = {
    phase: '',
    levelBand: '',
    status: 'draft',
    languageCode: 'en-US',
    version: '1',
    systemPrompt: '',
    modeInstructions: '',
    allowedChatMoves: '',
    modelName: 'gemini-1.5-pro',
    modelTemperature: '0.6',
  };
  const [form, setForm] = useState<PromptConfigForm>(defaultForm);

  const openCreate = () => {
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (config: PromptConfig) => {
    setForm({
      id: config.id,
      phase: config.phase || '',
      levelBand: config.levelBand || '',
      status: (config.status as PromptConfigForm['status']) || 'draft',
      languageCode: config.languageCode || 'en-US',
      version: String(config.version ?? 1),
      systemPrompt: config.systemPrompt || '',
      modeInstructions: config.modeInstructions || '',
      allowedChatMoves: config.allowedChatMoves?.join(', ') || '',
      modelName: config.model?.name || 'gemini-1.5-pro',
      modelTemperature: String(config.model?.temperature ?? 0.6),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!form.phase || !form.levelBand || !form.systemPrompt) {
      toast({ title: 'Missing required fields', description: 'Phase, level band, and system prompt are required.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    const payload = {
      phase: form.phase,
      levelBand: form.levelBand,
      status: form.status,
      languageCode: form.languageCode,
      version: Number(form.version) || 1,
      systemPrompt: form.systemPrompt,
      modeInstructions: form.modeInstructions,
      allowedChatMoves: form.allowedChatMoves
        .split(',')
        .map((move) => move.trim())
        .filter(Boolean),
      model: {
        name: form.modelName,
        temperature: Number(form.modelTemperature) || 0,
      },
      updatedAt: serverTimestamp(),
    };
    try {
      if (form.id) {
        await setDoc(doc(firestore, 'promptConfigs', form.id), payload, { merge: true });
      } else {
        await addDoc(collection(firestore, 'promptConfigs'), {
          ...payload,
          status: payload.status || 'draft',
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: 'Prompt config saved' });
      setDialogOpen(false);
    } catch (error: any) {
      toast({ title: 'Error saving config', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Prompt Configs</CardTitle>
          <CardDescription>Control the AI system prompts per phase and level band.</CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Prompt Config
        </Button>
      </CardHeader>
      <CardContent>
        {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {!loading && prompts && prompts.length === 0 && <p className="text-sm text-muted-foreground">No prompt configs yet.</p>}
        {!loading && prompts && prompts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phase</TableHead>
                <TableHead>Level Band</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prompts.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="capitalize">{config.phase}</TableCell>
                  <TableCell>{config.levelBand}</TableCell>
                  <TableCell className="capitalize">{config.status}</TableCell>
                  <TableCell>{config.model?.name || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(config)}>
                      <Edit className="mr-1 h-4 w-4" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Prompt Config' : 'New Prompt Config'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Phase</Label>
                <Input value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} placeholder="warmup / storyBeat / ending" />
              </div>
              <div className="grid gap-2">
                <Label>Level Band</Label>
                <Input value={form.levelBand} onChange={(e) => setForm({ ...form, levelBand: e.target.value })} placeholder="low / mid / high" />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as PromptConfigForm['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Language Code</Label>
                <Input value={form.languageCode} onChange={(e) => setForm({ ...form, languageCode: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Version</Label>
                <Input type="number" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Allowed Chat Moves (comma separated)</Label>
                <Input value={form.allowedChatMoves} onChange={(e) => setForm({ ...form, allowedChatMoves: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Model Name</Label>
                <Input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Model Temperature</Label>
                <Input type="number" step="0.1" value={form.modelTemperature} onChange={(e) => setForm({ ...form, modelTemperature: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>System Prompt</Label>
              <Textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={5} />
            </div>
            <div className="grid gap-2">
              <Label>Mode Instructions</Label>
              <Textarea value={form.modeInstructions} onChange={(e) => setForm({ ...form, modeInstructions: e.target.value })} rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Prompt Config
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StoryOutputsPanel() {
  const firestore = useFirestore();
  const outputsQuery = useMemo(() => (firestore ? collection(firestore, 'storyOutputTypes') : null), [firestore]);
  const { data: outputs, loading } = useCollection<StoryOutputType>(outputsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const defaultForm: StoryOutputForm = {
    name: '',
    shortDescription: '',
    ageRange: '',
    childFacingLabel: '',
    category: 'picture_book',
    status: 'draft',
    pageCount: '8',
  };
  const [form, setForm] = useState<StoryOutputForm>(defaultForm);

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
      pageCount: String(output.layoutHints?.pageCount ?? '8'),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!firestore) return;
    if (!form.name) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    const payload = {
      name: form.name,
      shortDescription: form.shortDescription,
      ageRange: form.ageRange,
      childFacingLabel: form.childFacingLabel,
      category: form.category,
      status: form.status,
      layoutHints: {
        pageCount: Number(form.pageCount) || 8,
      },
      updatedAt: serverTimestamp(),
    };
    try {
      if (form.id) {
        await setDoc(doc(firestore, 'storyOutputTypes', form.id), payload, { merge: true });
      } else {
        await addDoc(collection(firestore, 'storyOutputTypes'), {
          ...payload,
          createdAt: serverTimestamp(),
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Story Output Types</CardTitle>
          <CardDescription>Define the final deliverables offered to families.</CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Output Type
        </Button>
      </CardHeader>
      <CardContent>
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
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
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
                <Input type="number" value={form.pageCount} onChange={(e) => setForm({ ...form, pageCount: e.target.value })} placeholder="e.g. 8" />
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
    </Card>
  );
}
