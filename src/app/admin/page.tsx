'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, PenTool, Database, FlaskConical, Settings, Users, BookOpen, Palette, Printer, Wand2, Bug, Trash2, MessageSquare, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase/auth/use-user';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';

export default function AdminDashboardPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();
  const { toast } = useToast();
  const { user } = useUser();
  const [isMigratingPronouns, setIsMigratingPronouns] = useState(false);
  const [isMigratingPrintLayouts, setIsMigratingPrintLayouts] = useState(false);
  const [isPreviewingPrintLayouts, setIsPreviewingPrintLayouts] = useState(false);
  const [printLayoutMigrationPreview, setPrintLayoutMigrationPreview] = useState<{
    totalLayouts: number;
    needsMigrationCount: number;
    previews: Array<{ id: string; name: string; proposedChanges: string[] }>;
  } | null>(null);
  const {
    config: diagnosticsConfig,
    loading: diagnosticsLoading,
    updateConfig,
    showDiagnosticsPanel,
    enableClientLogging,
    enableServerLogging,
    enableAIFlowLogging,
  } = useDiagnostics();

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

  const handleMigratePronouns = async () => {
    if (!user) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }

    setIsMigratingPronouns(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/migrate/pronouns', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast({
          title: 'Pronouns Migration Complete',
          description: `Children: ${result.childrenMigrated} migrated, ${result.childrenSkipped} skipped. Characters: ${result.charactersMigrated} migrated, ${result.charactersSkipped} skipped.`,
        });
      } else {
        toast({
          title: 'Migration had issues',
          description: result.errors?.join(', ') || result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Migration failed',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsMigratingPronouns(false);
    }
  };

  const handlePreviewPrintLayoutMigration = async () => {
    if (!user) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }

    setIsPreviewingPrintLayouts(true);
    setPrintLayoutMigrationPreview(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/migrate/print-layouts', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok) {
        setPrintLayoutMigrationPreview({
          totalLayouts: result.totalLayouts,
          needsMigrationCount: result.needsMigrationCount,
          previews: result.previews,
        });
        toast({
          title: 'Preview Complete',
          description: `Found ${result.needsMigrationCount} of ${result.totalLayouts} layouts needing migration`,
        });
      } else {
        toast({
          title: 'Preview failed',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Preview failed',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsPreviewingPrintLayouts(false);
    }
  };

  const handleApplyPrintLayoutMigration = async () => {
    if (!user) {
      toast({ title: 'Not authenticated', variant: 'destructive' });
      return;
    }

    setIsMigratingPrintLayouts(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/migrate/print-layouts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast({
          title: 'Print Layout Migration Complete',
          description: `Migrated ${result.migratedCount} of ${result.totalLayouts} layouts`,
        });
        setPrintLayoutMigrationPreview(null);
      } else {
        toast({
          title: 'Migration had issues',
          description: result.error || `${result.errorCount} errors occurred`,
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Migration failed',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsMigratingPrintLayouts(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <LoaderCircle className="mx-auto h-8 w-8 animate-spin" />;
    }
    if (error) {
      return <p className="text-destructive">Error: {error}</p>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }
    return (
      <div className="space-y-8">
        {/* Content Management - Story Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              Content Management
            </CardTitle>
            <CardDescription>
              Manage story types, phases, prompts, and output templates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/writer">Story Editor</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/storyDesigner">Story Designer (Beta)</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              The Story Editor provides tabs for Story Types, Story Phases, Prompt Configs, and Output Types.
            </p>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
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
                  <Users className="h-4 w-4" /> Users & Profiles
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/users">Users</Link>
                  </Button>
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
                  <Printer className="h-4 w-4" /> Orders
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/print-orders">Print Orders</Link>
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
        <Card>
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
                    <Link href="/admin/ai-logs">AI Flow Logs</Link>
                  </Button>
                </div>
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

        {/* System Administration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Administration
            </CardTitle>
            <CardDescription>
              Database tools and configuration
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
                    <Link href="/admin/prompts">Prompt Configs</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure prompts for AI story generation: global prefix, story compilation, and per-flow configs.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Kids PWA
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/admin/kids-flows">Story Flow Selection</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure which story generation flows are available in the Kids PWA.
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Wand2 className="h-4 w-4" /> Migrations
                </h4>
                <div className="space-y-4">
                  {/* Pronouns Migration */}
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMigratePronouns}
                        disabled={isMigratingPronouns}
                      >
                        {isMigratingPronouns ? (
                          <>
                            <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                            Migrating...
                          </>
                        ) : (
                          'Migrate Pronouns'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Infers and sets pronouns for children and characters that don&apos;t have them set.
                    </p>
                  </div>

                  {/* Print Layout Migration */}
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePreviewPrintLayoutMigration}
                        disabled={isPreviewingPrintLayouts || isMigratingPrintLayouts}
                      >
                        {isPreviewingPrintLayouts ? (
                          <>
                            <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                            Previewing...
                          </>
                        ) : (
                          'Preview Print Layout Migration'
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleApplyPrintLayoutMigration}
                        disabled={isMigratingPrintLayouts || isPreviewingPrintLayouts}
                      >
                        {isMigratingPrintLayouts ? (
                          <>
                            <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
                            Migrating...
                          </>
                        ) : (
                          'Apply Print Layout Migration'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Migrates print layouts to add leaf property, borderRadius, and remove legacy arrays.
                    </p>
                    {printLayoutMigrationPreview && (
                      <div className="mt-2 p-3 bg-muted rounded-md text-xs">
                        <p className="font-medium mb-2">
                          {printLayoutMigrationPreview.needsMigrationCount} of {printLayoutMigrationPreview.totalLayouts} layouts need migration:
                        </p>
                        <ul className="space-y-1">
                          {printLayoutMigrationPreview.previews
                            .filter(p => p.proposedChanges.length > 0)
                            .map(preview => (
                              <li key={preview.id} className="pl-2 border-l-2 border-primary">
                                <span className="font-medium">{preview.name}</span>
                                <ul className="ml-2 text-muted-foreground">
                                  {preview.proposedChanges.map((change, idx) => (
                                    <li key={idx}>• {change}</li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                        </ul>
                        {printLayoutMigrationPreview.needsMigrationCount === 0 && (
                          <p className="text-green-600">All layouts are up to date!</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Diagnostics & Logging Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5" />
              Diagnostics & Logging
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Admin Dashboard</CardTitle>
          <CardDescription>
            Administrative tools and configuration for Story Guide
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>

      <DiagnosticsPanel
        pageName="admin-dashboard"
        data={diagnostics}
        className="mt-8"
      />
    </div>
  );
}
