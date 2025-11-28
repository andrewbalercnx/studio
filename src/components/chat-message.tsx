'use client';

import type { ChatMessage as ChatMessageType, Choice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Bot, User } from 'lucide-react';
import { Button } from './ui/button';

type ChatMessageProps = {
  message: ChatMessageType;
  onChoiceClick: (choiceText: string) => void;
};

export function ChatMessage({ message, onChoiceClick }: ChatMessageProps) {
  const role = message.role ?? (message.sender === 'assistant' ? 'assistant' : 'user');
  const isAssistant = role === 'assistant' || role === 'model';
  const text = message.text ?? message.content ?? '';
  const choices: Choice[] = message.options ?? [];

  return (
    <div className={cn('flex items-start gap-3', isAssistant ? 'justify-start' : 'justify-end')}>
      {isAssistant && (
        <div className="bg-primary/20 p-2 rounded-full">
          <Bot className="h-5 w-5 text-primary" />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'max-w-md rounded-lg p-3',
            isAssistant ? 'bg-muted' : 'bg-primary text-primary-foreground'
          )}
        >
          <p className="text-sm">{text}</p>
        </div>
        {choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
                {choices.map(choice => (
                    <Button key={choice.id} variant="outline" size="sm" onClick={() => onChoiceClick(choice.text)}>
                        {choice.text}
                    </Button>
                ))}
            </div>
        )}
      </div>
      {!isAssistant && (
         <div className="bg-accent/20 p-2 rounded-full">
            <User className="h-5 w-5 text-accent-foreground" />
        </div>
      )}
    </div>
  );
}
