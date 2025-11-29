
'use client';

import { useState, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  limit,
  orderBy,
  startAt,
  endAt,
  doc,
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
import { LoaderCircle, Trash2, Search, AlertTriangle, FileJson } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const COLLECTIONS = [
  'users',
  'children',
  'storySessions',
  'characters',
  'promptConfigs',
  'storyPhases',
  'storyTypes',
  'storyOutputTypes',
  'storyBooks',
  'printOrders',
];

type DocumentData = {
  id: string;
  [key: string]: any;
};

export default function AdminDatabasePage() {
  const { isAdmin, loading: adminLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedCollection, setSelectedCollection] = useState('');
  const [filterField, setFilterField] = useState('');
  const [filterOperator, setFilterOperator] = useState<'==' | 'startsWith'>('==');
  const [filterValue, setFilterValue] = useState('');
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [viewingDoc, setViewingDoc] = useState<DocumentData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSearch = async () => {
    if (!firestore || !selectedCollection) {
      toast({
        title: 'Missing Information',
        description: 'Please select a collection to search.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoading(true);
    setDocuments([]);
    setSelectedDocs(new Set());
    setViewingDoc(null);
    try {
      const collRef = collection(firestore, selectedCollection);
      let q;
      if (filterField && filterValue) {
        if (filterOperator === 'startsWith') {
          q = query(
            collRef,
            orderBy(filterField),
            startAt(filterValue),
            endAt(filterValue + '\uf8ff'),
            limit(50)
          );
        } else {
          q = query(collRef, where(filterField, '==', filterValue), limit(50));
        }
      } else {
        q = query(collRef, limit(50));
      }

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
      handleSearch();
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
                    <SelectItem value="startsWith">Starts With</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Value (optional)</Label>
                <Input id="value" placeholder="Value to match" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
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
                          <TableCell className="font-mono text-xs">{docData.id}</TableCell>
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
                         <pre className="text-xs font-mono bg-muted p-4 rounded-md">
                           <code>{JSON.stringify(viewingDoc, null, 2)}</code>
                         </pre>
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
