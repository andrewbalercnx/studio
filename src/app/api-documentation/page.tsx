'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoaderCircle, FileText, Database, Server, ShieldAlert } from 'lucide-react';

// API route definitions organized by category
const API_ROUTES = {
  parent: [
    { method: 'POST', path: '/api/parent/set-pin', description: 'Set or update parent PIN' },
    { method: 'POST', path: '/api/parent/verify-pin', description: 'Verify parent PIN' },
  ],
  children: [
    { method: 'POST', path: '/api/children/photos', description: 'Upload child photos' },
  ],
  characters: [
    { method: 'POST', path: '/api/characters/create', description: 'Create a new character' },
    { method: 'POST', path: '/api/characters/photos', description: 'Upload character photos' },
    { method: 'POST', path: '/api/characterTraits', description: 'Generate character traits via AI' },
  ],
  story: [
    { method: 'POST', path: '/api/warmupReply', description: 'Generate warmup phase response' },
    { method: 'POST', path: '/api/storyBeat', description: 'Generate story beat options' },
    { method: 'POST', path: '/api/storyArc', description: 'Generate or retrieve story arc' },
    { method: 'POST', path: '/api/storyEnding', description: 'Generate story ending options' },
    { method: 'POST', path: '/api/storyCompile', description: 'Compile story from session' },
    { method: 'POST', path: '/api/gemini3', description: 'Gemini 3 story generation' },
    { method: 'POST', path: '/api/gemini4', description: 'Gemini 4 story generation' },
    { method: 'GET', path: '/api/kids-flows', description: 'Get available story flows' },
  ],
  storybook: [
    { method: 'GET', path: '/api/storyBook/[bookId]', description: 'Get storybook details' },
    { method: 'PATCH', path: '/api/storyBook/[bookId]', description: 'Update storybook' },
    { method: 'POST', path: '/api/storyBook/share', description: 'Create/manage share link' },
    { method: 'POST', path: '/api/storyBook/audio', description: 'Generate full audio narration' },
    { method: 'POST', path: '/api/storyBook/pageAudio', description: 'Generate page audio' },
    { method: 'POST', path: '/api/storyBook/printable', description: 'Generate printable PDF' },
    { method: 'POST', path: '/api/storyBook/actorAvatar', description: 'Generate composite avatar' },
    { method: 'POST', path: '/api/storybookV2/pages', description: 'Generate storybook pages' },
    { method: 'POST', path: '/api/storybookV2/images', description: 'Generate storybook images' },
    { method: 'POST', path: '/api/storybookV2/finalize', description: 'Finalize storybook for print' },
  ],
  avatar: [
    { method: 'POST', path: '/api/generateAvatar', description: 'Generate avatar from photo' },
    { method: 'POST', path: '/api/generateAvatar/animation', description: 'Generate animated avatar' },
    { method: 'POST', path: '/api/generateCharacterAvatar', description: 'Generate character avatar' },
  ],
  print: [
    { method: 'GET', path: '/api/printOrders/products', description: 'Get print products catalog' },
    { method: 'GET', path: '/api/printOrders/my-orders', description: 'Get user\'s print orders' },
    { method: 'POST', path: '/api/printOrders', description: 'Create print order' },
    { method: 'POST', path: '/api/printOrders/[orderId]/pay', description: 'Mark order as paid' },
    { method: 'POST', path: '/api/printOrders/mixam', description: 'Get Mixam pricing quote' },
    { method: 'POST', path: '/api/printStoryBooks/[id]/auto-layout', description: 'Auto-layout print pages' },
    { method: 'POST', path: '/api/printStoryBooks/[id]/generate-pdfs', description: 'Generate print PDFs' },
  ],
  voice: [
    { method: 'POST', path: '/api/voices/preview', description: 'Preview voice sample' },
    { method: 'POST', path: '/api/tts', description: 'Generate text-to-speech' },
  ],
  user: [
    { method: 'GET', path: '/api/user/shipping-address', description: 'Get saved shipping address' },
    { method: 'PUT', path: '/api/user/shipping-address', description: 'Save shipping address' },
  ],
  admin: [
    { method: 'GET', path: '/api/admin/print-orders', description: 'List all print orders', admin: true },
    { method: 'GET', path: '/api/admin/print-orders/[orderId]', description: 'Get order details', admin: true },
    { method: 'POST', path: '/api/admin/print-orders/[orderId]/approve', description: 'Approve order', admin: true },
    { method: 'POST', path: '/api/admin/print-orders/[orderId]/reject', description: 'Reject order', admin: true },
    { method: 'POST', path: '/api/admin/print-orders/[orderId]/submit', description: 'Submit to Mixam', admin: true },
    { method: 'POST', path: '/api/admin/print-orders/[orderId]/reset', description: 'Reset order status', admin: true },
    { method: 'POST', path: '/api/admin/print-orders/[orderId]/refresh-status', description: 'Refresh from Mixam', admin: true },
    { method: 'GET', path: '/api/admin/system-config/prompts', description: 'Get global prompts', admin: true },
    { method: 'PUT', path: '/api/admin/system-config/prompts', description: 'Update global prompts', admin: true },
    { method: 'GET', path: '/api/admin/system-config/compile-prompt', description: 'Get compile prompt', admin: true },
    { method: 'PUT', path: '/api/admin/system-config/compile-prompt', description: 'Update compile prompt', admin: true },
    { method: 'GET', path: '/api/admin/system-config/kids-flows', description: 'Get kids flows config', admin: true },
    { method: 'PUT', path: '/api/admin/system-config/kids-flows', description: 'Update kids flows', admin: true },
    { method: 'POST', path: '/api/admin/system-config/seed', description: 'Seed system config', admin: true },
    { method: 'POST', path: '/api/admin/print-products/seed', description: 'Seed print products', admin: true },
    { method: 'POST', path: '/api/admin/print-products/validate-mixam', description: 'Validate Mixam mapping', admin: true },
    { method: 'GET', path: '/api/admin/mixam-catalogue', description: 'Fetch Mixam catalogue', admin: true },
    { method: 'GET', path: '/api/admin/token-usage', description: 'Get token usage stats', admin: true },
    { method: 'POST', path: '/api/admin/database/listDocuments', description: 'List Firestore documents', admin: true },
    { method: 'POST', path: '/api/admin/audit-collections', description: 'Audit collections', admin: true },
    { method: 'POST', path: '/api/imageStyles/seed', description: 'Seed image styles', admin: true },
    { method: 'POST', path: '/api/imageStyles/generateSample', description: 'Generate style sample', admin: true },
  ],
  webhook: [
    { method: 'POST', path: '/api/webhooks/mixam', description: 'Mixam order status webhook', webhook: true },
  ],
};

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800',
  POST: 'bg-green-100 text-green-800',
  PUT: 'bg-yellow-100 text-yellow-800',
  PATCH: 'bg-orange-100 text-orange-800',
  DELETE: 'bg-red-100 text-red-800',
};

