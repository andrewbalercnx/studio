'use client';

import { useMemo, useState, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, setDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, Trash2, Copy, Sprout } from 'lucide-react';
import type { PrintProduct, MixamProductMapping } from '@/lib/types';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { MixamMappingEditor } from '@/components/admin/MixamMappingEditor';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUser } from '@/firebase/auth/use-user';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Zod schema helpers
const positiveNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: 'Must be a number' }).positive({ message: 'Must be > 0' })
);

const nonNegativeNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: 'Must be a number' }).min(0, { message: 'Must be >= 0' })
);

const numberOrNull = z.preprocess(
  (val) => (val === '' || val === undefined || val === null ? null : Number(val)),
  z.number().nullable()
);

// Trim size schema
const trimSizeSchema = z.object({
  width: positiveNumber,
  height: positiveNumber,
  label: z.string().min(1, 'Label is required'),
});

// Pricing tier schema
const pricingTierSchema = z.object({
  minQuantity: z.coerce.number().min(1, 'Min must be >= 1'),
  maxQuantity: numberOrNull,
  basePrice: nonNegativeNumber,
  setupFee: z.preprocess(
    (val) => (val === '' || val === undefined ? 0 : Number(val)),
    z.number().min(0)
  ),
});

// Form schema for PrintProduct
const printProductFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(1, 'Description is required'),
  active: z.boolean(),
  displayOrder: z.coerce.number().min(0),

  // Page composition settings
  blankPages: z.coerce.number().min(0),
  spine: z.boolean(),

  // Mixam specifications
  mixamSpec: z.object({
    product: z.literal('books'),
    subProduct: z.enum(['hardcover_poth', 'hardcover_pura', 'paperback']),

    cover: z.object({
      type: z.literal('COVER'),
      pages: z.literal(4),
      material: z.object({
        type: z.enum(['silk', 'gloss', 'uncoated', 'linen', 'buckram']),
        weight: positiveNumber,
        units: z.literal('GSM'),
        color: z.enum(['WHITE', 'BLACK', 'GREY', 'CREAM']),
      }),
      chromaticity: z.object({
        front: z.enum(['CMYK', 'BW']),
        back: z.enum(['CMYK', 'BW']),
      }),
    }),

    interior: z.object({
      type: z.literal('CONTENT'),
      material: z.object({
        type: z.enum(['silk', 'gloss', 'uncoated']),
        weight: positiveNumber,
        units: z.literal('GSM'),
        color: z.enum(['WHITE', 'CREAM', 'YELLOW']),
      }),
      chromaticity: z.object({
        front: z.enum(['CMYK', 'BW']),
        back: z.enum(['CMYK', 'BW']),
      }),
    }),

    binding: z.object({
      type: z.enum(['case', 'case_with_sewing', 'perfect_bound']),
      sewn: z.boolean().optional(),
      edge: z.enum(['LEFT_RIGHT', 'TOP_BOTTOM']),
      allowHeadTailBandSelection: z.boolean().optional(),
      allowRibbonSelection: z.boolean().optional(),
      allowEndPaperSelection: z.boolean().optional(),
    }),

    format: z.object({
      minPageCount: z.coerce.number().min(1),
      maxPageCount: z.coerce.number().min(1),
      pageCountIncrement: z.coerce.number().min(1),
      allowedTrimSizes: z.array(trimSizeSchema).min(1, 'At least one trim size required'),
      orientation: z.enum(['PORTRAIT', 'LANDSCAPE', 'SQUARE']),
      bleedRequired: nonNegativeNumber,
    }),

    files: z.object({
      separateCoverAndInterior: z.boolean(),
      colorSpace: z.enum(['CMYK', 'RGB']),
      minDPI: z.coerce.number().min(72),
      maxFileSize: z.coerce.number().min(1),
    }),
  }),

  pricingTiers: z.array(pricingTierSchema).min(1, 'At least one pricing tier required'),

  shippingCost: z.object({
    baseRate: nonNegativeNumber,
    perItemRate: z.preprocess(
      (val) => (val === '' || val === undefined ? 0 : Number(val)),
      z.number().min(0)
    ),
  }),

  imageUrl: z.string().optional(),

  // Mixam catalogue mapping (optional)
  mixamMapping: z.any().optional(),
});

