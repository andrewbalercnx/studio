'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { LoaderCircle, Mail, ArrowLeft, Save, RotateCcw, Send, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { EmailConfig, EmailTemplateType, EmailTemplate } from '@/lib/types';
import { DEFAULT_EMAIL_CONFIG } from '@/lib/types';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { useDiagnostics } from '@/hooks/use-diagnostics';

const TEMPLATE_LABELS: Record<EmailTemplateType, { title: string; description: string; placeholders: string }> = {
  orderSubmitted: {
    title: 'Order Submitted',
    description: 'Sent when a new print order is submitted',
    placeholders: '{{orderId}}',
  },
  orderStatusChanged: {
    title: 'Order Status Changed',
    description: 'Sent when a print order status changes (from Mixam webhooks)',
    placeholders: '{{orderId}}, {{status}}',
  },
  orderApproved: {
    title: 'Order Approved',
    description: 'Sent when an admin approves a print order',
    placeholders: '{{orderId}}',
  },
  orderRejected: {
    title: 'Order Rejected',
    description: 'Sent when an admin rejects a print order',
    placeholders: '{{orderId}}',
  },
  orderCancelled: {
    title: 'Order Cancelled',
    description: 'Sent when a print order is cancelled',
    placeholders: '{{orderId}}',
  },
  testEmail: {
    title: 'Test Email',
    description: 'Sent when testing email configuration',
    placeholders: 'None',
  },
  maintenanceError: {
    title: 'Maintenance Error',
    description: 'Sent to maintenance users when system errors occur',
    placeholders: '{{flowName}}, {{errorType}}',
  },
};

const TEMPLATE_TYPES: EmailTemplateType[] = [
  'orderSubmitted',
  'orderStatusChanged',
  'orderApproved',
  'orderRejected',
  'orderCancelled',
  'testEmail',
  'maintenanceError',
];

