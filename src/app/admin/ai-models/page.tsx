'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  LoaderCircle,
  ArrowLeft,
  Save,
  RotateCcw,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  Bell,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { AIModelsConfig, GoogleAIModelInfo } from '@/lib/types';
import { DEFAULT_AI_MODELS_CONFIG } from '@/lib/types';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useDiagnostics } from '@/hooks/use-diagnostics';

type ModelConfigKey = 'imageGenerationModel' | 'primaryTextModel' | 'lightweightTextModel' | 'legacyTextModel';

const MODEL_LABELS: Record<ModelConfigKey, { title: string; description: string }> = {
  imageGenerationModel: {
    title: 'Image Generation Model',
    description: 'Used for generating storybook images, avatars, and exemplars',
  },
  primaryTextModel: {
    title: 'Primary Text Model',
    description: 'Used for complex text generation tasks (story creation, character profiles)',
  },
  lightweightTextModel: {
    title: 'Lightweight Text Model',
    description: 'Used for simple, fast text tasks (synopses, descriptions)',
  },
  legacyTextModel: {
    title: 'Legacy Text Model',
    description: 'Used for specific older use cases (titles, pagination)',
  },
};

const MODEL_ORDER: ModelConfigKey[] = [
  'imageGenerationModel',
  'primaryTextModel',
  'lightweightTextModel',
  'legacyTextModel',
];

type AvailabilityStatus = 'ok' | 'warning' | 'error';

type ConfiguredModelInfo = {
  model: string;
  status: 'available' | 'unavailable';
  usedBy: string[];
};

type AvailabilityCheckResponse = {
  ok: boolean;
  status: AvailabilityStatus;
  issues: Array<{
    model: string;
    configKey: string;
    issue: string;
    message: string;
  }>;
  availableModels: {
    image: GoogleAIModelInfo[];
    text: GoogleAIModelInfo[];
    embedding: GoogleAIModelInfo[];
    other: GoogleAIModelInfo[];
  };
  totalModels: number;
  configuredModels: Record<ModelConfigKey, ConfiguredModelInfo>;
  alertsSent: boolean;
  errorMessage?: string;
};

