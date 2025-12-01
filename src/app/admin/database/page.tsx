
'use client';

import { useState } from 'react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  limit,
  orderBy,
  doc,
  documentId,
  Query,
  DocumentData,
  QueryConstraint,
} from 'firebase/firestore';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Trash2, Search, FileJson } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import backendConfig from '@/../docs/backend.json';

const COLLECTIONS = Object.keys(backendConfig.firestore)
  .map(path => path.split('/')[1]) // Get the root collection name
  .filter((value, index, self) => self.indexOf(value) === index) // Get unique names
  .sort();

const DOCUMENT_ID_ALIASES = ['id', 'docId', 'documentId', '__name__'];

type DocumentMeta = {
  exists: boolean;
  createTime: string | null;
  updateTime: string | null;
  readTime: string | null;
};

type ServerListedDocument = {
  id: string;
  exists: boolean;
  data: Record<string, any> | null;
  createTime: string | null;
  updateTime: string | null;
  readTime: string | null;
};

type DocumentDataWithId = {
  id: string;
  __meta?: DocumentMeta;
  __missingDoc?: boolean;
  [key: string]: any;
};

type FilterOperator = '==' | 'exists';

export default function AdminDatabasePage() {
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [selectedCollection, setSelectedCollection] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterOperator, setFilterOperator] = useState<FilterOperator>('==');
  const [filterValue, setFilterValue] = useState('');
  const [documents, setDocuments] = useState<DocumentDataWithId[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [viewingDoc, setViewingDoc] = useState<DocumentDataWithId | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isValueInputDisabled = filterOperator === 'exists';

  const fetchDocumentsFromAdmin = async (collectionName: string): Promise<DocumentDataWithId[]> => {
    if (!user) {
      throw new Error('You must be signed in to query documents.');
    }

    const idToken = await user.getIdToken();
    const response = await fetch('/api/admin/database/listDocuments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ collection: collectionName, limit: 200 }),
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? 'Failed to fetch documents.');
    }

    const documents: ServerListedDocument[] = payload.documents ?? [];
    return documents.map((doc) => {
      const data = (doc.data && typeof doc.data === 'object') ? doc.data : {};
      return {
        id: doc.id,
        ...data,
        __missingDoc: !doc.exists,
        __meta: {
          exists: doc.exists,
          createTime: doc.createTime,
          updateTime: doc.updateTime,
          readTime: doc.readTime,
        },
      } as DocumentDataWithId;
    });
  };

  const handleSearch = async () => {
    if (!selectedCollection) {
      toast({
        title: 'Missing Information',
        description: 'Please select a collection to search.',
        variant: 'destructive',
      });
      return;
    }

    const trimmedField = filterField.trim();
    const trimmedValue = filterValue.trim();
    const isDocumentIdField = DOCUMENT_ID_ALIASES.includes(trimmedField);
    const fieldReference = trimmedField
      ? (isDocumentIdField ? documentId() : trimmedField)
      : null;
    const hasFilter =
      Boolean(trimmedField) &&
      (filterOperator === 'exists' || Boolean(trimmedValue));

    if (hasFilter && !firestore) {
      toast({
        title: 'Firestore not ready',
        description: 'Please wait for Firestore to initialize and try again.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setDocuments([]);
    setSelectedDocs(new Set());
    setViewingDoc(null);

    try {
      if (!hasFilter) {
        const fetchedDocs = await fetchDocumentsFromAdmin(selectedCollection);
        setDocuments(fetchedDocs);
        if (fetchedDocs.length === 0) {
          toast({ title: 'No documents found matching your query.' });
        }
        return;
      }

      const db = firestore;
      if (!db) {
        throw new Error('Firestore is not initialized.');
      }

      const collRef = collection(db, selectedCollection);
      const constraints: QueryConstraint[] = [];

      if (fieldReference) {
        if (filterOperator === 'exists') {
          constraints.push(where(fieldReference, '!=', null));
          constraints.push(orderBy(fieldReference));
          if (!isDocumentIdField) {
            constraints.push(orderBy(documentId()));
          }
        } else {
          constraints.push(where(fieldReference, '==', trimmedValue));
          constraints.push(orderBy(documentId()));
        }
      } else {
        constraints.push(orderBy(documentId()));
      }

      constraints.push(limit(200));

      const q: Query<DocumentData, DocumentData> = query(collRef, ...constraints);

      const querySnapshot = await getDocs(q);
      const fetchedDocs = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setDocuments(fetchedDocs);

      if (fetchedDocs.length === 0) {
        toast({ title: 'No documents found matching your query.' });
      }
    } catch (error: any) {
      console.error('Error searching documents:', error);
      toast({
        title: 'Search Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!firestore || selectedDocs.size === 0) return;

    setIsDeleting(true);
    try {
      const batch = writeBatch(firestore);
      selectedDocs.forEach((docId) => {
        const docRef = doc(firestore, selectedCollection, docId);
        batch.delete(docRef);
      });
      await batch.commit();
      toast({
        title: 'Success',
        description: `${selectedDocs.size} documents deleted.`,
      });
      // Refresh the list after deletion
      setDocuments(prev => prev.filter(doc => !selectedDocs.has(doc.id)));
      setSelectedDocs(new Set());

    } catch (error: any) {
      toast({
        title: 'Deletion Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleSelectAll = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      const allIds = new Set(documents.map((doc) => doc.id));
      setSelectedDocs(allIds);
    } else {
      setSelectedDocs(new Set());
    }
  };

  const isAllSelected = documents.length > 0 && selectedDocs.size === documents.length;

  if (adminLoading) {
    return <div className="flex justify-center items-center h-screen"><LoaderCircle className="h-8 w-8 animate-spin" /></div>;
  }
  if (!isAdmin) {
    return <div className="p-8 text-center text-destructive">Admin access required.</div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Database Manager</CardTitle>
          <CardDescription>
            Query and delete documents from Firestore collections. Use with caution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-background space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label htmlFor="collection">Collection</Label>
                <Select onValueChange={setSelectedCollection} value={selectedCollection}>
                  <SelectTrigger id="collection">
                    <SelectValue placeholder="Select a collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {COLLECTIONS.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="field">Field (optional)</Label>
                <Input id="field" placeholder="e.g., email" value={filterField} onChange={(e) => setFilterField(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="operator">Operator</Label>
                <Select onValueChange={(v) => setFilterOperator(v as any)} value={filterOperator}>
                  <SelectTrigger id="operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="==">Equals</SelectItem>
                    <SelectItem value="exists">Exists</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Value (optional)</Label>
                <Input 
                  id="value"
                  placeholder="Value to match"
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  disabled={isValueInputDisabled}
                />
              </div>
            </div>
            <div className="flex gap-2">
                <Button onClick={handleSearch} disabled={isLoading}>
                    {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Search
                </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">
                  {documents.length > 0 ? `Found ${documents.length} documents` : 'No documents found'}
                </h3>
                <Button variant="destructive" onClick={handleDelete} disabled={selectedDocs.size === 0 || isDeleting}>
                  {isDeleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete ({selectedDocs.size})
                </Button>
              </div>
              <Card>
                <ScrollArea className="h-96">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={toggleSelectAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead>Document ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((docData) => (
                        <TableRow 
                          key={docData.id}
                          onClick={() => setViewingDoc(docData)}
                          className="cursor-pointer"
                          data-state={viewingDoc?.id === docData.id ? 'selected' : undefined}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedDocs.has(docData.id)}
                              onCheckedChange={(checked) => {
                                setSelectedDocs((prev) => {
                                  const newSet = new Set(prev);
                                  if (checked) {
                                    newSet.add(docData.id);
                                  } else {
                                    newSet.delete(docData.id);
                                  }
                                  return newSet;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {docData.id}
                            {docData.__missingDoc && (
                              <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                                empty
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </Card>
            </div>

            <div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Document Viewer</h3>
                 <Card>
                   <ScrollArea className="h-96">
                    <CardContent className="pt-6">
                      {viewingDoc ? (
                        <>
                          {viewingDoc.__missingDoc && (
                            <div className="mb-4 rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-xs text-muted-foreground">
                              This document has no stored fields and only exists because one or more subcollections contain data.
                            </div>
                          )}
                          <pre className="text-xs font-mono bg-muted p-4 rounded-md">
                            <code>{JSON.stringify(viewingDoc, null, 2)}</code>
                          </pre>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-center p-8">
                          <FileJson className="h-10 w-10 mb-4"/>
                          <p>Select a document from the list to view its contents.</p>
                        </div>
                      )}
                    </CardContent>
                  </ScrollArea>
                 </Card>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
