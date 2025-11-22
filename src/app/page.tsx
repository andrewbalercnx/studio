'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { continueChat } from '@/ai/flows/story-chat-flow';
import type { StorySession, ChatMessage as ChatMessageType } from '@/lib/types';
import { ChatMessage } from '@/components/chat-message';
import { LoaderCircle, Send } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import Link from 'next/link';

// Create a mock story session for development
const createMockStorySession = (user: any): StorySession => ({
  id: 'session-1',
  childId: user.uid,
  status: 'in_progress',
  currentPhase: 'warmup',
  currentStepIndex: 0,
  characters: [],
  beats: [],
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});


export default function Home() {
  const { user, loading: userLoading } = useUser();
  const [session, setSession] = useState<StorySession | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Start the conversation when the component loads
  useEffect(() => {
    if (user && !session) {
      const newSession = createMockStorySession(user);
      setSession(newSession);
      getInitialMessage(newSession);
    }
  }, [user, session]);

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [session?.messages]);

  const getInitialMessage = async (currentSession: StorySession) => {
    setIsLoading(true);
    try {
      // The flow expects dates as strings, but the type expects Date objects.
      // We can stringify them for the API call.
      const apiSession = {
        ...currentSession,
        createdAt: currentSession.createdAt.toISOString(),
        updatedAt: currentSession.updatedAt.toISOString(),
      }
      const result = await continueChat({ session: apiSession as any });
      setSession(prev => prev ? { ...prev, messages: [result.message] } : null);
    } catch (error) {
      console.error('Error getting initial message:', error);
      // You could add a user-facing error message here
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (messageContent: string) => {
    if (!messageContent.trim() || !session) return;

    const userMessage: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent,
    };

    const updatedSession: StorySession = {
      ...session,
      messages: [...session.messages, userMessage],
    };
    
    setSession(updatedSession);
    setInput('');
    setIsLoading(true);

    try {
       const apiSession = {
        ...updatedSession,
        createdAt: updatedSession.createdAt.toISOString(),
        updatedAt: updatedSession.updatedAt.toISOString(),
        messages: updatedSession.messages.map(m => ({...m, createdAt: new Date().toISOString()}))
      }
      const result = await continueChat({ session: apiSession as any });
      setSession(prev => prev ? { ...prev, messages: [...prev.messages, result.message] } : null);
    } catch (error) {
      console.error('Error continuing chat:', error);
      const errorMessage: ChatMessageType = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Oops! I had a little trouble thinking. Please try again.',
      };
      setSession(prev => prev ? { ...prev, messages: [...prev.messages, errorMessage] } : null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    sendMessage(input);
  };
  
  const handleChoiceClick = (choiceText: string) => {
    sendMessage(choiceText);
  };

  if (userLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
        <div className="container mx-auto px-4 py-12 sm:py-16 md:py-24 flex items-center justify-center h-screen">
            <Card className="text-center p-8">
                <CardHeader>
                    <CardTitle className="text-3xl font-headline">Welcome to StoryPic Kids!</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-6">Please sign in to start creating your story.</p>
                    <Button asChild>
                        <Link href="/login">Sign In</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] justify-center items-center p-4">
      <Card className="w-full max-w-2xl h-full flex flex-col">
        <CardHeader>
          <CardTitle className="font-headline text-center">Story Chat</CardTitle>
        </CardHeader>
        <CardContent ref={scrollAreaRef} className="flex-grow overflow-y-auto pr-6 space-y-4">
          {session?.messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} onChoiceClick={handleChoiceClick} />
          ))}
           {isLoading && (
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
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
              disabled={isLoading}
            />
            <Button onClick={handleSend} disabled={isLoading}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
