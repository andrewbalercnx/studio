'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const stubPrompts = [
    { id: 'warmup_level_low_v1', phase: 'warmup', levelBand: 'low' },
    { id: 'warmup_level_med_v1', phase: 'warmup', levelBand: 'medium' },
];

export default function AdminPromptsPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();

  const diagnostics = {
    page: 'admin-prompts',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading,
      error,
    },
    stubData: {
      itemsSampled: stubPrompts.length,
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
        <div>
            <p className="mb-4">This is a placeholder list. Real data will be connected later.</p>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Phase</TableHead>
                        <TableHead>Level Band</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {stubPrompts.map((prompt) => (
                        <TableRow key={prompt.id}>
                            <TableCell className="font-mono">{prompt.id}</TableCell>
                            <TableCell>{prompt.phase}</TableCell>
                            <TableCell>{prompt.levelBand}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Prompt Configs</CardTitle>
          <CardDescription>
            List of available prompt configurations for the AI.
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