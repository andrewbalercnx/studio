import { BookOpen } from 'lucide-react';
import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

export function Logo({ className, ...props }: SVGProps<SVGSVGElement> & {className?: string}) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <div className="bg-primary/20 p-2 rounded-lg">
        <BookOpen className="h-6 w-6 text-primary" />
      </div>
      <span className="font-headline text-xl font-bold text-foreground hidden sm:inline-block">
        StoryPic Kids
      </span>
    </div>
  );
}
