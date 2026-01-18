'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import {
  ListTodo,
  Plus,
  LoaderCircle,
  MoreVertical,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  CircleDot,
  AlertCircle,
  Bot,
  User,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';
import type { DevTodo, DevTodoStatus, DevTodoPriority } from '@/lib/types';

const STATUS_CONFIG: Record<DevTodoStatus, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pending: { label: 'Pending', icon: Circle, color: 'bg-gray-100 text-gray-800' },
  in_progress: { label: 'In Progress', icon: CircleDot, color: 'bg-blue-100 text-blue-800' },
  partial: { label: 'Partial', icon: AlertCircle, color: 'bg-yellow-100 text-yellow-800' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'bg-green-100 text-green-800' },
};

const PRIORITY_CONFIG: Record<DevTodoPriority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-600' },
  medium: { label: 'Medium', color: 'bg-orange-100 text-orange-700' },
  high: { label: 'High', color: 'bg-red-100 text-red-700' },
};

// Format a todo for copying to Claude
function formatTodoForClaude(todo: DevTodo): string {
  const lines = [
    `## Development Todo: ${todo.title}`,
    '',
    `**Priority:** ${todo.priority}`,
    `**Status:** ${todo.status}`,
  ];

  if (todo.category) {
    lines.push(`**Category:** ${todo.category}`);
  }

  if (todo.description) {
    lines.push('', '### Description', '', todo.description);
  }

  if (todo.partialComment) {
    lines.push('', '### Partial Progress Note', '', todo.partialComment);
  }

  // Include previous completion info if the item was previously completed
  // This helps Claude understand what was done before when reopening
  if (todo.completionSummary) {
    lines.push('', '### Previous Completion Summary', '');
    if (todo.commitId) {
      lines.push(`**Commit:** ${todo.commitId}`);
    }
    lines.push('', todo.completionSummary);
  }

  if (todo.relatedFiles && todo.relatedFiles.length > 0) {
    lines.push('', '### Related Files', '');
    todo.relatedFiles.forEach(file => lines.push(`- ${file}`));
  }

  lines.push('', '---', '');
  lines.push('Please implement this development todo item. Review the description and related files, then proceed with the implementation.');

  return lines.join('\n');
}

