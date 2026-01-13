
'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Edit, Trash2, Link2, Link2Off } from 'lucide-react';
import type { PrintLayout, PrintProduct } from '@/lib/types';
import SampleLayoutData from '@/data/print-layouts.json';
import { query, where } from 'firebase/firestore';
import { writeBatch } from 'firebase/firestore';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const positiveNumber = z.preprocess(
  (val) => Number(val),
  z.number({ invalid_type_error: "Must be a number" }).positive({ message: "Must be > 0" })
);

const numberOrEmpty = z.preprocess(
  (val) => (val === '' || val === undefined || val === null) ? undefined : Number(val),
  z.number().optional()
);

const boxSchema = z.object({
  leaf: z.coerce.number().min(1, "Leaf must be 1 or 2.").max(2, "Leaf must be 1 or 2."),
  x: z.coerce.number(),
  y: z.coerce.number(),
  width: positiveNumber,
  height: positiveNumber,
});

// Text box schema with styling options
const textLayoutBoxSchema = z.object({
  x: numberOrEmpty,
  y: numberOrEmpty,
  width: numberOrEmpty,
  height: numberOrEmpty,
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  borderRadius: numberOrEmpty,
}).optional();

// Image box schema
const imageLayoutBoxSchema = z.object({
  x: numberOrEmpty,
  y: numberOrEmpty,
  width: numberOrEmpty,
  height: numberOrEmpty,
}).optional();

// Page layout config schema for cover/inside/back/title layouts
const pageLayoutConfigSchema = z.object({
  textBox: textLayoutBoxSchema,
  imageBox: imageLayoutBoxSchema,
}).optional();

// Page constraints schema
const pageConstraintsSchema = z.object({
  minPages: numberOrEmpty,
  maxPages: numberOrEmpty,
  pageMultiple: z.enum(['1', '2', '4']).optional(),
}).optional();

const printLayoutFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  leafWidth: positiveNumber,
  leafHeight: positiveNumber,
  leavesPerSpread: z.enum(['1', '2']),
  // Typography settings
  font: z.string().optional(),
  fontSize: numberOrEmpty,
  // Page-type-specific layouts
  coverLayout: pageLayoutConfigSchema,
  backCoverLayout: pageLayoutConfigSchema,
  insideLayout: pageLayoutConfigSchema,
  titlePageLayout: pageLayoutConfigSchema,
  // Print product link and page constraints
  printProductId: z.string().optional(),
  pageConstraints: pageConstraintsSchema,
  // Legacy arrays (still used for backwards compatibility)
  textBoxes: z.array(boxSchema).min(1, 'At least one text box is required'),
  imageBoxes: z.array(boxSchema).min(1, 'At least one image box is required'),
});


type PrintLayoutFormValues = z.infer<typeof printLayoutFormSchema>;

const defaultFormValues: PrintLayoutFormValues = {
  name: '',
  leafWidth: 8.5,
  leafHeight: 11,
  leavesPerSpread: '1',
  font: 'Helvetica',
  fontSize: 24,
  coverLayout: {
    imageBox: { x: 0, y: 0, width: 8.5, height: 11 },
    textBox: { x: 0.5, y: 7.5, width: 7.5, height: 3, backgroundColor: '#F5F5DC', textColor: undefined, borderRadius: 0.1 },
  },
  backCoverLayout: {
    imageBox: { x: 0.85, y: 1.1, width: 6.8, height: 6.5 },
    textBox: { x: 0.5, y: 8.5, width: 7.5, height: 2, backgroundColor: '#4A7C59', textColor: '#FFFFFF', borderRadius: 0.1 },
  },
  insideLayout: {
    imageBox: { x: 0, y: 0, width: 8.5, height: 11 },
    textBox: { x: 1, y: 1, width: 6.5, height: 9, backgroundColor: undefined, textColor: undefined, borderRadius: 0 },
  },
  titlePageLayout: {
    textBox: { x: 1, y: 3, width: 6.5, height: 5, backgroundColor: undefined, textColor: undefined, borderRadius: 0 },
  },
  textBoxes: [{ leaf: 1, x: 1, y: 7, width: 6.5, height: 3 }],
  imageBoxes: [{ leaf: 1, x: 1, y: 1, width: 6.5, height: 5.5 }],
};

