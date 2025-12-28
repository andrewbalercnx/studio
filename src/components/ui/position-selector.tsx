'use client';

import { cn } from '@/lib/utils';
import type { HelpWizardPosition } from '@/lib/types';

const POSITIONS: HelpWizardPosition[][] = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center-center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];

interface PositionSelectorProps {
  value: HelpWizardPosition;
  onChange: (position: HelpWizardPosition) => void;
  disabled?: boolean;
}

export function PositionSelector({ value, onChange, disabled }: PositionSelectorProps) {
  return (
    <div className="inline-flex flex-col gap-0.5 p-1 rounded-lg border bg-muted/50">
      {POSITIONS.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-0.5">
          {row.map((position) => {
            const isSelected = value === position;
            return (
              <button
                key={position}
                type="button"
                disabled={disabled}
                onClick={() => onChange(position)}
                className={cn(
                  'w-5 h-5 rounded-sm transition-all',
                  'hover:bg-primary/20 focus:outline-none focus:ring-1 focus:ring-primary',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-background border border-border hover:border-primary/50'
                )}
                title={position.replace('-', ' ')}
                aria-label={`Position: ${position.replace('-', ' ')}`}
              >
                {isSelected && (
                  <span className="block w-1.5 h-1.5 mx-auto rounded-full bg-current" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
