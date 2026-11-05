'use client';
import { Card, CardContent } from '@/components/ui/card';
import { LoaderCircle, ChevronDown, ChevronUp, Trash2, Plus, GripVertical, Pencil, X, Check } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { StoryType, ArcStep } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeArcSteps } from './shared';

// Arc Step Editor Component
export function ArcStepEditor({
  storyType,
  onSave,
  onDirtyChange
}: {
  storyType: StoryType;
  onSave: (steps: ArcStep[]) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const rawSteps = storyType.arcTemplate?.steps ?? [];
  const [steps, setSteps] = useState<ArcStep[]>(normalizeArcSteps(rawSteps));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ArcStep>({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newStep, setNewStep] = useState<ArcStep>({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  const [saving, setSaving] = useState(false);

  const hasChanges = JSON.stringify(normalizeArcSteps(rawSteps)) !== JSON.stringify(steps);

  // Notify parent of dirty state changes (only when hasChanges actually changes)
  const prevHasChanges = useRef(hasChanges);
  useEffect(() => {
    if (prevHasChanges.current !== hasChanges) {
      prevHasChanges.current = hasChanges;
      onDirtyChange?.(hasChanges);
    }
  }, [hasChanges, onDirtyChange]);

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newSteps = [...steps];
    [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
    setSteps(newSteps);
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const newSteps = [...steps];
    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
    setSteps(newSteps);
  };

  const handleDelete = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    setSteps(newSteps);
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditForm({ ...steps[index] });
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditForm({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  };

  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    const newSteps = [...steps];
    newSteps[editingIndex] = { ...editForm };
    setSteps(newSteps);
    setEditingIndex(null);
    setEditForm({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
  };

  const handleAddNew = () => {
    if (!newStep.id || !newStep.label) return;
    setSteps([...steps, { ...newStep }]);
    setNewStep({ id: '', label: '', guidance: '', suggestsNewCharacter: false });
    setIsAddingNew(false);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await onSave(steps);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Arc Steps ({steps.length})</h4>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingNew(true)}
            disabled={isAddingNew}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Step
          </Button>
          {hasChanges && (
            <Button
              size="sm"
              onClick={handleSaveAll}
              disabled={saving}
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {/* Add New Step Form */}
      {isAddingNew && (
        <Card className="border-dashed border-2 border-primary/50">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-id">Step ID</Label>
                <Input
                  id="new-id"
                  placeholder="e.g., introduce_character"
                  value={newStep.id}
                  onChange={(e) => setNewStep({ ...newStep, id: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                />
              </div>
              <div>
                <Label htmlFor="new-label">Label</Label>
                <Input
                  id="new-label"
                  placeholder="e.g., Introduce Character"
                  value={newStep.label}
                  onChange={(e) => setNewStep({ ...newStep, label: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new-guidance">Guidance (optional)</Label>
              <Textarea
                id="new-guidance"
                placeholder="Detailed instructions for the AI..."
                value={newStep.guidance || ''}
                onChange={(e) => setNewStep({ ...newStep, guidance: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="new-suggests-character"
                checked={newStep.suggestsNewCharacter || false}
                onCheckedChange={(checked) => setNewStep({ ...newStep, suggestsNewCharacter: !!checked })}
              />
              <Label htmlFor="new-suggests-character" className="text-sm font-normal cursor-pointer">
                Suggests introducing a new character
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setIsAddingNew(false); setNewStep({ id: '', label: '', guidance: '', suggestsNewCharacter: false }); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddNew} disabled={!newStep.id || !newStep.label}>
                Add Step
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steps List */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <Card key={`${step.id}-${index}`} className="relative">
            <CardContent className="pt-4">
              {editingIndex === index ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`edit-id-${index}`}>Step ID</Label>
                      <Input
                        id={`edit-id-${index}`}
                        value={editForm.id}
                        onChange={(e) => setEditForm({ ...editForm, id: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`edit-label-${index}`}>Label</Label>
                      <Input
                        id={`edit-label-${index}`}
                        value={editForm.label}
                        onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`edit-guidance-${index}`}>Guidance</Label>
                    <Textarea
                      id={`edit-guidance-${index}`}
                      value={editForm.guidance || ''}
                      onChange={(e) => setEditForm({ ...editForm, guidance: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-suggests-character-${index}`}
                      checked={editForm.suggestsNewCharacter || false}
                      onCheckedChange={(checked) => setEditForm({ ...editForm, suggestsNewCharacter: !!checked })}
                    />
                    <Label htmlFor={`edit-suggests-character-${index}`} className="text-sm font-normal cursor-pointer">
                      Suggests introducing a new character
                    </Label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit}>
                      <Check className="h-4 w-4 mr-1" /> Done
                    </Button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <GripVertical className="h-4 w-4 text-muted-foreground mx-auto" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === steps.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {index + 1}
                      </span>
                      <span className="font-medium">{step.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">({step.id})</span>
                      {step.suggestsNewCharacter && (
                        <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-1.5 py-0.5 rounded">
                          + New Character
                        </span>
                      )}
                    </div>
                    {step.guidance ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">{step.guidance}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/50 italic">No guidance provided</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleStartEdit(index)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {steps.length === 0 && !isAddingNew && (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-2">No arc steps defined.</p>
          <Button variant="outline" size="sm" onClick={() => setIsAddingNew(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add First Step
          </Button>
        </div>
      )}
    </div>
  );
}
