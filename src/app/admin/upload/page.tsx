'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { PromptConfig } from '@/lib/types';

type ValidationResultItem = {
  id: string | null;
  isValid: boolean;
  errors: string[];
};

type ValidationState = {
  lastAction: 'none' | 'parsed' | 'parse_error';
  inputLength: number;
  parseOk: boolean;
  itemCount: number;
  validCount: number;
  errorMessage: string | null;
  results: ValidationResultItem[];
};

const initialValidationState: ValidationState = {
  lastAction: 'none',
  inputLength: 0,
  parseOk: false,
  itemCount: 0,
  validCount: 0,
  errorMessage: null,
  results: [],
};

const requiredFields: (keyof PromptConfig)[] = [
    'id', 'phase', 'levelBand', 'languageCode', 'version', 
    'status', 'systemPrompt', 'modeInstructions'
];
const fieldTypes: { [key in keyof PromptConfig]?: string } = {
    'id': 'string',
    'phase': 'string',
    'levelBand': 'string',
    'languageCode': 'string',
    'version': 'number',
    'status': 'string',
    'systemPrompt': 'string',
    'modeInstructions': 'string',
    'allowedChatMoves': 'array'
};

export default function AdminUploadPage() {
  const { isAuthenticated, isAdmin, email, loading, error } = useAdminStatus();
  const [jsonInput, setJsonInput] = useState('');
  const [validation, setValidation] = useState<ValidationState>(initialValidationState);

  const handleValidate = () => {
    let parsedJson: any;
    try {
      parsedJson = JSON.parse(jsonInput);
    } catch (e: any) {
      setValidation({
        ...initialValidationState,
        lastAction: 'parse_error',
        inputLength: jsonInput.length,
        parseOk: false,
        errorMessage: e.message,
      });
      return;
    }

    const items = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
    const results: ValidationResultItem[] = items.map((item: any) => {
      const itemErrors: string[] = [];
      if (typeof item !== 'object' || item === null) {
        itemErrors.push('Item is not a valid object.');
        return { id: null, isValid: false, errors: itemErrors };
      }

      for (const field of requiredFields) {
        if (item[field] === undefined) {
          itemErrors.push(`Missing required field: ${field}`);
        } else {
            const expectedType = fieldTypes[field];
            const actualType = Array.isArray(item[field]) ? 'array' : typeof item[field];
            if (expectedType && actualType !== expectedType) {
                itemErrors.push(`Field '${field}' has wrong type. Expected ${expectedType}, got ${actualType}.`);
            }
        }
      }
      
      if (item.allowedChatMoves && !Array.isArray(item.allowedChatMoves)) {
          itemErrors.push(`Field 'allowedChatMoves' must be an array.`);
      }


      return {
        id: item.id || 'N/A',
        isValid: itemErrors.length === 0,
        errors: itemErrors,
      };
    });

    const validCount = results.filter(r => r.isValid).length;
    setValidation({
      lastAction: 'parsed',
      inputLength: jsonInput.length,
      parseOk: true,
      itemCount: items.length,
      validCount: validCount,
      errorMessage: null,
      results,
    });
  };

  const diagnostics = {
    page: 'admin-upload',
    auth: { isAuthenticated, email, isAdmin, loading, error },
    ui: { hasTextarea: true, hasValidateButton: true },
    validation: {
        lastAction: validation.lastAction,
        inputLength: jsonInput.length,
        parseOk: validation.parseOk,
        itemCount: validation.itemCount,
        validCount: validation.validCount,
        errorMessage: validation.errorMessage,
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
          value={jsonInput}
          onChange={e => setJsonInput(e.target.value)}
        />
        <Button onClick={handleValidate}>Validate JSON</Button>
        {validation.lastAction !== 'none' && renderValidationResults()}
      </div>
    );
  };
  
  const renderValidationResults = () => {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Validation Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-4 text-sm">
                    <div>Parse Status: {validation.parseOk ? <Badge>OK</Badge> : <Badge variant="destructive">Failed</Badge>}</div>
                    {validation.parseOk ? (
                        <>
                         <div>Items found: <Badge variant="secondary">{validation.itemCount}</Badge></div>
                         <div>Valid items: <Badge variant={validation.validCount === validation.itemCount ? 'default' : 'destructive'}>{validation.validCount}</Badge></div>
                        </>
                    ) : (
                        <p className="text-destructive font-mono">{validation.errorMessage}</p>
                    )}
                </div>
                {validation.results.length > 0 && (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Index</TableHead>
                                <TableHead>ID</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Errors</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {validation.results.map((result, index) => (
                                <TableRow key={index}>
                                    <TableCell>{index}</TableCell>
                                    <TableCell className="font-mono">{result.id || 'N/A'}</TableCell>
                                    <TableCell>
                                        {result.isValid ? <Badge>Valid</Badge> : <Badge variant="destructive">Invalid</Badge>}
                                    </TableCell>
                                    <TableCell>
                                        {result.errors.join(', ')}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
  }

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