type PrintProductFormValues = z.infer<typeof printProductFormSchema>;

const defaultFormValues: PrintProductFormValues = {
  name: '',
  description: '',
  active: true,
  displayOrder: 1,
  blankPages: 0,
  spine: true,
  mixamSpec: {
    product: 'books',
    subProduct: 'hardcover_poth',
    cover: {
      type: 'COVER',
      pages: 4,
      material: {
        type: 'silk',
        weight: 200,
        units: 'GSM',
        color: 'WHITE',
      },
      chromaticity: {
        front: 'CMYK',
        back: 'CMYK',
      },
    },
    interior: {
      type: 'CONTENT',
      material: {
        type: 'silk',
        weight: 170,
        units: 'GSM',
        color: 'WHITE',
      },
      chromaticity: {
        front: 'CMYK',
        back: 'CMYK',
      },
    },
    binding: {
      type: 'case',
      sewn: false,
      edge: 'LEFT_RIGHT',
      allowHeadTailBandSelection: true,
      allowRibbonSelection: true,
      allowEndPaperSelection: true,
    },
    format: {
      minPageCount: 24,
      maxPageCount: 48,
      pageCountIncrement: 4,
      allowedTrimSizes: [
        { width: 203.2, height: 254, label: '8×10 inches (Portrait)' },
      ],
      orientation: 'PORTRAIT',
      bleedRequired: 3.175,
    },
    files: {
      separateCoverAndInterior: true,
      colorSpace: 'CMYK',
      minDPI: 300,
      maxFileSize: 2147483648,
    },
  },
  pricingTiers: [
    { minQuantity: 1, maxQuantity: 10, basePrice: 15.0, setupFee: 0 },
  ],
  shippingCost: {
    baseRate: 5.0,
    perItemRate: 0.5,
  },
};

