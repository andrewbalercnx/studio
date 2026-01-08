'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, Settings, Users, Printer, Database, Bug, Trash2, Mail, ShieldCheck, Upload, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ElevenLabsApiVersion } from '@/lib/types';
import { useUser } from '@/firebase/auth/use-user';

export default function AdminDashboardPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();
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
    showReportIssueButton,
    elevenLabsApiVersion,
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
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights. This page is admin-only.</p>;
    }
    return (
      <div className="space-y-8">
        {/* System Maintenance */}
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
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/deleted-items">
                  <Trash2 className="mr-2 h-4 w-4" /> View Deleted Items
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/ai-logs">
                  <FileText className="mr-2 h-4 w-4" /> AI Flow Logs
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* System Configuration */}
        <Card data-wiz-target="admin-system-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              System Configuration
              <span className="ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                <ShieldCheck className="mr-1 h-3 w-3" /> Admin Only
              </span>
            </CardTitle>
            <CardDescription>
              Database tools and system settings
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
                    <Link href="/admin/upload">
                      <Upload className="mr-2 h-4 w-4" /> Upload JSON Configs
                    </Link>
                  </Button>
                </div>
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

        {/* Diagnostics & Logging Settings */}
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
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="showReportIssueButton">Report Issue Button</Label>
                    <p className="text-xs text-muted-foreground">
                      Show a button in the header for all users to report issues to maintenance users
                    </p>
                  </div>
                  <Switch
                    id="showReportIssueButton"
                    checked={showReportIssueButton}
                    onCheckedChange={(checked) => updateConfig({ showReportIssueButton: checked })}
                  />
                </div>

                {/* ElevenLabs API Version */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="elevenLabsApiVersion">ElevenLabs API Version</Label>
                      <p className="text-xs text-muted-foreground">
                        TTS model version: v2 (stable, real-time) or v3 (expressive, pre-generated)
                      </p>
                    </div>
                    <Select
                      value={elevenLabsApiVersion}
                      onValueChange={(value: ElevenLabsApiVersion) => updateConfig({ elevenLabsApiVersion: value })}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="v2">v2 (Multilingual)</SelectItem>
                        <SelectItem value="v3">v3 (Expressive)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
            Administrative tools and system configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/dev">Development →</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/writer">Writer →</Link>
            </Button>
          </div>
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
