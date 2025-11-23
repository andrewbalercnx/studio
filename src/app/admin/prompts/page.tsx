'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { PromptConfig } from '@/lib/types';


const samplePrompts: PromptConfig[] = [
    {
        id: "warmup_level_low_v1",
        phase: "warmup",
        levelBand: "low",
        languageCode: "en-GB",
        version: 1,
        status: "draft",
        systemPrompt: "(placeholder system prompt for warmup low level)",
        modeInstructions: "(placeholder mode instructions for warmup low level)",
        additionalContextTemplate: {
            placeholders: ["childName", "favouriteThings"]
        },
        allowedChatMoves: ["ask_short_question", "ask_for_two_sentences"],
        model: {
            name: "gemini-2.5-pro",
            temperature: 0.6,
            maxOutputTokens: 200,
        }
    },
    {
        id: "warmup_level_med_v1",
        phase: "warmup",
        levelBand: "medium",
        languageCode: "en-GB",
        version: 1,
        status: "draft",
        systemPrompt: "(placeholder system prompt for warmup medium level)",
        modeInstructions: "(placeholder mode instructions for warmup medium level)",
        additionalContextTemplate: {
            placeholders: ["childName", "favouriteThings", "recentStoryVibe"]
        },
        allowedChatMoves: ["ask_short_question", "ask_for_three_sentences", "summarise_child_answer_back"],
        model: {
            name: "gemini-2.5-pro",
            temperature: 0.6,
            maxOutputTokens: 250,
        }
    },
    {
        id: "warmup_level_high_v1",
        phase: "warmup",
        levelBand: "high",
        languageCode: "en-GB",
        version: 1,
        status: "draft",
        systemPrompt: "(placeholder system prompt for warmup high level)",
        modeInstructions: "(placeholder mode instructions for warmup high level)",
        additionalContextTemplate: {
            placeholders: ["childName", "favouriteThings", "recentStoryVibe"]
        },
        allowedChatMoves: ["ask_open_question", "summarise_child_answer_back"],
        model: {
            name: "gemini-2.5-pro",
            temperature: 0.7,
            maxOutputTokens: 300,
        }
    }
];

export default function AdminPromptsPage() {
  const { isAuthenticated, isAdmin, email, loading: authLoading } = useAdminStatus();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<PromptConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firestore || !isAdmin) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    const promptsRef = collection(firestore, 'promptConfigs');
    const unsubscribe = onSnapshot(promptsRef, 
      (snapshot) => {
        const promptList = snapshot.docs.map(d => d.data() as PromptConfig);
        setPrompts(promptList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching prompt configs:", err);
        setError("Could not fetch prompt configs.");
        setPrompts([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, isAdmin]);
  
  const handleCreateSampleConfigs = async () => {
    if (!firestore) return;
    try {
        const batch = writeBatch(firestore);
        samplePrompts.forEach(p => {
            const docRef = doc(firestore, "promptConfigs", p.id);
            batch.set(docRef, p);
        });
        await batch.commit();
        toast({ title: 'Success', description: 'Sample prompt configs created.' });
    } catch (e: any) {
        console.error("Error creating sample configs:", e);
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };


  const diagnostics = {
    page: 'admin-prompts',
    auth: {
      isAuthenticated,
      email,
      isAdmin,
      loading: authLoading,
      error: null, // useAdminStatus hook error
    },
    firestore: {
        collection: 'promptConfigs',
        count: prompts.length,
        sampleIds: prompts.slice(0, 3).map(p => p.id),
    },
    ...(error ? { firestoreError: error } : {})
  };

  const renderContent = () => {
    if (authLoading || loading) {
      return <div className="flex items-center gap-2"><LoaderCircle className="h-5 w-5 animate-spin" /><span>Loading prompt configs...</span></div>;
    }
    if (!isAuthenticated) {
      return <p>You must be signed in to access admin pages.</p>;
    }
    if (!isAdmin) {
      return <p>You are signed in but do not have admin rights.</p>;
    }
    if (error) {
        return <p className="text-destructive">{error}</p>;
    }
    if (prompts.length === 0) {
        return (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground mb-4">No prompt configs found.</p>
                <Button onClick={handleCreateSampleConfigs}>Create sample configs</Button>
            </div>
        )
    }

    return (
      <Table>
          <TableHeader>
              <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Level Band</TableHead>
                  <TableHead>Status</TableHead>
              </TableRow>
          </TableHeader>
          <TableBody>
              {prompts.map((prompt) => (
                  <TableRow key={prompt.id}>
                      <TableCell className="font-mono">{prompt.id}</TableCell>
                      <TableCell>{prompt.phase}</TableCell>
                      <TableCell>{prompt.levelBand}</TableCell>
                      <TableCell>{prompt.status}</TableCell>
                  </TableRow>
              ))}
          </TableBody>
      </Table>
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
