'use client';

import { Star, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SavedAddress } from '@/lib/types';

export type AddressCardProps = {
  address: SavedAddress;
  onEdit?: (address: SavedAddress) => void;
  onDelete?: (address: SavedAddress) => void;
  onSetDefault?: (address: SavedAddress) => void;
  showActions?: boolean;
  selected?: boolean;
  onClick?: (address: SavedAddress) => void;
  className?: string;
};

export function AddressCard({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  showActions = true,
  selected = false,
  onClick,
  className = '',
}: AddressCardProps) {
  const handleClick = () => {
    if (onClick) {
      onClick(address);
    }
  };

  const isClickable = !!onClick;

  return (
    <Card
      className={`
        ${className}
        ${isClickable ? 'cursor-pointer hover:border-primary transition-colors' : ''}
        ${selected ? 'border-primary bg-primary/5' : ''}
      `}
      onClick={isClickable ? handleClick : undefined}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            {/* Label and default badge */}
            <div className="flex items-center gap-2 mb-1">
              {address.label && (
                <span className="font-medium text-sm">{address.label}</span>
              )}
              {address.isDefault && (
                <Badge variant="secondary" className="text-xs flex items-center gap-1">
                  <Star className="h-3 w-3 fill-current" />
                  Default
                </Badge>
              )}
            </div>

            {/* Address details */}
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground">{address.name}</p>
              <p>{address.line1}</p>
              {address.line2 && <p>{address.line2}</p>}
              <p>
                {address.city}
                {address.state && `, ${address.state}`}
              </p>
              <p>{address.postalCode}</p>
            </div>
          </div>

          {/* Actions */}
          {showActions && (
            <div className="flex flex-col gap-1">
              {!address.isDefault && onSetDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetDefault(address);
                  }}
                  title="Set as default"
                >
                  <Star className="h-4 w-4" />
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(address);
                  }}
                  title="Edit address"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(address);
                  }}
                  title="Delete address"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
