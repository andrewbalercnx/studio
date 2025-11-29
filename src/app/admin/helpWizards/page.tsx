
'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, PlusCircle, Copy, BookOpen } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, orderBy, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { HelpWizard } from '@/lib/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import SampleWizardData from '@/data/help-wizards.json';

export default function AdminHelpWizardsPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [wizards, setWizards] = useState<HelpWizard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSeedWizards = useCallback(async () => {
    if (!firestore) return;
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
    }
  }, [firestore, toast]);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const wizardsRef = collection(firestore, 'helpWizards');
    const q = query(wizardsRef, orderBy('title', 'asc'));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        setWizards(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as HelpWizard)));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError('Could not fetch help wizards. You may need to seed them first.');
        setLoading(false);
        console.error("Firestore onSnapshot error:", err);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);

  const renderContent = () => {
    if (authLoading || loading) return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading wizards...</span></div>;
    if (!isAuthenticated || !isAdmin) return <p>Admin access required.</p>;

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
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <span>{wizard.title}</span>
              </div>
            </AccordionTrigger>
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Help Wizards</h1>
          <p className="text-muted-foreground">Manage the guided tours for users.</p>
        </div>
        <Button onClick={() => {}} disabled>
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
