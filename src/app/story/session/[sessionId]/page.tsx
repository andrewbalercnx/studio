
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Send } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';

type GenkitDiagnostics = {
    lastCallOk: boolean | null;
    lastErrorMessage: string | null;
    lastUsedPromptConfigId: string | null;
    lastAssistantTextPreview: string | null;
    debug: any | null; // Add debug field
}

export default function StorySessionPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = params.sessionId;
    const router = useRouter();
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();

    const [genkitDiagnostics, setGenkitDiagnostics] = useState<GenkitDiagnostics>({
        lastCallOk: null,
        lastErrorMessage: null,
        lastUsedPromptConfigId: null,
        lastAssistantTextPreview: null,
        debug: null,
    });
    
    const messagesQuery = firestore ? query(collection(firestore, `storySessions/${sessionId}/messages`), orderBy('createdAt')) : null;
    const { data: messages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    
    const handleSendMessage = async () => {
        if (!input.trim() || !firestore || !user) return;

        setIsSending(true);
        const childMessageText = input.trim();
        setInput('');

        const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
        try {
            // 1. Write child message to Firestore
            await addDoc(messagesRef, {
                sender: 'child',
                text: childMessageText,
                createdAt: serverTimestamp(),
            });

            // 2. Call warmup reply API
            const response = await fetch('/api/warmupReply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
            });

            const result = await response.json();

            if (response.ok && result.ok) {
                // 3. Write assistant message to Firestore
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: result.assistantText,
                    createdAt: serverTimestamp(),
                });
                 setGenkitDiagnostics({
                    lastCallOk: true,
                    lastErrorMessage: null,
                    lastUsedPromptConfigId: result.usedPromptConfigId,
                    lastAssistantTextPreview: result.assistantTextPreview || null,
                    debug: null,
                });
            } else {
                // 4. Handle API error
                const friendlyErrorMessage = 'The Story Guide is having trouble thinking of a reply. Please try again.';
                await addDoc(messagesRef, {
                    sender: 'assistant',
                    text: friendlyErrorMessage,
                    createdAt: serverTimestamp(),
                });
                toast({ title: 'API Error', description: result.errorMessage, variant: 'destructive' });
                setGenkitDiagnostics({
                    lastCallOk: false,
                    lastErrorMessage: result.errorMessage || 'An unknown error occurred.',
                    lastUsedPromptConfigId: result.usedPromptConfigId || null,
                    lastAssistantTextPreview: null,
                    debug: result.debug || null, // Store debug info
                });
            }

        } catch (e: any) {
            console.error("Error in send message flow:", e);
            const friendlyErrorMessage = 'The Story Guide is having trouble thinking of a reply. Please try again.';
            await addDoc(messagesRef, {
                sender: 'assistant',
                text: friendlyErrorMessage,
                createdAt: serverTimestamp(),
            });
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
             setGenkitDiagnostics({
                lastCallOk: false,
                lastErrorMessage: e.message,
                lastUsedPromptConfigId: null,
                lastAssistantTextPreview: null,
                debug: { clientError: true },
            });
        } finally {
            setIsSending(false);
        }
    };
    
    const diagnostics = {
        page: 'story-session',
        sessionId,
        auth: {
            isAuthenticated: !!user,
            email: user?.email || null,
        },
        firestore: {
            messagesCount: messages?.length || 0,
            firstMessageSender: messages && messages.length > 0 ? messages[0].sender : null,
            lastMessageSender: messages && messages.length > 0 ? messages[messages.length - 1].sender : null,
        },
        genkit: genkitDiagnostics,
    };

    const renderContent = () => {
        if (userLoading) {
            return <div className="flex items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-primary" /></div>;
        }

        if (!user) {
            return (
                <div className="text-center">
                    <p className="text-muted-foreground mb-4">Please sign in to view this story.</p>
                    <Button asChild><Link href="/login">Sign In</Link></Button>
                </div>
            );
        }
        
        return (
             <Card className="w-full max-w-2xl h-full flex flex-col">
                <CardHeader>
                    <CardTitle>Story Chat</CardTitle>
                    <CardDescription>Session ID: <span className="font-mono">{sessionId}</span></CardDescription>
                </CardHeader>
                <CardContent className="flex-grow overflow-y-auto pr-6 space-y-4">
                   {messagesLoading && <div className="flex items-center gap-2"><LoaderCircle className="animate-spin mr-2" />Loading messages...</div>}
                   {messagesError && <p className="text-destructive">Error loading messages: {messagesError.message}</p>}
                   {messages && messages.map((msg: any) => (
                       <div key={msg.id} className={`flex flex-col ${msg.sender === 'child' ? 'items-end' : 'items-start'}`}>
                           <span className="text-xs font-bold text-muted-foreground">
                               {msg.sender === 'assistant' ? 'Story Guide' : 'You'}
                           </span>
                           <p className={`p-2 rounded-md ${msg.sender === 'child' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                               {msg.text}
                           </p>
                       </div>
                   ))}
                   {isSending && (
                        <div className="flex justify-start">
                            <div className="bg-muted p-3 rounded-lg flex items-center gap-2">
                                <LoaderCircle className="h-5 w-5 animate-spin" />
                                <span className="text-sm text-muted-foreground">Thinking...</span>
                            </div>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="border-t pt-6">
                  <div className="flex w-full items-center space-x-2">
                    <Input
                      id="message"
                      placeholder="Type your message..."
                      className="flex-1"
                      autoComplete="off"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSendMessage()}
                      disabled={isSending}
                    />
                    <Button onClick={handleSendMessage} disabled={isSending}>
                      <Send className="h-4 w-4" />
                      <span className="sr-only">Send</span>
                    </Button>
                  </div>
                </CardFooter>
            </Card>
        )
    };

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8 flex flex-col items-center gap-8">
            <div className="w-full h-[calc(100vh-24rem)] flex justify-center">
              {renderContent()}
            </div>
            
            <div className="text-center">
                <p className="mb-2">Ready to choose your kind of story?</p>
                <Button onClick={() => router.push(`/story/type/${sessionId}`)}>
                    Choose story type
                </Button>
            </div>
            
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Diagnostics</CardTitle>
                </CardHeader>
                <CardContent>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                        <code>{JSON.stringify(diagnostics, null, 2)}</code>
                    </pre>
                </CardContent>
            </Card>
        </div>
    );
}

    