export default function AIModelsPage() {
  const { isAdmin, loading: authLoading } = useAdminStatus();
  const { showDiagnosticsPanel } = useDiagnostics();
  const { user } = useUser();
  const { toast } = useToast();

  const [config, setConfig] = useState<AIModelsConfig>(DEFAULT_AI_MODELS_CONFIG);
  const [originalConfig, setOriginalConfig] = useState<AIModelsConfig>(DEFAULT_AI_MODELS_CONFIG);
  const [usageMap, setUsageMap] = useState<Record<string, string[]>>({});
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sendAlerts, setSendAlerts] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Availability check state
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus | null>(null);
  const [availabilityIssues, setAvailabilityIssues] = useState<AvailabilityCheckResponse['issues']>([]);
  const [availableModels, setAvailableModels] = useState<AvailabilityCheckResponse['availableModels'] | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  // Load config from API
  const loadConfig = useCallback(async () => {
    if (!user) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/ai-models', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.ok) {
        setConfig(data.config);
        setOriginalConfig(data.config);
        setUsageMap(data.usageMap || {});
        setEnvOverrides(data.envOverrides || {});

        // If there's a stored availability check, restore its status
        if (data.config.availabilityCheck) {
          setAvailabilityStatus(data.config.availabilityCheck.status);
          setAvailabilityIssues(data.config.availabilityCheck.issues || []);
          if (data.config.availabilityCheck.lastCheckedAt) {
            // Convert Firestore timestamp to readable string
            const ts = data.config.availabilityCheck.lastCheckedAt;
            if (ts._seconds) {
              setLastCheckedAt(new Date(ts._seconds * 1000).toLocaleString());
            } else if (ts.toDate) {
              setLastCheckedAt(ts.toDate().toLocaleString());
            }
          }
        }
      } else {
        throw new Error(data.errorMessage || 'Failed to load configuration');
      }
    } catch (error: unknown) {
      console.error('Failed to load AI models config:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load configuration',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (isAdmin && user) {
      loadConfig();
    }
  }, [isAdmin, user, loadConfig]);

  // Track changes
  useEffect(() => {
    const configKeys: ModelConfigKey[] = MODEL_ORDER;
    const hasConfigChanges = configKeys.some(
      (key) => config[key] !== originalConfig[key]
    );
    setHasChanges(hasConfigChanges);
  }, [config, originalConfig]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/ai-models', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageGenerationModel: config.imageGenerationModel,
          primaryTextModel: config.primaryTextModel,
          lightweightTextModel: config.lightweightTextModel,
          legacyTextModel: config.legacyTextModel,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setOriginalConfig(config);
        setHasChanges(false);
        toast({
          title: 'Saved',
          description: 'AI models configuration saved successfully',
        });
      } else {
        throw new Error(data.errorMessage || 'Failed to save configuration');
      }
    } catch (error: unknown) {
      console.error('Failed to save AI models config:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save configuration',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(originalConfig);
  };

  const handleCheckAvailability = async () => {
    if (!user) return;

    setChecking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/ai-models/check-availability', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sendAlerts }),
      });

      const data: AvailabilityCheckResponse = await response.json();

      if (data.ok) {
        setAvailabilityStatus(data.status);
        setAvailabilityIssues(data.issues);
        setAvailableModels(data.availableModels);
        setLastCheckedAt(new Date().toLocaleString());

        if (data.status === 'ok') {
          toast({
            title: 'All Models Available',
            description: `All ${data.totalModels} configured models are available in the Google AI API.`,
          });
        } else if (data.status === 'warning') {
          toast({
            title: 'Model Warnings',
            description: `${data.issues.length} issue(s) found. Some models may need attention.`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Model Issues Found',
            description: `${data.issues.length} critical issue(s) found. Action required.`,
            variant: 'destructive',
          });
        }

        if (data.alertsSent) {
          toast({
            title: 'Alerts Sent',
            description: 'Maintenance users have been notified via email.',
          });
        }
      } else {
        throw new Error(data.errorMessage || 'Failed to check availability');
      }
    } catch (error: unknown) {
      console.error('Failed to check model availability:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to check model availability',
        variant: 'destructive',
      });
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = (status: AvailabilityStatus | null) => {
    switch (status) {
      case 'ok':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Info className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: AvailabilityStatus | null) => {
    switch (status) {
      case 'ok':
        return <Badge variant="default" className="bg-green-500">All Available</Badge>;
      case 'warning':
        return <Badge variant="secondary" className="bg-yellow-500 text-black">Warnings</Badge>;
      case 'error':
        return <Badge variant="destructive">Issues Found</Badge>;
      default:
        return <Badge variant="outline">Not Checked</Badge>;
    }
  };

  // Auth loading state
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You need admin access to view this page.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">AI Models Configuration</h1>
          <p className="text-muted-foreground">
            Manage which AI models are used across the application
          </p>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Availability Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(availabilityStatus)}
                  <div>
                    <CardTitle>Model Availability</CardTitle>
                    <CardDescription>
                      Check if configured models are available in the Google AI API
                    </CardDescription>
                  </div>
                </div>
                {getStatusBadge(availabilityStatus)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {lastCheckedAt && (
                <p className="text-sm text-muted-foreground">
                  Last checked: {lastCheckedAt}
                </p>
              )}

              {/* Issues List */}
              {availabilityIssues.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-destructive">Issues Found:</Label>
                  {availabilityIssues.map((issue, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 p-3 bg-destructive/10 rounded-md"
                    >
                      <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{issue.model}</p>
                        <p className="text-sm text-muted-foreground">{issue.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Check Controls */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="send-alerts"
                    checked={sendAlerts}
                    onCheckedChange={setSendAlerts}
                  />
                  <Label htmlFor="send-alerts" className="flex items-center gap-1">
                    <Bell className="h-4 w-4" />
                    Send alerts if issues found
                  </Label>
                </div>
                <Button
                  onClick={handleCheckAvailability}
                  disabled={checking}
                  variant="outline"
                >
                  {checking ? (
                    <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Check Availability
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Model Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle>Model Configuration</CardTitle>
              <CardDescription>
                Configure which models to use for different tasks
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {MODEL_ORDER.map((key) => {
                const label = MODEL_LABELS[key];
                const flows = usageMap[key] || [];
                const envOverride = envOverrides[key];

                return (
                  <div key={key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={key}>{label.title}</Label>
                      {envOverride && (
                        <Badge variant="outline" className="text-xs">
                          Env override: {envOverride}
                        </Badge>
                      )}
                    </div>
                    <Input
                      id={key}
                      value={config[key]}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder={DEFAULT_AI_MODELS_CONFIG[key]}
                      className={envOverride ? 'opacity-50' : ''}
                      disabled={!!envOverride}
                    />
                    <p className="text-xs text-muted-foreground">{label.description}</p>
                    {flows.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Used by: {flows.join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Available Models Accordion */}
          {availableModels && (
            <Accordion type="single" collapsible>
              <AccordionItem value="available-models">
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <span>Available Models from Google AI</span>
                    <Badge variant="secondary">
                      {(availableModels.image?.length || 0) +
                        (availableModels.text?.length || 0) +
                        (availableModels.embedding?.length || 0) +
                        (availableModels.other?.length || 0)}{' '}
                      models
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    {/* Image Models */}
                    {availableModels.image && availableModels.image.length > 0 && (
                      <div>
                        <Label className="text-sm font-medium">Image Generation Models</Label>
                        <div className="mt-2 space-y-1">
                          {availableModels.image.map((model) => (
                            <div
                              key={model.name}
                              className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                            >
                              <span className="font-mono text-xs">
                                googleai/{model.name.replace('models/', '')}
                              </span>
                              <span className="text-muted-foreground">
                                {model.displayName}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Text Models */}
                    {availableModels.text && availableModels.text.length > 0 && (
                      <div>
                        <Label className="text-sm font-medium">Text Generation Models</Label>
                        <div className="mt-2 space-y-1">
                          {availableModels.text.map((model) => (
                            <div
                              key={model.name}
                              className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                            >
                              <span className="font-mono text-xs">
                                googleai/{model.name.replace('models/', '')}
                              </span>
                              <span className="text-muted-foreground">
                                {model.displayName}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Embedding Models */}
                    {availableModels.embedding && availableModels.embedding.length > 0 && (
                      <div>
                        <Label className="text-sm font-medium">Embedding Models</Label>
                        <div className="mt-2 space-y-1">
                          {availableModels.embedding.map((model) => (
                            <div
                              key={model.name}
                              className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                            >
                              <span className="font-mono text-xs">
                                googleai/{model.name.replace('models/', '')}
                              </span>
                              <span className="text-muted-foreground">
                                {model.displayName}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Floating Save Bar */}
          {hasChanges && (
            <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 shadow-lg z-50">
              <div className="container mx-auto max-w-4xl flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  You have unsaved changes
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={saving}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Discard
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <LoaderCircle className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Diagnostics Panel */}
          {showDiagnosticsPanel && (
            <DiagnosticsPanel
              pageName="admin-ai-models"
              data={{
                config,
                originalConfig,
                hasChanges,
                availabilityStatus,
                availabilityIssues,
                usageMap,
                envOverrides,
              }}
              className="mt-8"
            />
          )}
        </div>
      )}
    </div>
  );
}
