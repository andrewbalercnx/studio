
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThinkingIndicator() {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative flex items-center justify-center h-24 w-24">
        <Star className="h-10 w-10 text-yellow-400 animate-pulse" />
        <Star
          className={cn(
            'absolute h-4 w-4 text-yellow-300',
            'animate-orbit'
          )}
          style={{ animationDelay: '0s' }}
        />
        <Star
          className={cn(
            'absolute h-5 w-5 text-yellow-300',
            'animate-orbit'
          )}
          style={{ animationDelay: '0.5s', animationDuration: '4s' }}
        />
        <Star
          className={cn(
            'absolute h-3 w-3 text-yellow-300',
            'animate-orbit'
          )}
          style={{ animationDelay: '1s', animationDirection: 'reverse' }}
        />
      </div>
      <p className="text-muted-foreground animate-pulse">Thinking...</p>
      <style jsx>{`
        @keyframes orbit {
          from {
            transform: rotate(0deg) translateX(4rem) rotate(0deg);
          }
          to {
            transform: rotate(360deg) translateX(4rem) rotate(-360deg);
          }
        }
        .animate-orbit {
          animation: orbit 3s linear infinite;
        }
      `}</style>
    </div>
  );
}
