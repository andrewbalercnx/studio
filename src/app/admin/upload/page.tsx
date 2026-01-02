
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { PromptConfig } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { writeBatch, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

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

type SaveState = {
  lastAction: 'none' | 'save_started' | 'save_success' | 'save_error';
  attemptedCount: number;
  savedCount: number;
  errorMessage: string | null;
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

const initialSaveState: SaveState = {
    lastAction: 'none',
    attemptedCount: 0,
    savedCount: 0,
    errorMessage: null,
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
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const [jsonInput, setJsonInput] = useState('');
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [validation, setValidation] = useState<ValidationState>(initialValidationState);
  const [saveState, setSaveState] = useState<SaveState>(initialSaveState);

  const handleValidate = () => {
    // Reset save state on new validation
    setSaveState(initialSaveState);
    
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
      setParsedItems([]);
      return;
    }

    const items = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
    setParsedItems(items); // Store successfully parsed items
    
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

  const handleSaveToFirestore = async () => {
    if (!firestore || !isAdmin || validation.validCount === 0) return;

    setSaveState({
        lastAction: 'save_started',
        attemptedCount: validation.validCount,
        savedCount: 0,
        errorMessage: null,
    });

    try {
        const batch = writeBatch(firestore);
        const validItems = parsedItems.filter((_, index) => validation.results[index].isValid);

        validItems.forEach((item) => {
            const docRef = doc(firestore, 'promptConfigs', item.id);
            batch.set(docRef, item);
        });

        await batch.commit();

        setSaveState({
            lastAction: 'save_success',
            attemptedCount: validItems.length,
            savedCount: validItems.length,
            errorMessage: null,
        });
        toast({
            title: 'Save Successful',
            description: `${validItems.length} prompt configs saved to Firestore.`,
        });

    } catch (e: any) {
        setSaveState({
            lastAction: 'save_error',
            attemptedCount: validation.validCount,
            savedCount: 0,
            errorMessage: e.message,
        });
        toast({
            title: 'Save Error',
            description: e.message,
            variant: 'destructive',
        });
    }
  };

  const isSaveDisabled = !isAdmin || !validation.parseOk || validation.validCount === 0;

  const diagnostics = {
    page: 'admin-upload',
    auth: { isAuthenticated, email, isAdmin, loading, error },
    ui: {
        hasTextarea: true,
        hasValidateButton: true,
        hasSaveButton: true,
    },
    validation: {
        lastAction: validation.lastAction,
        inputLength: jsonInput.length,
        parseOk: validation.parseOk,
        itemCount: validation.itemCount,
        validCount: validation.validCount,
        errorMessage: validation.errorMessage,
    },
    save: saveState,
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
        <div className="flex gap-2">
            <Button onClick={handleValidate}>Validate JSON</Button>
            <Button onClick={handleSaveToFirestore} disabled={isSaveDisabled}>
                Save to Firestore
            </Button>
        </div>
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
                        <div className="text-destructive font-mono">{validation.errorMessage}</div>
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
      
      <DiagnosticsPanel pageName="admin-upload" data={diagnostics} className="mt-8" />
    </div>
  );
}