export default function EmailConfigPage() {
  const { isAdmin, loading: authLoading } = useAdminStatus();
  const { showDiagnosticsPanel } = useDiagnostics();
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [config, setConfig] = useState<EmailConfig>(DEFAULT_EMAIL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalConfig, setOriginalConfig] = useState<EmailConfig>(DEFAULT_EMAIL_CONFIG);

  // Load config from Firestore
  useEffect(() => {
    async function loadConfig() {
      if (!firestore) return;

      try {
        const docRef = doc(firestore, 'systemConfig', 'email');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = { ...DEFAULT_EMAIL_CONFIG, ...docSnap.data() } as EmailConfig;
          setConfig(data);
          setOriginalConfig(data);
        } else {
          setConfig(DEFAULT_EMAIL_CONFIG);
          setOriginalConfig(DEFAULT_EMAIL_CONFIG);
        }
      } catch (error) {
        console.error('Failed to load email config:', error);
        toast({
          title: 'Error',
          description: 'Failed to load email configuration',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    }

    if (isAdmin) {
      loadConfig();
    }
  }, [firestore, isAdmin, toast]);

  // Track changes
  useEffect(() => {
    setHasChanges(JSON.stringify(config) !== JSON.stringify(originalConfig));
  }, [config, originalConfig]);

  const handleSave = async () => {
    if (!firestore || !user) return;

    setSaving(true);
    try {
      const docRef = doc(firestore, 'systemConfig', 'email');
      await setDoc(docRef, {
        ...config,
        updatedAt: serverTimestamp(),
        updatedBy: user.email,
      });

      setOriginalConfig(config);
      setHasChanges(false);
      toast({
        title: 'Saved',
        description: 'Email configuration saved successfully',
      });
    } catch (error: any) {
      console.error('Failed to save email config:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save configuration',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(originalConfig);
    setHasChanges(false);
  };

  const handleSendTestEmail = async () => {
    if (!user) return;

    setSendingTest(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: user.email }),
      });

      const data = await response.json();

      if (data.ok) {
        toast({
          title: 'Test Email Sent',
          description: `Email sent to ${data.recipient}`,
        });
      } else {
        toast({
          title: 'Failed',
          description: data.error || 'Failed to send test email',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send test email',
        variant: 'destructive',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const updateTemplate = (type: EmailTemplateType, updates: Partial<EmailTemplate>) => {
    setConfig((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [type]: {
          ...prev.templates[type],
          ...updates,
        },
      },
    }));
  };

  if (authLoading || loading) {
    return (
      <div className="container mx-auto p-8 flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-lg font-medium">Admin access required</p>
            <p className="text-muted-foreground mt-2">You don&apos;t have permission to access email configuration.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Admin
          </Link>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Configuration
          </CardTitle>
          <CardDescription>
            Configure the sender address, branding, and content of system emails
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="sender" className="space-y-6">
            <TabsList>
              <TabsTrigger value="sender">Sender Settings</TabsTrigger>
              <TabsTrigger value="templates">Email Templates</TabsTrigger>
            </TabsList>

            <TabsContent value="sender" className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="senderEmail">Sender Email Address</Label>
                  <Input
                    id="senderEmail"
                    type="email"
                    value={config.senderEmail}
                    onChange={(e) => setConfig({ ...config, senderEmail: e.target.value })}
                    placeholder="noreply@example.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be a valid mailbox in the Microsoft 365 tenant
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senderName">Sender Display Name</Label>
                  <Input
                    id="senderName"
                    value={config.senderName || ''}
                    onChange={(e) => setConfig({ ...config, senderName: e.target.value })}
                    placeholder="StoryPic Kids"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="brandColor">Brand Color</Label>
                  <div className="flex gap-2">
                    <Input
                      id="brandColor"
                      type="color"
                      value={config.brandColor || '#2563eb'}
                      onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
                      className="w-16 h-10 p-1"
                    />
                    <Input
                      value={config.brandColor || '#2563eb'}
                      onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
                      placeholder="#2563eb"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Used for buttons and accent elements in emails
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="footerText">Footer Text</Label>
                <Textarea
                  id="footerText"
                  value={config.footerText}
                  onChange={(e) => setConfig({ ...config, footerText: e.target.value })}
                  placeholder="This is an automated message from StoryPic Kids."
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Shown at the bottom of all emails
                </p>
              </div>

              <div className="pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Test Email Configuration</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Send a test email to verify your settings
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleSendTestEmail}
                    disabled={sendingTest}
                  >
                    {sendingTest ? (
                      <>
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send Test Email
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="templates" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Customize the content of each email type. Use placeholders like <code className="bg-muted px-1 py-0.5 rounded">{'{{orderId}}'}</code> in subject lines.
              </p>

              <Accordion type="single" collapsible className="w-full">
                {TEMPLATE_TYPES.map((type) => {
                  const template = config.templates[type];
                  const meta = TEMPLATE_LABELS[type];

                  return (
                    <AccordionItem key={type} value={type}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={template.enabled}
                            onCheckedChange={(checked) => {
                              updateTemplate(type, { enabled: checked });
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="text-left">
                            <div className="font-medium">{meta.title}</div>
                            <div className="text-xs text-muted-foreground font-normal">
                              {meta.description}
                            </div>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-4 space-y-4">
                        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                          <strong>Available placeholders:</strong> {meta.placeholders}
                        </div>

                        <div className="space-y-2">
                          <Label>Subject Line</Label>
                          <Input
                            value={template.subject}
                            onChange={(e) => updateTemplate(type, { subject: e.target.value })}
                            placeholder="Email subject..."
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Heading</Label>
                          <Input
                            value={template.heading}
                            onChange={(e) => updateTemplate(type, { heading: e.target.value })}
                            placeholder="Main heading in email body..."
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Body Text</Label>
                          <Textarea
                            value={template.bodyText}
                            onChange={(e) => updateTemplate(type, { bodyText: e.target.value })}
                            placeholder="Intro paragraph..."
                            rows={2}
                          />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Button Text</Label>
                            <Input
                              value={template.buttonText}
                              onChange={(e) => updateTemplate(type, { buttonText: e.target.value })}
                              placeholder="View Order in Admin"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Button URL (optional)</Label>
                            <Input
                              value={template.buttonUrl || ''}
                              onChange={(e) => updateTemplate(type, { buttonUrl: e.target.value || undefined })}
                              placeholder="Leave empty for default"
                            />
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Floating save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 shadow-lg z-50">
          <div className="container mx-auto flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">You have unsaved changes</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset} disabled={saving}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add padding at bottom when save bar is visible */}
      {hasChanges && <div className="h-20" />}

      <DiagnosticsPanel
        pageName="email-config"
        data={{ config, hasChanges }}
        className="mt-8"
      />
    </div>
  );
}
