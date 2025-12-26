'use client';

import { useState, KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, X } from 'lucide-react';

type ArrayInputProps = {
  value: string[];
  onChange: (newValue: string[]) => void;
  placeholder?: string;
  variant?: 'default' | 'destructive' | 'secondary';
  label?: string;
};

export function ArrayInput({
  value,
  onChange,
  placeholder = 'Add item...',
  variant = 'secondary',
  label
}: ArrayInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addItem = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInputValue('');
    }
  };

  const removeItem = (item: string) => {
    onChange(value.filter(v => v !== item));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-sm font-medium">{label}</label>}
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" onClick={addItem} size="sm">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((item) => (
            <Badge key={item} variant={variant} className="gap-1">
              {item}
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="ml-1 hover:bg-background/20 rounded-full"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
