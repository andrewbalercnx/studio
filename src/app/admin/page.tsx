'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoaderCircle, PenTool, Database, FlaskConical, Settings, Users, BookOpen, Palette, Printer, Bug, Trash2, MessageSquare, Sparkles, Plus, Edit, ExternalLink, ShieldCheck, Upload, Mail, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { collection, doc, addDoc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StoryPhase, PromptConfig, StoryOutputType, PrintLayout } from '@/lib/types';

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
  imagePrompt: string;
  defaultPrintLayoutId: string;
  paginationPrompt: string;
  imageUrl?: string;
};

export default function AdminDashboardPage() {
  const { isAuthenticated, isAdmin, isWriter, email, loading, error } = useAdminStatus();
  const {
    config: diagnosticsConfig,
    loading: diagnosticsLoading,
    updateConfig,
    showDiagnosticsPanel,
    enableClientLogging,
    enableServerLogging,
    enableAIFlowLogging,
    showApiDocumentation,
    enableMixamWebhookLogging,
  } = useDiagnostics();
  const { toast } = useToast();
  const { user } = useUser();
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  const handleSendTestEmail = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'You must be signed in to send test emails',
        variant: 'destructive',
      });
      return;
    }

    setSendingTestEmail(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();

      if (data.ok) {
        toast({
          title: 'Test email sent',
          description: `Email sent to ${data.recipient}`,
        });
      } else {
        toast({
          title: 'Failed to send test email',
          description: data.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to send test email',
        variant: 'destructive',
      });
    } finally {
      setSendingTestEmail(false);
    }
  };

  const diagnostics = {
    page: 'admin-dashboard',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading,
      error,
    },
    diagnosticsConfig,
  };

  const renderContent = () => {
    if (loading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (error) {
      return <p className="text-destructive">Error: {error}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access this page.</p>;
    }
    if (!isAdmin && !isWriter) {
      return <p>You are signed in but do not have admin or writer rights.</p>;
    }
    return (
      <div className="space-y-8">
        {/* System Maintenance - Admin Only */}
        {isAdmin && (
          <Card data-wiz-target="admin-system-maintenance">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                System Maintenance
                <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                  <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
                </span>
              </CardTitle>
              <CardDescription>
                User management and order administration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/users">
                    <Users className="mr-2 h-4 w-4" /> Users
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/print-orders">
                    <Printer className="mr-2 h-4 w-4" /> Print Orders
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Story Editor Section - Merged from /writer */}
        <Card data-wiz-target="admin-story-editor">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              Story Editor
            </CardTitle>
            <CardDescription>
              Manage the creative building blocks: story types, phases, prompts, and output templates
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card data-wiz-target="admin-data-management">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Data Management
            </CardTitle>
            <CardDescription>
              View and manage application data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4" /> Profiles
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/children">Children</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/characters">Characters</Link>
                  </Button>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" /> Stories
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/sessions">Story Sessions</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/helpWizards">Help Wizards</Link>
                  </Button>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Palette className="h-4 w-4" /> Output Configuration
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/image-styles">Image Styles</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/print-layouts">Print Layouts</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/print-products">Print Products</Link>
                  </Button>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Trash2 className="h-4 w-4" /> Deleted Items
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/deleted-items">View Deleted Items</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Restore items that have been deleted by parents.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Testing & Development */}
        <Card data-wiz-target="admin-testing">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Testing & Development
            </CardTitle>
            <CardDescription>
              Test AI flows and run regression tests
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2">AI Flow Tests</h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/storyBeatTest">Story Beat</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/storyArcTest">Story Arc</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/storyCompileTest">Story Compile</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/paginationTest">Story Pagination</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/ai-logs">AI Flow Logs</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/run-traces">Run Traces</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Run Traces aggregates all AI calls for a story session with full prompts, outputs, and costs.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Regression & Rules</h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/regression">Regression Tests</Link>
                  </Button>
                  <Button asChild variant="destructive" size="sm">
                    <Link href="/firestore-test">Firestore Rules Tests</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System Configuration - Admin Only */}
        <Card data-wiz-target="admin-system-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Configuration
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Database tools, AI prompts, and system settings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Tools</h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/database">Database Manager</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/upload">Upload JSON Configs</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/create">Create Data (Dev)</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/parent/settings">Parent Settings</Link>
                  </Button>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> AI Prompts
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/global-prompts">Global Prompt Prefix</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/compile-prompt">Compile Prompt</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/pagination-prompt">Pagination Prompt</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/image-prompt">Image Prompt</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/prompts">Prompt Configs</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure prompts for AI story generation: global prefix, story compilation, pagination, image generation, and per-flow configs.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Story Generators
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/storyGenerators">Story Generators</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/kids-flows">Story Flow Selection</Link>
                  </Button>
                  <SeedStoryGeneratorsButton />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure story generators (prompts, music) and flow selection.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Email
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/email-config">Email Configuration</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure sender address, branding, and email templates for notifications.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Diagnostics & Logging Settings - Admin Only */}
        <Card data-wiz-target="admin-diagnostics">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5" />
              Diagnostics & Logging
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Control system-wide diagnostic panels and logging output
            </CardDescription>
          </CardHeader>
          <CardContent>
            {diagnosticsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading settings...
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="showDiagnosticsPanel">Show Diagnostics Panels</Label>
                    <p className="text-xs text-muted-foreground">
                      Display diagnostic information cards on all pages
                    </p>
                  </div>
                  <Switch
                    id="showDiagnosticsPanel"
                    checked={showDiagnosticsPanel}
                    onCheckedChange={(checked) => updateConfig({ showDiagnosticsPanel: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enableClientLogging">Client Console Logging</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable detailed console.log output in the browser
                    </p>
                  </div>
                  <Switch
                    id="enableClientLogging"
                    checked={enableClientLogging}
                    onCheckedChange={(checked) => updateConfig({ enableClientLogging: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enableServerLogging">Server Logging</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable detailed server-side logging for API routes
                    </p>
                  </div>
                  <Switch
                    id="enableServerLogging"
                    checked={enableServerLogging}
                    onCheckedChange={(checked) => updateConfig({ enableServerLogging: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enableAIFlowLogging">AI Flow Logging</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable detailed logging for Genkit AI flows
                    </p>
                  </div>
                  <Switch
                    id="enableAIFlowLogging"
                    checked={enableAIFlowLogging}
                    onCheckedChange={(checked) => updateConfig({ enableAIFlowLogging: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="showApiDocumentation">API Documentation</Label>
                    <p className="text-xs text-muted-foreground">
                      Expose API documentation at /api-documentation
                    </p>
                  </div>
                  <Switch
                    id="showApiDocumentation"
                    checked={showApiDocumentation}
                    onCheckedChange={(checked) => updateConfig({ showApiDocumentation: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enableMixamWebhookLogging">Mixam Webhook Logging</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable debug logging for Mixam webhook order lookups
                    </p>
                  </div>
                  <Switch
                    id="enableMixamWebhookLogging"
                    checked={enableMixamWebhookLogging}
                    onCheckedChange={(checked) => updateConfig({ enableMixamWebhookLogging: checked })}
                  />
                </div>

                {/* Test Email Button */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Test Email (SMTP)</Label>
                      <p className="text-xs text-muted-foreground">
                        Send a test email to verify SMTP configuration
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSendTestEmail}
                      disabled={sendingTestEmail}
                    >
                      {sendingTestEmail ? (
                        <>
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="mr-2 h-4 w-4" />
                          Send Test Email
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Admin Dashboard
            <span className="text-xs font-mono text-muted-foreground">{process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || 'dev'}</span>
          </CardTitle>
          <CardDescription>
            Administrative tools and configuration for Story Guide
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Manage story types, phases, prompts, output templates, and system settings. Changes save directly to Firestore.
        </CardContent>
      </Card>

      {renderContent()}

      <DiagnosticsPanel
        pageName="admin-dashboard"
        data={diagnostics}
        className="mt-8"
      />
    </div>
  );
}

// Story Types Panel - Links to full editor
function StoryTypesPanel() {
  return (
    <div className="text-center py-8 border-2 border-dashed rounded-lg">
      <p className="text-muted-foreground mb-4">
        Story Types are managed in a dedicated editor with full Prompt Config support.
      </p>
      <Button asChild>
        <Link href="/admin/storyTypes">
          <ExternalLink className="mr-2 h-4 w-4" /> Open Story Types Editor
        </Link>
      </Button>
    </div>
  );
}

// Story Phases Panel
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

// Prompt Configs Panel
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

// Story Outputs Panel
function StoryOutputsPanel() {
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
      updatedAt: serverTimestamp(),
    };
    // Handle optional fields - set to empty string or include value
    payload.imagePrompt = form.imagePrompt || '';
    payload.defaultPrintLayoutId = form.defaultPrintLayoutId || '';
    payload.paginationPrompt = form.paginationPrompt || '';

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

// Seed Story Generators Button
function SeedStoryGeneratorsButton() {
  const { user } = useUser();
  const { toast } = useToast();
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeed = async () => {
    if (!user) {
      toast({ title: 'Error', description: 'You must be signed in', variant: 'destructive' });
      return;
    }

    setIsSeeding(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/story-generators/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Story Generators Seeded',
          description: result.message,
        });
      } else {
        toast({
          title: 'Error',
          description: result.errorMessage || 'Failed to seed generators',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to seed generators',
        variant: 'destructive',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSeed}
      disabled={isSeeding}
    >
      {isSeeding ? (
        <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Seeding...</>
      ) : (
        <><Wand2 className="mr-2 h-4 w-4" /> Seed Generators</>
      )}
    </Button>
  );
}
