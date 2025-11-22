
'use client';

import { useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { LoaderCircle, Send } from 'lucide-react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import type { StorySession, ChatMessage as Message } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { useCollection, useDocument } from '@/lib/firestore-hooks';

export default function StorySessionPage({ params }: { params: { sessionId: string } }) {
    const { sessionId } = params;
    const { user, loading: userLoading } = useUser();
    const firestore = useFirestore();
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);

    const sessionRef = firestore ? doc(firestore, 'storySessions', sessionId) : null;
    const { data: session, loading: sessionLoading, error: sessionError } = useDocument<StorySession>(sessionRef);

    const messagesQuery = firestore ? query(collection(firestore, `storySessions/${sessionId}/messages`), orderBy('createdAt')) : null;
    const { data: messages, loading: messagesLoading, error: messagesError } = useCollection<Message>(messagesQuery);
    
    const handleSendMessage = async () => {
        if (!input.trim() || !firestore || !user) return;

        setIsSending(true);
        const messagesRef = collection(firestore, `storySessions/${sessionId}/messages`);
        try {
            await addDoc(messagesRef, {
                sender: 'child',
                text: input.trim(),
                createdAt: serverTimestamp(),
            });
            setInput('');
        } catch (e) {
            console.error("Error sending message:", e);
            // Optionally, show a toast notification
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
            hasSession: !!session,
            messagesCount: messages?.length || 0,
            firstMessageSender: messages && messages.length > 0 ? messages[0].sender : null,
            lastMessageSender: messages && messages.length > 0 ? messages[messages.length - 1].sender : null,
        },
    };

    const renderContent = () => {
        if (userLoading || sessionLoading) {
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
        
        if (!session) {
            return (
                <div className="text-center">
                    <p className="text-destructive">This story session could not be found.</p>
                </div>
            )
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
                       <div key={msg.id} className="flex flex-col">
                           <span className="text-xs font-bold text-muted-foreground">
                               {msg.sender === 'assistant' ? 'Story Guide' : 'You'}
                           </span>
                           <p className="p-2 bg-muted rounded-md">{msg.text}</p>
                       </div>
                   ))}
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
            <div className="w-full h-[calc(100vh-18rem)] flex justify-center">
              {renderContent()}
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
