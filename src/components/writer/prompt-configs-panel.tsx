'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoaderCircle, Plus, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { useFirestore } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { PromptConfig } from '@/lib/types';
import { api } from '@/lib/api';
import { PromptConfigForm } from './shared';

// Prompt Configs Panel
export function PromptConfigsPanel() {
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
    modelName: 'gemini-3.8-flash',
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
      modelName: config.model?.name || 'gemini-3.8-flash',
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
    };
    try {
      if (form.id) {
        await api.catalog.admin.set('promptConfigs', form.id, payload, { merge: true });
      } else {
        await api.catalog.admin.create('promptConfigs', {
          ...payload,
          status: payload.status || 'draft',
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Control the AI system prompts per phase and level band.</p>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" /> New Prompt Config
        </Button>
      </div>
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
    </div>
  );
}
