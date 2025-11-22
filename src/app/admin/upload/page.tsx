'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

export default function AdminUploadPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();

  const diagnostics = {
    page: 'admin-upload',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading,
      error,
    },
    ui: {
        hasTextarea: true,
        hasValidateButtonStub: true
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
        <div className="space-y-4">
            <p>Paste JSON here to upload prompt configurations.</p>
            <Textarea 
                placeholder='{ "id": "example-prompt", "phase": "warmup", ... }'
                rows={10}
            />
            <Button disabled>Validate JSON</Button>
        </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Upload JSON Config</CardTitle>
          <CardDescription>
            Bulk upload or update prompt configurations from a JSON object.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
      
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
            <code>{JSON.stringify(diagnostics, null, 2)}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}