export function DevTodoList() {
  const { user } = useUser();
  const { toast } = useToast();
  const [todos, setTodos] = useState<DevTodo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<DevTodo | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedTodos, setExpandedTodos] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Completion dialog state
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [completingTodo, setCompletingTodo] = useState<DevTodo | null>(null);
  const [completionSummary, setCompletionSummary] = useState('');
  const [completionCommitId, setCompletionCommitId] = useState('');

  // Form state for add/edit
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<DevTodoPriority>('medium');
  const [formCategory, setFormCategory] = useState('');
  const [formPartialComment, setFormPartialComment] = useState('');

  const fetchTodos = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/dev-todos', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();

      if (result.ok) {
        setTodos(result.todos || []);
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to load todos',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load todos',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const resetForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    setFormCategory('');
    setFormPartialComment('');
  };

  const handleAddTodo = async () => {
    if (!user || !formTitle.trim()) return;

    setIsSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/dev-todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          priority: formPriority,
          category: formCategory.trim() || undefined,
          createdBy: 'admin',
        }),
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Todo Added',
          description: 'Development todo has been added',
        });
        setIsAddDialogOpen(false);
        resetForm();
        fetchTodos();
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to add todo',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add todo',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTodo = async (todoId: string, updates: Partial<DevTodo>) => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/dev-todos', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          todoId,
          ...updates,
        }),
      });
      const result = await response.json();

      if (result.ok) {
        fetchTodos();
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to update todo',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update todo',
        variant: 'destructive',
      });
    }
  };

  const handleEditSubmit = async () => {
    if (!user || !editingTodo || !formTitle.trim()) return;

    setIsSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/dev-todos', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          todoId: editingTodo.id,
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          priority: formPriority,
          category: formCategory.trim() || null,
          partialComment: formPartialComment.trim() || null,
        }),
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Todo Updated',
          description: 'Development todo has been updated',
        });
        setIsEditDialogOpen(false);
        setEditingTodo(null);
        resetForm();
        fetchTodos();
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to update todo',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update todo',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/dev-todos?todoId=${todoId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Todo Deleted',
          description: 'Development todo has been deleted',
        });
        fetchTodos();
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to delete todo',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete todo',
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (todo: DevTodo) => {
    setEditingTodo(todo);
    setFormTitle(todo.title);
    setFormDescription(todo.description || '');
    setFormPriority(todo.priority);
    setFormCategory(todo.category || '');
    setFormPartialComment(todo.partialComment || '');
    setIsEditDialogOpen(true);
  };

  const toggleExpanded = (todoId: string) => {
    setExpandedTodos(prev => {
      const next = new Set(prev);
      if (next.has(todoId)) {
        next.delete(todoId);
      } else {
        next.add(todoId);
      }
      return next;
    });
  };

  const copyTodoForClaude = async (todo: DevTodo) => {
    const text = formatTodoForClaude(todo);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(todo.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({
        title: 'Copied',
        description: 'Todo copied to clipboard for Claude',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  // Open completion dialog
  const openCompleteDialog = (todo: DevTodo) => {
    setCompletingTodo(todo);
    setCompletionSummary('');
    setCompletionCommitId('');
    setIsCompleteDialogOpen(true);
  };

  // Handle marking todo as complete with summary
  const handleMarkComplete = async () => {
    if (!user || !completingTodo) return;

    setIsSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/dev-todos', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          todoId: completingTodo.id,
          status: 'completed',
          completedBy: 'admin',
          completionSummary: completionSummary.trim() || undefined,
          commitId: completionCommitId.trim() || undefined,
        }),
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Todo Completed',
          description: 'Development todo has been marked as complete',
        });
        setIsCompleteDialogOpen(false);
        setCompletingTodo(null);
        setCompletionSummary('');
        setCompletionCommitId('');
        fetchTodos();
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to complete todo',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to complete todo',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter todos based on showCompleted
  const filteredTodos = todos.filter(todo =>
    showCompleted ? true : todo.status !== 'completed'
  );

  // Group todos by status for display
  const pendingTodos = filteredTodos.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const partialTodos = filteredTodos.filter(t => t.status === 'partial');
  const completedTodos = filteredTodos.filter(t => t.status === 'completed');

  const TodoItem = ({ todo }: { todo: DevTodo }) => {
    const isCompleted = todo.status === 'completed';
    const hasDescription = !!todo.description;
    const isExpanded = expandedTodos.has(todo.id);

    return (
      <div className={`rounded-lg border ${isCompleted ? 'bg-muted/50' : 'bg-background'}`}>
        <div className="flex items-start gap-3 p-3">
          <Checkbox
            checked={isCompleted}
            onCheckedChange={(checked) => {
              if (checked) {
                // Open completion dialog to capture summary
                openCompleteDialog(todo);
              } else {
                // Reopen - just set to pending
                handleUpdateTodo(todo.id, { status: 'pending' });
              }
            }}
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {hasDescription && (
                <button
                  onClick={() => toggleExpanded(todo.id)}
                  className="p-0.5 hover:bg-muted rounded"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              )}
              <span className={`font-medium ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                {todo.title}
              </span>
              <Badge variant="outline" className={PRIORITY_CONFIG[todo.priority].color}>
                {PRIORITY_CONFIG[todo.priority].label}
              </Badge>
              {todo.category && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700">
                  {todo.category}
                </Badge>
              )}
              {todo.createdBy === 'claude' ? (
                <span title="Added by Claude">
                  <Bot className="h-3.5 w-3.5 text-blue-500" />
                </span>
              ) : (
                <span title={`Added by ${todo.createdByEmail || 'admin'}`}>
                  <User className="h-3.5 w-3.5 text-gray-400" />
                </span>
              )}
            </div>

            {/* Preview on hover when collapsed */}
            {hasDescription && !isExpanded && (
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <p className="text-sm text-muted-foreground mt-1 truncate cursor-pointer" onClick={() => toggleExpanded(todo.id)}>
                      {todo.description!.substring(0, 100)}
                      {todo.description!.length > 100 ? '...' : ''}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-md p-4">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{todo.description!}</ReactMarkdown>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Expanded description with markdown */}
            {hasDescription && isExpanded && (
              <div
                className="mt-2 p-3 bg-muted/50 rounded-md cursor-pointer hover:bg-muted transition-colors"
                onClick={() => openEditDialog(todo)}
              >
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{todo.description!}</ReactMarkdown>
                </div>
                <p className="text-xs text-muted-foreground mt-2 italic">Click to edit</p>
              </div>
            )}

            {/* Partial comment */}
            {todo.status === 'partial' && todo.partialComment && (
              <p className="text-sm text-yellow-700 mt-2 bg-yellow-50 px-2 py-1 rounded">
                <AlertCircle className="inline h-3 w-3 mr-1" />
                {todo.partialComment}
              </p>
            )}

            {/* Completion info for completed todos */}
            {todo.status === 'completed' && (todo.completionSummary || todo.commitId) && (
              <div className="mt-2 p-2 bg-green-50 rounded-md text-sm">
                {todo.commitId && (
                  <p className="text-green-700 font-mono text-xs mb-1">
                    Commit: {todo.commitId}
                  </p>
                )}
                {todo.completionSummary && (
                  <div className="text-green-800 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{todo.completionSummary}</ReactMarkdown>
                  </div>
                )}
                {todo.completedBy && (
                  <p className="text-xs text-green-600 mt-1">
                    Completed by {todo.completedBy === 'claude' ? 'Claude' : todo.completedByEmail || 'admin'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Copy button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyTodoForClaude(todo)}
                >
                  {copiedId === todo.id ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy for Claude</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditDialog(todo)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyTodoForClaude(todo)}>
                <Copy className="h-4 w-4 mr-2" />
                Copy for Claude
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleUpdateTodo(todo.id, { status: 'pending' })}
                disabled={todo.status === 'pending'}
              >
                <Circle className="h-4 w-4 mr-2" />
                Mark Pending
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleUpdateTodo(todo.id, { status: 'in_progress' })}
                disabled={todo.status === 'in_progress'}
              >
                <CircleDot className="h-4 w-4 mr-2" />
                Mark In Progress
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEditDialog({ ...todo, status: 'partial' })}>
                <AlertCircle className="h-4 w-4 mr-2" />
                Mark Partial...
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openCompleteDialog(todo)}
                disabled={todo.status === 'completed'}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Complete...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDeleteTodo(todo.id)}
                className="text-red-600"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListTodo className="h-5 w-5" />
              Development Todo List
            </CardTitle>
            <CardDescription>
              Track work items for a production-ready system
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchTodos}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { resetForm(); setIsAddDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Todo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add Development Todo</DialogTitle>
                  <DialogDescription>
                    Add a new item to track for production readiness. Description supports Markdown.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Title *</label>
                    <Input
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="Short description of the work item"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description (Markdown)</label>
                    <Textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      placeholder="Detailed description with implementation guidance. Supports Markdown."
                      rows={8}
                      className="font-mono text-sm"
                    />
                    {formDescription && (
                      <div className="mt-2 p-3 bg-muted rounded-md">
                        <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{formDescription}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Priority</label>
                      <Select value={formPriority} onValueChange={(v) => setFormPriority(v as DevTodoPriority)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Category</label>
                      <Input
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        placeholder="e.g., security, UX"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddTodo} disabled={isSaving || !formTitle.trim()}>
                    {isSaving ? (
                      <>
                        <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Add Todo'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTodos.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ListTodo className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No development todos yet</p>
            <p className="text-sm">Add items to track work for production readiness</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pending / In Progress */}
            {pendingTodos.length > 0 && (
              <div className="space-y-2">
                {pendingTodos.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}

            {/* Partial */}
            {partialTodos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-yellow-700 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  Partially Complete
                </h4>
                {partialTodos.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}

            {/* Completed (toggleable) */}
            {completedTodos.length > 0 && showCompleted && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Completed
                </h4>
                {completedTodos.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}

            {/* Show/Hide completed toggle */}
            {todos.some(t => t.status === 'completed') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCompleted(!showCompleted)}
                className="w-full text-muted-foreground"
              >
                {showCompleted ? 'Hide' : 'Show'} {todos.filter(t => t.status === 'completed').length} completed
              </Button>
            )}
          </div>
        )}

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Development Todo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Title *</label>
                <Input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Short description of the work item"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description (Markdown)</label>
                <Textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Detailed description with implementation guidance. Supports Markdown."
                  rows={8}
                  className="font-mono text-sm"
                />
                {formDescription && (
                  <div className="mt-2 p-3 bg-muted rounded-md">
                    <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{formDescription}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Priority</label>
                  <Select value={formPriority} onValueChange={(v) => setFormPriority(v as DevTodoPriority)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Category</label>
                  <Input
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder="e.g., security, UX"
                  />
                </div>
              </div>
              {editingTodo?.status === 'partial' && (
                <div>
                  <label className="text-sm font-medium">Partial Comment</label>
                  <Textarea
                    value={formPartialComment}
                    onChange={(e) => setFormPartialComment(e.target.value)}
                    placeholder="Explain what remains to be done"
                    rows={2}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsEditDialogOpen(false); setEditingTodo(null); }}>
                Cancel
              </Button>
              <Button onClick={handleEditSubmit} disabled={isSaving || !formTitle.trim()}>
                {isSaving ? (
                  <>
                    <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Completion Dialog */}
        <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Mark Todo Complete
              </DialogTitle>
              <DialogDescription>
                Add a summary of what was done. This helps track work history and provides context if the item is reopened.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted rounded-md">
                <p className="font-medium">{completingTodo?.title}</p>
                {completingTodo?.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {completingTodo.description.substring(0, 150)}
                    {completingTodo.description.length > 150 ? '...' : ''}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">Commit ID (optional)</label>
                <Input
                  value={completionCommitId}
                  onChange={(e) => setCompletionCommitId(e.target.value)}
                  placeholder="e.g., abc1234"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Git commit hash for this change
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Completion Summary (Markdown)</label>
                <Textarea
                  value={completionSummary}
                  onChange={(e) => setCompletionSummary(e.target.value)}
                  placeholder="Describe what was implemented, key changes, any notes for future reference..."
                  rows={6}
                  className="font-mono text-sm"
                />
                {completionSummary && (
                  <div className="mt-2 p-3 bg-green-50 rounded-md">
                    <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                    <div className="prose prose-sm dark:prose-invert max-w-none text-green-800">
                      <ReactMarkdown>{completionSummary}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCompleteDialogOpen(false); setCompletingTodo(null); }}>
                Cancel
              </Button>
              <Button onClick={handleMarkComplete} disabled={isSaving} className="bg-green-600 hover:bg-green-700">
                {isSaving ? (
                  <>
                    <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
