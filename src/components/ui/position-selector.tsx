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
    <div className="inline-grid grid-cols-3 gap-1 p-1 rounded-lg border bg-muted/50">
      {POSITIONS.map((row, rowIndex) =>
        row.map((position) => {
          const isSelected = value === position;
          return (
            <button
              key={position}
              type="button"
              disabled={disabled}
              onClick={() => onChange(position)}
              className={cn(
                'w-8 h-8 rounded transition-all',
                'hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background border border-border hover:border-primary/50'
              )}
              title={position.replace('-', ' ')}
              aria-label={`Position: ${position.replace('-', ' ')}`}
            >
              {isSelected && (
                <span className="block w-2 h-2 mx-auto rounded-full bg-current" />
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