function PrintProductForm({
  editingProduct,
  onSave,
}: {
  editingProduct?: PrintProduct | null;
  onSave: () => void;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PrintProductFormValues>({
    resolver: zodResolver(printProductFormSchema),
    defaultValues: editingProduct
      ? {
          id: editingProduct.id,
          name: editingProduct.name,
          description: editingProduct.description,
          active: editingProduct.active,
          displayOrder: editingProduct.displayOrder,
          blankPages: editingProduct.blankPages ?? 0,
          spine: editingProduct.spine ?? true,
          mixamSpec: editingProduct.mixamSpec,
          pricingTiers: editingProduct.pricingTiers,
          shippingCost: editingProduct.shippingCost,
          imageUrl: editingProduct.imageUrl,
          mixamMapping: editingProduct.mixamMapping,
        }
      : defaultFormValues,
  });

  // State for mixamMapping (managed separately since it's complex)
  const [mixamMapping, setMixamMapping] = useState<MixamProductMapping | undefined>(
    editingProduct?.mixamMapping
  );

  const {
    fields: trimSizeFields,
    append: appendTrimSize,
    remove: removeTrimSize,
  } = useFieldArray({
    control,
    name: 'mixamSpec.format.allowedTrimSizes',
  });

  const {
    fields: pricingTierFields,
    append: appendPricingTier,
    remove: removePricingTier,
  } = useFieldArray({
    control,
    name: 'pricingTiers',
  });

  const onSubmit = async (data: PrintProductFormValues) => {
    if (!firestore) return;

    setIsSaving(true);
    try {
      const docId = data.id || `product-${Date.now()}`;
      const docRef = doc(firestore, 'printProducts', docId);

      // Build the document, omitting undefined values (Firestore doesn't accept undefined)
      const docData: Record<string, any> = {
        id: docId,
        name: data.name,
        description: data.description,
        active: data.active,
        displayOrder: data.displayOrder,
        blankPages: data.blankPages,
        spine: data.spine,
        mixamSpec: data.mixamSpec,
        pricingTiers: data.pricingTiers,
        shippingCost: data.shippingCost,
        createdAt: editingProduct?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: editingProduct?.createdBy || 'admin',
      };

      // Only add imageUrl if it has a value
      if (data.imageUrl) {
        docData.imageUrl = data.imageUrl;
      }

      // Add mixamMapping if it exists
      if (mixamMapping) {
        docData.mixamMapping = mixamMapping;
      }

      await setDoc(docRef, docData, { merge: true });

      toast({ title: 'Print product saved' });
      onSave();
    } catch (error: any) {
      toast({ title: 'Error saving product', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Basic Information</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} placeholder="e.g. Hardcover Picture Book" />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayOrder">Display Order</Label>
            <Input id="displayOrder" type="number" {...register('displayOrder')} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" {...register('description')} rows={2} />
          {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Controller
            name="active"
            control={control}
            render={({ field }) => (
              <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          <Label htmlFor="active">Active</Label>
        </div>
      </div>

      {/* Page Composition */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Page Composition</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="blankPages">Blank Pages</Label>
            <Input id="blankPages" type="number" min="0" {...register('blankPages')} />
            <p className="text-xs text-muted-foreground">Fixed blank pages (e.g., endpapers)</p>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Controller
              name="spine"
              control={control}
              render={({ field }) => (
                <Switch id="spine" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="spine">Include Spine in Cover PDF</Label>
          </div>
        </div>
      </div>

      {/* Product Type */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Product Type</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Sub Product</Label>
            <Controller
              name="mixamSpec.subProduct"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hardcover_poth">Hardcover POTH</SelectItem>
                    <SelectItem value="hardcover_pura">Hardcover PURA</SelectItem>
                    <SelectItem value="paperback">Paperback</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Orientation</Label>
            <Controller
              name="mixamSpec.format.orientation"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PORTRAIT">Portrait</SelectItem>
                    <SelectItem value="LANDSCAPE">Landscape</SelectItem>
                    <SelectItem value="SQUARE">Square</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
      </div>

      {/* Cover Material */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Cover Material</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Controller
              name="mixamSpec.cover.material.type"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="silk">Silk</SelectItem>
                    <SelectItem value="gloss">Gloss</SelectItem>
                    <SelectItem value="uncoated">Uncoated</SelectItem>
                    <SelectItem value="linen">Linen</SelectItem>
                    <SelectItem value="buckram">Buckram</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Weight (GSM)</Label>
            <Input type="number" {...register('mixamSpec.cover.material.weight')} />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <Controller
              name="mixamSpec.cover.material.color"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHITE">White</SelectItem>
                    <SelectItem value="BLACK">Black</SelectItem>
                    <SelectItem value="GREY">Grey</SelectItem>
                    <SelectItem value="CREAM">Cream</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Front Chromaticity</Label>
            <Controller
              name="mixamSpec.cover.chromaticity.front"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CMYK">CMYK (Color)</SelectItem>
                    <SelectItem value="BW">B/W (Grayscale)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
      </div>

      {/* Interior Material */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Interior Material</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Controller
              name="mixamSpec.interior.material.type"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="silk">Silk</SelectItem>
                    <SelectItem value="gloss">Gloss</SelectItem>
                    <SelectItem value="uncoated">Uncoated</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Weight (GSM)</Label>
            <Input type="number" {...register('mixamSpec.interior.material.weight')} />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <Controller
              name="mixamSpec.interior.material.color"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHITE">White</SelectItem>
                    <SelectItem value="CREAM">Cream</SelectItem>
                    <SelectItem value="YELLOW">Yellow</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Front Chromaticity</Label>
            <Controller
              name="mixamSpec.interior.chromaticity.front"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CMYK">CMYK (Color)</SelectItem>
                    <SelectItem value="BW">B/W (Grayscale)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
      </div>

      {/* Binding */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Binding</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Binding Type</Label>
            <Controller
              name="mixamSpec.binding.type"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="case">Case Binding</SelectItem>
                    <SelectItem value="case_with_sewing">Case with Sewing</SelectItem>
                    <SelectItem value="perfect_bound">Perfect Bound</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Edge</Label>
            <Controller
              name="mixamSpec.binding.edge"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEFT_RIGHT">Left/Right</SelectItem>
                    <SelectItem value="TOP_BOTTOM">Top/Bottom</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Controller
              name="mixamSpec.binding.sewn"
              control={control}
              render={({ field }) => (
                <Switch id="sewn" checked={field.value || false} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="sewn">Sewn</Label>
          </div>
          <div className="flex items-center gap-2">
            <Controller
              name="mixamSpec.binding.allowHeadTailBandSelection"
              control={control}
              render={({ field }) => (
                <Switch id="headtail" checked={field.value || false} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="headtail">Head/Tail Band</Label>
          </div>
          <div className="flex items-center gap-2">
            <Controller
              name="mixamSpec.binding.allowRibbonSelection"
              control={control}
              render={({ field }) => (
                <Switch id="ribbon" checked={field.value || false} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="ribbon">Ribbon</Label>
          </div>
          <div className="flex items-center gap-2">
            <Controller
              name="mixamSpec.binding.allowEndPaperSelection"
              control={control}
              render={({ field }) => (
                <Switch id="endpaper" checked={field.value || false} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="endpaper">End Paper</Label>
          </div>
        </div>
      </div>

      {/* Format */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Format</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Min Pages</Label>
            <Input type="number" {...register('mixamSpec.format.minPageCount')} />
          </div>
          <div className="space-y-2">
            <Label>Max Pages</Label>
            <Input type="number" {...register('mixamSpec.format.maxPageCount')} />
          </div>
          <div className="space-y-2">
            <Label>Page Increment</Label>
            <Input type="number" {...register('mixamSpec.format.pageCountIncrement')} />
          </div>
          <div className="space-y-2">
            <Label>Bleed (mm)</Label>
            <Input type="number" step="0.001" {...register('mixamSpec.format.bleedRequired')} />
          </div>
        </div>

        {/* Trim Sizes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Trim Sizes</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => appendTrimSize({ width: 203.2, height: 254, label: 'New Size' })}
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {trimSizeFields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-4 gap-2 items-end rounded-md border p-2">
                <div className="space-y-1">
                  <Label className="text-xs">Width (mm)</Label>
                  <Input type="number" step="0.1" {...register(`mixamSpec.format.allowedTrimSizes.${index}.width`)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Height (mm)</Label>
                  <Input type="number" step="0.1" {...register(`mixamSpec.format.allowedTrimSizes.${index}.height`)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input {...register(`mixamSpec.format.allowedTrimSizes.${index}.label`)} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeTrimSize(index)}
                  disabled={trimSizeFields.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Files */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">File Requirements</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Color Space</Label>
            <Controller
              name="mixamSpec.files.colorSpace"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CMYK">CMYK</SelectItem>
                    <SelectItem value="RGB">RGB</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Min DPI</Label>
            <Input type="number" {...register('mixamSpec.files.minDPI')} />
          </div>
          <div className="space-y-2">
            <Label>Max File Size (bytes)</Label>
            <Input type="number" {...register('mixamSpec.files.maxFileSize')} />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Controller
              name="mixamSpec.files.separateCoverAndInterior"
              control={control}
              render={({ field }) => (
                <Switch id="separate" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="separate">Separate Files</Label>
          </div>
        </div>
      </div>

      {/* Pricing Tiers */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Pricing Tiers (GBP)</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Tiers</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => appendPricingTier({ minQuantity: 1, maxQuantity: null, basePrice: 10, setupFee: 0 })}
            >
              <Plus className="mr-1 h-4 w-4" /> Add Tier
            </Button>
          </div>
          <div className="space-y-2">
            {pricingTierFields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-5 gap-2 items-end rounded-md border p-2">
                <div className="space-y-1">
                  <Label className="text-xs">Min Qty</Label>
                  <Input type="number" {...register(`pricingTiers.${index}.minQuantity`)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Qty (blank=∞)</Label>
                  <Input type="number" {...register(`pricingTiers.${index}.maxQuantity`)} placeholder="∞" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Base Price</Label>
                  <Input type="number" step="0.01" {...register(`pricingTiers.${index}.basePrice`)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Setup Fee</Label>
                  <Input type="number" step="0.01" {...register(`pricingTiers.${index}.setupFee`)} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removePricingTier(index)}
                  disabled={pricingTierFields.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Shipping */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Shipping Cost (GBP)</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Base Rate</Label>
            <Input type="number" step="0.01" {...register('shippingCost.baseRate')} />
          </div>
          <div className="space-y-2">
            <Label>Per Item Rate</Label>
            <Input type="number" step="0.01" {...register('shippingCost.perItemRate')} />
          </div>
        </div>
      </div>

      {/* Mixam Catalogue Mapping */}
      <MixamMappingEditor
        value={mixamMapping}
        onChange={setMixamMapping}
      />

      <DialogFooter>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Product
        </Button>
      </DialogFooter>
    </form>
  );
}

function PrintProductsPanel() {
  const firestore = useFirestore();
  const { user } = useUser();
  const productsQuery = useMemo(
    () => (firestore ? query(collection(firestore, 'printProducts'), orderBy('displayOrder', 'asc')) : null),
    [firestore]
  );
  const { data: products, loading, error } = useCollection<PrintProduct>(productsQuery);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PrintProduct | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<PrintProduct | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSeedProduct = useCallback(async () => {
    if (!user) return;

    setIsSeeding(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/print-products/seed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.ok && result.ok) {
        toast({ title: 'Success', description: result.message });
      } else {
        toast({
          title: 'Seed failed',
          description: result.errorMessage || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSeeding(false);
    }
  }, [user, toast]);

  const openCreate = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  const openEdit = (item: PrintProduct) => {
    setEditingProduct(item);
    setDialogOpen(true);
  };

  const openCopy = (item: PrintProduct) => {
    // Create a copy with a new name and no ID
    const copy: PrintProduct = {
      ...item,
      id: '',
      name: `${item.name} (Copy)`,
    };
    setEditingProduct(copy as any);
    setDialogOpen(true);
  };

  const confirmDelete = (item: PrintProduct) => {
    setProductToDelete(item);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!firestore || !productToDelete) return;

    setIsDeleting(true);
    try {
      await deleteDoc(doc(firestore, 'printProducts', productToDelete.id));
      toast({ title: 'Product deleted' });
    } catch (error: any) {
      toast({ title: 'Error deleting product', description: error.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  const handleSave = () => {
    setDialogOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Print Products</CardTitle>
          <CardDescription>Manage print product configurations for Mixam integration.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedProduct} disabled={isSeeding}>
            {isSeeding ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
            Seed Default
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Product
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-destructive">Error loading products: {error.message}</p>}
        {!loading && products && products.length === 0 && (
          <p className="text-sm text-muted-foreground">No print products yet. Click &quot;Seed Default&quot; to create the initial hardcover product.</p>
        )}
        {!loading && products && products.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="capitalize">{product.mixamSpec?.subProduct?.replace(/_/g, ' ') || 'N/A'}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        product.active
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      }`}
                    >
                      {product.active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>{product.displayOrder}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openCopy(product)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => confirmDelete(product)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingProduct?.id ? 'Edit Print Product' : 'New Print Product'}</DialogTitle>
          </DialogHeader>
          <PrintProductForm editingProduct={editingProduct} onSave={handleSave} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Print Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{productToDelete?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function AdminPrintProductsPage() {
  const { isAdmin, isWriter, loading: adminLoading } = useAdminStatus();

  if (adminLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin && !isWriter) {
    return <p className="text-destructive text-center p-8">Admin or writer access required.</p>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <PrintProductsPanel />
    </div>
  );
}
