
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, PlusCircle, BookOpen, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, orderBy, writeBatch, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { HelpWizard } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SampleWizardData from '@/data/help-wizards.json';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { HelpWizardForm } from '@/components/admin/HelpWizardForm';

export default function AdminHelpWizardsPage() {
  const { isAuthenticated, isAdmin, isWriter, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [wizards, setWizards] = useState<HelpWizard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWizard, setEditingWizard] = useState<HelpWizard | null>(null);

  const handleSeedWizards = useCallback(async () => {
    if (!firestore) return;
    setLoading(true);
    try {
      const batch = writeBatch(firestore);
      SampleWizardData.wizards.forEach((wizard) => {
        const docRef = doc(firestore, 'helpWizards', wizard.id);
        batch.set(docRef, {
          ...wizard,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      toast({ title: 'Success', description: 'Sample help wizards have been seeded.' });
    } catch (e: any) {
      toast({ title: 'Error seeding data', description: e.message, variant: 'destructive' });
    } finally {
        // setLoading(false) is handled by the onSnapshot listener which will fire after seeding
    }
  }, [firestore, toast]);

  useEffect(() => {
    if (!firestore || (!isAdmin && !isWriter)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const wizardsRef = collection(firestore, 'helpWizards');
    const q = query(wizardsRef, orderBy('order', 'asc'));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        if (snapshot.empty) {
          handleSeedWizards();
        } else {
          setWizards(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as HelpWizard)));
          setLoading(false);
        }
        setError(null);
      },
      (err) => {
        setError('Could not fetch help wizards. You may need to seed them first.');
        setLoading(false);
        console.error("Firestore onSnapshot error:", err);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin, isWriter, handleSeedWizards]);

  const handleOpenForm = (wizard: HelpWizard | null = null) => {
    setEditingWizard(wizard);
    setIsFormOpen(true);
  };

  const renderContent = () => {
    if (authLoading || loading) return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading wizards...</span></div>;
    if (!isAuthenticated || (!isAdmin && !isWriter)) return <p>Admin or writer access required.</p>;

    if (wizards.length === 0) {
      return (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-muted-foreground mb-4">{error || 'No help wizards found.'}</p>
          <Button onClick={handleSeedWizards}>Seed Sample Wizards</Button>
        </div>
      );
    }

    return (
      <Accordion type="single" collapsible className="w-full">
        {wizards.map((wizard) => (
          <AccordionItem key={wizard.id} value={wizard.id}>
            <div className="flex items-center w-full">
              <AccordionTrigger className="flex-grow pr-4">
                <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    <span>{wizard.title}</span>
                    <Badge variant={wizard.status === 'live' ? 'default' : 'secondary'} className="ml-2">
                      {wizard.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-2">#{wizard.order ?? 0}</span>
                </div>
              </AccordionTrigger>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={(e) => { e.stopPropagation(); handleOpenForm(wizard);}}>
                  <Edit className="h-4 w-4 mr-2" /> Edit
              </Button>
            </div>
            <AccordionContent>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                {wizard.pages.map((page, index) => (
                  <li key={index}>
                    <span className="font-semibold">{page.title}</span> ({page.route})
                    <p className="text-muted-foreground pl-5">{page.description}</p>
                  </li>
                ))}
              </ol>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingWizard ? 'Edit Help Wizard' : 'New Help Wizard'}</DialogTitle>
            <DialogDescription>
              {editingWizard ? `Editing "${editingWizard.title}"` : 'Create a new guided tour for users.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <HelpWizardForm
              wizard={editingWizard}
              onSave={() => setIsFormOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
      
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Help Wizards</h1>
          <p className="text-muted-foreground">Manage the guided tours for users.</p>
        </div>
        <Button onClick={() => handleOpenForm()}>
          <PlusCircle className="mr-2" /> Add New
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
