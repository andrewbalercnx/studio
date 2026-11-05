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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useFirestore } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StoryPhase } from '@/lib/types';
import { api } from '@/lib/api';
import { StoryPhaseForm } from './shared';

// Story Phases Panel
export function StoryPhasesPanel() {
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
    };

    try {
      if (form.id) {
        await api.catalog.admin.set('storyPhases', form.id, payload, { merge: true });
      } else {
        await api.catalog.admin.create('storyPhases', {
          ...payload,
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Configure each step of the story engine.</p>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" /> New Phase
        </Button>
      </div>
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
    </div>
  );
}