function RouteTable({ routes }: { routes: typeof API_ROUTES.parent }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium">Method</th>
            <th className="text-left py-2 px-3 font-medium">Path</th>
            <th className="text-left py-2 px-3 font-medium">Description</th>
            <th className="text-left py-2 px-3 font-medium">Auth</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route, idx) => (
            <tr key={idx} className="border-b hover:bg-muted/50">
              <td className="py-2 px-3">
                <Badge variant="outline" className={METHOD_COLORS[route.method]}>
                  {route.method}
                </Badge>
              </td>
              <td className="py-2 px-3 font-mono text-xs">{route.path}</td>
              <td className="py-2 px-3">{route.description}</td>
              <td className="py-2 px-3">
                {'admin' in route && route.admin ? (
                  <Badge variant="destructive" className="text-xs">Admin</Badge>
                ) : 'webhook' in route && route.webhook ? (
                  <Badge variant="secondary" className="text-xs">Webhook</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">User</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiDocumentationPage() {
  const router = useRouter();
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const { showApiDocumentation, loading: diagnosticsLoading } = useDiagnostics();
  const [redirecting, setRedirecting] = useState(false);

  // Redirect if API documentation is disabled or user is not authenticated
  useEffect(() => {
    if (!authLoading && !diagnosticsLoading) {
      if (!isAuthenticated || !showApiDocumentation) {
        setRedirecting(true);
        router.push('/');
      }
    }
  }, [authLoading, diagnosticsLoading, isAuthenticated, showApiDocumentation, router]);

  if (authLoading || diagnosticsLoading || redirecting) {
    return (
      <div className="container mx-auto p-8 flex items-center justify-center min-h-[50vh]">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!showApiDocumentation) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              API Documentation Disabled
            </CardTitle>
            <CardDescription>
              API documentation is currently disabled. Enable it in Admin &gt; Diagnostics &amp; Logging.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 max-w-6xl">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6" />
            API Documentation
          </CardTitle>
          <CardDescription>
            StoryPic Kids API reference. All endpoints require Firebase authentication unless noted.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">User</Badge>
              <span>Requires authenticated user</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive" className="text-xs">Admin</Badge>
              <span>Requires admin role</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Webhook</Badge>
              <span>External webhook signature</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="story" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="story">Story</TabsTrigger>
          <TabsTrigger value="storybook">Storybook</TabsTrigger>
          <TabsTrigger value="print">Print</TabsTrigger>
          <TabsTrigger value="characters">Characters</TabsTrigger>
          <TabsTrigger value="avatar">Avatar</TabsTrigger>
          <TabsTrigger value="parent">Parent</TabsTrigger>
          <TabsTrigger value="user">User</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
        </TabsList>

        <TabsContent value="story">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Story Session Routes</CardTitle>
              <CardDescription>Endpoints for interactive story creation</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.story} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="storybook">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Storybook Routes</CardTitle>
              <CardDescription>Endpoints for storybook generation and management</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.storybook} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="print">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Print Routes</CardTitle>
              <CardDescription>Endpoints for print ordering and PDF generation</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.print} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="characters">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Characters Routes</CardTitle>
              <CardDescription>Endpoints for character creation and management</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.characters} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="avatar">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Avatar Routes</CardTitle>
              <CardDescription>Endpoints for avatar generation</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.avatar} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parent">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Parent Routes</CardTitle>
              <CardDescription>Endpoints for parent-specific features</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.parent} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="user">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">User Routes</CardTitle>
              <CardDescription>Endpoints for user profile management</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={[...API_ROUTES.user, ...API_ROUTES.children]} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voice">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Voice Routes</CardTitle>
              <CardDescription>Endpoints for voice and TTS features</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.voice} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                Admin Routes
              </CardTitle>
              <CardDescription>Endpoints requiring admin or writer role</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.admin} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Webhook Routes</CardTitle>
              <CardDescription>Endpoints for external service webhooks</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteTable routes={API_ROUTES.webhook} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-5 w-5" />
            Full Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground mb-4">
            For complete API documentation including request/response schemas, see the docs folder:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">docs/API.md</code> - Full API reference</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">docs/SCHEMA.md</code> - Database schema documentation</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
