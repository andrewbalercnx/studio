'use client';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { AVAILABLE_FONTS, SAMPLE_TEXT } from './shared';

export function FontSelector({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Font</Label>
      <ScrollArea className="h-64 rounded-md border">
        <div className="p-2 space-y-1">
          {AVAILABLE_FONTS.map((font) => (
            <button
              key={font.value}
              type="button"
              onClick={() => onChange(font.value)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-muted",
                value === font.value && "bg-primary/10 ring-1 ring-primary"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                  {font.label}
                </span>
                <span className="text-xs text-muted-foreground/60">
                  {font.description}
                </span>
              </div>
              <div
                className="text-lg mt-1 truncate"
                style={{
                  fontFamily: font.cssFamily,
                  fontWeight: font.fontWeight || 400,
                  fontStyle: font.fontStyle || 'normal',
                }}
              >
                {SAMPLE_TEXT}
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