function PrintLayoutForm({
  editingLayout,
  onSave,
  printProducts,
}: {
  editingLayout?: PrintLayout | null;
  onSave: () => void;
  printProducts: PrintProduct[];
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PrintLayoutFormValues>({
    resolver: zodResolver(printLayoutFormSchema),
    defaultValues: editingLayout
      ? {
          id: editingLayout.id,
          name: editingLayout.name,
          leafWidth: editingLayout.leafWidth,
          leafHeight: editingLayout.leafHeight,
          leavesPerSpread: String(editingLayout.leavesPerSpread) as '1' | '2',
          font: editingLayout.font || defaultFormValues.font,
          fontSize: editingLayout.fontSize || defaultFormValues.fontSize,
          coverLayout: editingLayout.coverLayout || defaultFormValues.coverLayout,
          backCoverLayout: editingLayout.backCoverLayout || defaultFormValues.backCoverLayout,
          insideLayout: editingLayout.insideLayout || defaultFormValues.insideLayout,
          titlePageLayout: editingLayout.titlePageLayout || defaultFormValues.titlePageLayout,
          printProductId: editingLayout.printProductId || undefined,
          pageConstraints: editingLayout.pageConstraints ? {
            minPages: editingLayout.pageConstraints.minPages,
            maxPages: editingLayout.pageConstraints.maxPages,
            pageMultiple: editingLayout.pageConstraints.pageMultiple?.toString() as '1' | '2' | '4' | undefined,
          } : undefined,
          textBoxes: editingLayout.textBoxes || [],
          imageBoxes: editingLayout.imageBoxes || [],
        }
      : defaultFormValues,
  });

  // Watch printProductId for auto-sync
  const watchedProductId = watch('printProductId');

  // Auto-sync trim size when product changes
  useEffect(() => {
    if (!watchedProductId) return;

    const product = printProducts.find(p => p.id === watchedProductId);
    if (!product?.mixamSpec?.format?.allowedTrimSizes?.length) return;

    // Use the first allowed trim size
    const trimSize = product.mixamSpec.format.allowedTrimSizes[0];
    // Convert mm to inches (25.4mm = 1 inch)
    const widthInches = Math.round((trimSize.width / 25.4) * 100) / 100;
    const heightInches = Math.round((trimSize.height / 25.4) * 100) / 100;

    setValue('leafWidth', widthInches);
    setValue('leafHeight', heightInches);

    toast({
      title: 'Trim size synced',
      description: `Set to ${widthInches}" × ${heightInches}" from ${product.name}`,
    });
  }, [watchedProductId, printProducts, setValue, toast]);

  // Get the linked product for displaying inherited constraints
  const linkedProduct = watchedProductId
    ? printProducts.find(p => p.id === watchedProductId)
    : null;

  const {
    fields: textBoxFields,
    append: appendTextBox,
    remove: removeTextBox,
  } = useFieldArray({
    control,
    name: 'textBoxes',
  });
  const {
    fields: imageBoxFields,
    append: appendImageBox,
    remove: removeImageBox,
  } = useFieldArray({
    control,
    name: 'imageBoxes',
  });

  // Clean up empty strings and convert to undefined for optional fields
  const cleanLayoutConfig = (config: any) => {
    if (!config) return undefined;
    const cleaned: any = {};

    if (config.imageBox) {
      const { x, y, width, height } = config.imageBox;
      // Only include imageBox if it has valid dimensions
      if (x !== undefined || y !== undefined || width !== undefined || height !== undefined) {
        cleaned.imageBox = { x, y, width, height };
      }
    }

    if (config.textBox) {
      const { x, y, width, height, backgroundColor, textColor, borderRadius } = config.textBox;
      cleaned.textBox = {
        x, y, width, height,
        // Only include styling if they have values (not empty strings)
        ...(backgroundColor && backgroundColor.trim() ? { backgroundColor } : {}),
        ...(textColor && textColor.trim() ? { textColor } : {}),
        ...(borderRadius !== undefined && borderRadius !== null ? { borderRadius } : {}),
      };
    }

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  };

  // Clean up page constraints to remove undefined/empty values
  const cleanPageConstraints = (constraints: PrintLayoutFormValues['pageConstraints']) => {
    if (!constraints) return undefined;
    const cleaned: Record<string, any> = {};
    if (constraints.minPages !== undefined && constraints.minPages !== null) {
      cleaned.minPages = constraints.minPages;
    }
    if (constraints.maxPages !== undefined && constraints.maxPages !== null) {
      cleaned.maxPages = constraints.maxPages;
    }
    if (constraints.pageMultiple) {
      cleaned.pageMultiple = Number(constraints.pageMultiple) as 1 | 2 | 4;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  };

  const onSubmit = async (data: PrintLayoutFormValues) => {
    if (!firestore) return;

    setIsSaving(true);
    const payload = {
      ...data,
      leavesPerSpread: Number(data.leavesPerSpread) as 1 | 2,
      // Clean up optional string fields
      font: data.font || undefined,
      fontSize: data.fontSize || undefined,
      // Print product link (empty string -> undefined)
      printProductId: data.printProductId || undefined,
      // Page constraints
      pageConstraints: cleanPageConstraints(data.pageConstraints),
      // Clean layout configs to remove empty strings
      coverLayout: cleanLayoutConfig(data.coverLayout),
      backCoverLayout: cleanLayoutConfig(data.backCoverLayout),
      insideLayout: cleanLayoutConfig(data.insideLayout),
      titlePageLayout: cleanLayoutConfig(data.titlePageLayout),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = data.id ? doc(firestore, 'printLayouts', data.id) : doc(collection(firestore, 'printLayouts'));
      await setDoc(
        docRef,
        { ...payload, createdAt: payload.updatedAt },
        { merge: true }
      );
      toast({ title: 'Print layout saved' });
      onSave();
    } catch (error: any) {
      toast({ title: 'Error saving layout', description: error.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const renderBoxFields = (
    fields: any[],
    removeFn: (index: number) => void,
    prefix: 'textBoxes' | 'imageBoxes'
  ) => (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={field.id} className="grid grid-cols-6 gap-2 items-center rounded-md border p-2">
          <div className="col-span-6 text-xs font-semibold uppercase text-muted-foreground">Box {index + 1}</div>
          <div className="space-y-1">
            <Label className="text-xs">Leaf</Label>
            <Input type="number" {...register(`${prefix}.${index}.leaf`)} defaultValue={field.leaf} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">X</Label>
            <Input type="number" step="0.01" {...register(`${prefix}.${index}.x`)} defaultValue={field.x} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">Y</Label>
            <Input type="number" step="0.01" {...register(`${prefix}.${index}.y`)} defaultValue={field.y} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">W</Label>
            <Input type="number" step="0.01" {...register(`${prefix}.${index}.width`)} defaultValue={field.width} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">H</Label>
            <Input type="number" step="0.01" {...register(`${prefix}.${index}.height`)} defaultValue={field.height} />
          </div>
           <Button variant="ghost" size="icon" onClick={() => removeFn(index)} className="self-end">
             <Trash2 className="h-4 w-4 text-destructive" />
           </Button>
        </div>
      ))}
    </div>
  );

  // Render a page layout config section (cover, back cover, inside, or title page)
  const renderPageLayoutSection = (
    title: string,
    prefix: 'coverLayout' | 'backCoverLayout' | 'insideLayout' | 'titlePageLayout',
    options: { showImageBox?: boolean; showStyling?: boolean } = {}
  ) => {
    const { showImageBox = true, showStyling = true } = options;
    return (
      <div className="rounded-lg border p-4 space-y-4">
        <h4 className="font-semibold text-sm">{title}</h4>

        {showImageBox && (
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground">Image Box (inches)</Label>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">X</Label>
                <Input type="number" step="0.01" {...register(`${prefix}.imageBox.x`)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Y</Label>
                <Input type="number" step="0.01" {...register(`${prefix}.imageBox.y`)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">W</Label>
                <Input type="number" step="0.01" {...register(`${prefix}.imageBox.width`)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">H</Label>
                <Input type="number" step="0.01" {...register(`${prefix}.imageBox.height`)} />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground">Text Box (inches)</Label>
          <div className="grid grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">X</Label>
              <Input type="number" step="0.01" {...register(`${prefix}.textBox.x`)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Y</Label>
              <Input type="number" step="0.01" {...register(`${prefix}.textBox.y`)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">W</Label>
              <Input type="number" step="0.01" {...register(`${prefix}.textBox.width`)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">H</Label>
              <Input type="number" step="0.01" {...register(`${prefix}.textBox.height`)} />
            </div>
          </div>
          {showStyling && (
            <div className="grid grid-cols-2 gap-4 mt-2">
              <Controller
                name={`${prefix}.textBox.backgroundColor` as any}
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">BG Color</Label>
                    <Input
                      type="color"
                      className="w-10 h-8 p-1 cursor-pointer"
                      value={field.value || '#ffffff'}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                    <Input
                      type="text"
                      placeholder="#F5F5DC"
                      className="w-20 text-xs"
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </div>
                )}
              />
              <Controller
                name={`${prefix}.textBox.textColor` as any}
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Text Color</Label>
                    <Input
                      type="color"
                      className="w-10 h-8 p-1 cursor-pointer"
                      value={field.value || '#000000'}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                    <Input
                      type="text"
                      placeholder="#000000"
                      className="w-20 text-xs"
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </div>
                )}
              />
            </div>
          )}
          {showStyling && (
            <div className="flex items-center gap-2 mt-2">
              <Label className="text-xs whitespace-nowrap">Border Radius (in)</Label>
              <Input
                type="number"
                step="0.01"
                className="w-20 text-xs"
                placeholder="0.1"
                {...register(`${prefix}.textBox.borderRadius`)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="layout-name">Name</Label>
          <Input id="layout-name" {...register('name')} placeholder="e.g. 8.5x11 Portrait" />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label>Leaves per Spread</Label>
          <Controller
            name="leavesPerSpread"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 (Single Page)</SelectItem>
                  <SelectItem value="2">2 (Facing Pages)</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="leaf-width">Leaf Width (in)</Label>
          <Input id="leaf-width" type="number" step="0.01" {...register('leafWidth')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leaf-height">Leaf Height (in)</Label>
          <Input id="leaf-height" type="number" step="0.01" {...register('leafHeight')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="font">Font</Label>
          <Controller
            name="font"
            control={control}
            render={({ field }) => (
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger><SelectValue placeholder="Select font" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Helvetica">Helvetica</SelectItem>
                  <SelectItem value="Helvetica-Bold">Helvetica Bold</SelectItem>
                  <SelectItem value="TimesRoman">Times Roman</SelectItem>
                  <SelectItem value="Courier">Courier</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fontSize">Font Size (pt)</Label>
          <Input id="fontSize" type="number" step="0.5" {...register('fontSize')} />
        </div>
      </div>

      {/* Page-type-specific layouts */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Page-Type Layouts</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderPageLayoutSection('Cover (Front)', 'coverLayout', { showImageBox: true, showStyling: true })}
          {renderPageLayoutSection('Back Cover', 'backCoverLayout', { showImageBox: true, showStyling: true })}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderPageLayoutSection('Inside Pages', 'insideLayout', { showImageBox: true, showStyling: true })}
          {renderPageLayoutSection('Title Page', 'titlePageLayout', { showImageBox: false, showStyling: true })}
        </div>
      </div>

      {/* Print Product Link & Page Constraints */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Print Product & Page Constraints</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Print Product Link */}
          <div className="space-y-2">
            <Label>Linked Print Product</Label>
            <Controller
              name="printProductId"
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={(val) => field.onChange(val === '__none__' ? '' : val)}
                  value={field.value || '__none__'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No product linked">
                      {field.value ? (
                        <span className="flex items-center gap-2">
                          <Link2 className="h-4 w-4 text-green-600" />
                          {printProducts.find(p => p.id === field.value)?.name || field.value}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Link2Off className="h-4 w-4 text-muted-foreground" />
                          No product linked
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="flex items-center gap-2">
                        <Link2Off className="h-4 w-4" />
                        No product linked
                      </span>
                    </SelectItem>
                    {printProducts.filter((product) => product.id).map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        <span className="flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          {product.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              When linked, trim size auto-syncs from product. Page constraints default to product settings.
            </p>
            {linkedProduct && (
              <p className="text-xs text-blue-600">
                Product constraints: {linkedProduct.mixamSpec?.format?.minPageCount ?? 0}-{linkedProduct.mixamSpec?.format?.maxPageCount ?? '∞'} pages,
                multiple of {linkedProduct.mixamSpec?.format?.pageCountIncrement ?? 4}
              </p>
            )}
          </div>

          {/* Page Constraints */}
          <div className="space-y-3">
            <Label className="text-sm">Page Constraints (override product defaults)</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Min Pages</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder={linkedProduct ? String(linkedProduct.mixamSpec?.format?.minPageCount ?? '') : '0'}
                  {...register('pageConstraints.minPages')}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Pages</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder={linkedProduct ? String(linkedProduct.mixamSpec?.format?.maxPageCount ?? '') : '∞'}
                  {...register('pageConstraints.maxPages')}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Page Multiple</Label>
                <Controller
                  name="pageConstraints.pageMultiple"
                  control={control}
                  render={({ field }) => (
                    <Select
                      onValueChange={(val) => field.onChange(val === '__none__' ? undefined : val)}
                      value={field.value || '__none__'}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={linkedProduct ? `${linkedProduct.mixamSpec?.format?.pageCountIncrement ?? 4}` : 'Default'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Use default</SelectItem>
                        <SelectItem value="1">Any (1)</SelectItem>
                        <SelectItem value="2">Even (2)</SelectItem>
                        <SelectItem value="4">Multiple of 4</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to inherit from linked product, or set explicit values to override.
            </p>
          </div>
        </div>
      </div>

      {/* Legacy text/image boxes (collapsed by default) */}
      <details className="border rounded-lg p-4">
        <summary className="font-medium text-sm cursor-pointer">Legacy Box Arrays (for backwards compatibility)</summary>
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Text Boxes</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => appendTextBox({ leaf: 1, x: 1, y: 1, width: 6, height: 2 })}>
                <Plus className="mr-2 h-4 w-4" /> Add
              </Button>
            </div>
            {renderBoxFields(textBoxFields, removeTextBox, 'textBoxes')}
            {errors.textBoxes && <p className="text-xs text-destructive mt-1">{errors.textBoxes.message || errors.textBoxes.root?.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Image Boxes</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => appendImageBox({ leaf: 1, x: 1, y: 1, width: 6, height: 4 })}>
                <Plus className="mr-2 h-4 w-4" /> Add
              </Button>
            </div>
            {renderBoxFields(imageBoxFields, removeImageBox, 'imageBoxes')}
            {errors.imageBoxes && <p className="text-xs text-destructive mt-1">{errors.imageBoxes.message || errors.imageBoxes.root?.message}</p>}
          </div>
        </div>
      </details>

      <DialogFooter>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save Layout
        </Button>
      </DialogFooter>
    </form>
  );
}


function PrintLayoutsPanel() {
  const firestore = useFirestore();
  const layoutsQuery = useMemo(() => (firestore ? collection(firestore, 'printLayouts') : null), [firestore]);
  const { data: layouts, loading, error } = useCollection<PrintLayout>(layoutsQuery);

  // Load print products for the form dropdown
  const printProductsQuery = useMemo(
    () => firestore ? query(collection(firestore, 'printProducts'), where('active', '==', true)) : null,
    [firestore]
  );
  const { data: printProducts, loading: productsLoading } = useCollection<PrintProduct>(printProductsQuery);

  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayout, setEditingLayout] = useState<PrintLayout | null>(null);

  const handleSeedLayouts = useCallback(async () => {
    if (!firestore) return;
    try {
      const batch = writeBatch(firestore);
      SampleLayoutData.printLayouts.forEach((layout) => {
        const docRef = doc(firestore, 'printLayouts', layout.id);
        batch.set(docRef, {
          ...layout,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      toast({ title: 'Success', description: 'Default print layout has been seeded.' });
    } catch (e: any) {
      toast({ title: 'Error seeding data', description: e.message, variant: 'destructive' });
    }
  }, [firestore, toast]);
  
  useEffect(() => {
    if (!loading && !error && layouts?.length === 0) {
      handleSeedLayouts();
    }
  }, [loading, error, layouts, handleSeedLayouts]);

  const openCreate = () => {
    setEditingLayout(null);
    setDialogOpen(true);
  };

  const openEdit = (item: PrintLayout) => {
    setEditingLayout(item);
    setDialogOpen(true);
  };
  
  const handleSave = () => {
    setDialogOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Print Layouts</CardTitle>
          <CardDescription>Manage the physical layouts for printed books.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeedLayouts}>
            Re-seed Defaults
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Layout
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {(loading || productsLoading) && <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />}
        {!loading && !productsLoading && layouts && layouts.length === 0 && (
          <p className="text-sm text-muted-foreground">No print layouts yet. Seeding default...</p>
        )}
        {!loading && !productsLoading && layouts && layouts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Dimensions</TableHead>
                <TableHead>Spreads</TableHead>
                <TableHead>Print Product</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {layouts.map((layout) => {
                const linkedProduct = layout.printProductId
                  ? printProducts?.find(p => p.id === layout.printProductId)
                  : null;
                return (
                  <TableRow key={layout.id}>
                    <TableCell className="font-medium">{layout.name}</TableCell>
                    <TableCell>{layout.leafWidth}" x {layout.leafHeight}"</TableCell>
                    <TableCell>{layout.leavesPerSpread === 2 ? 'Two-leaf' : 'One-leaf'}</TableCell>
                    <TableCell>
                      {linkedProduct ? (
                        <span className="flex items-center gap-1 text-sm">
                          <Link2 className="h-3 w-3 text-green-600" />
                          {linkedProduct.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(layout)}>
                        <Edit className="mr-1 h-4 w-4" /> Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLayout ? 'Edit Print Layout' : 'New Print Layout'}</DialogTitle>
          </DialogHeader>
          <PrintLayoutForm
            editingLayout={editingLayout}
            onSave={handleSave}
            printProducts={printProducts || []}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminPrintLayoutsPage() {
    const { isAdmin, isWriter, loading: adminLoading } = useAdminStatus();

    if (adminLoading) {
        return <div className="flex justify-center items-center h-screen"><LoaderCircle className="h-8 w-8 animate-spin" /></div>;
    }

    if (!isAdmin && !isWriter) {
        return <p className="text-destructive text-center p-8">Admin or writer access required.</p>;
    }

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8">
            <PrintLayoutsPanel />
        </div>
    );
}

    