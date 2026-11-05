'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';

// Story Types Panel - Links to full editor
export function StoryTypesPanel() {
  return (
    <div className="text-center py-8 border-2 border-dashed rounded-lg">
      <p className="text-muted-foreground mb-4">
        Story Types are managed in a dedicated editor with full Prompt Config support.
      </p>
      <Button asChild>
        <Link href="/admin/storyTypes">
          <ExternalLink className="mr-2 h-4 w-4" /> Open Story Types Editor
        </Link>
      </Button>
    </div>
  );
}
