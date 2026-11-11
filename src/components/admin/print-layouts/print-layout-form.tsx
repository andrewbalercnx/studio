'use client';
import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Trash2, Link2, Link2Off } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { PrintLayout, PrintProduct } from '@/lib/types';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { FontSelector } from './font-selector';
import { PrintLayoutFormValues, defaultFormValues, printLayoutFormSchema } from './shared';

export function PrintLayoutForm({
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
          coverLayout: {
            textBoxEnabled: editingLayout.coverLayout?.textBoxEnabled ?? true,
            imageBoxEnabled: editingLayout.coverLayout?.imageBoxEnabled ?? true,
            ...editingLayout.coverLayout,
          },
          backCoverLayout: {
            textBoxEnabled: editingLayout.backCoverLayout?.textBoxEnabled ?? true,
            imageBoxEnabled: editingLayout.backCoverLayout?.imageBoxEnabled ?? true,
            ...editingLayout.backCoverLayout,
          },
          insideLayout: {
            textBoxEnabled: editingLayout.insideLayout?.textBoxEnabled ?? true,
            imageBoxEnabled: editingLayout.insideLayout?.imageBoxEnabled ?? true,
            ...editingLayout.insideLayout,
          },
          titlePageLayout: {
            textBoxEnabled: editingLayout.titlePageLayout?.textBoxEnabled ?? true,
            imageBoxEnabled: editingLayout.titlePageLayout?.imageBoxEnabled ?? false,
            ...editingLayout.titlePageLayout,
          },
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

    // Preserve enabled flags
    if (config.textBoxEnabled !== undefined) {
      cleaned.textBoxEnabled = config.textBoxEnabled;
    }
    if (config.imageBoxEnabled !== undefined) {
      cleaned.imageBoxEnabled = config.imageBoxEnabled;
    }

    if (config.imageBox) {
      const { leaf, x, y, width, height } = config.imageBox;
      // Only include imageBox if it has valid dimensions
      if (x !== undefined || y !== undefined || width !== undefined || height !== undefined) {
        cleaned.imageBox = {
          ...(leaf !== undefined && leaf !== null ? { leaf } : {}),
          x, y, width, height
        };
      }
    }

    if (config.textBox) {
      const { leaf, x, y, width, height, backgroundColor, textColor, borderRadius } = config.textBox;
      cleaned.textBox = {
        ...(leaf !== undefined && leaf !== null ? { leaf } : {}),
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
    };

    try {
      if (data.id) await api.catalog.admin.set('printLayouts', data.id, payload, { merge: true });
      else await api.catalog.admin.create('printLayouts', payload);
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
            <Input type="number" step="any" {...register(`${prefix}.${index}.x`)} defaultValue={field.x} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">Y</Label>
            <Input type="number" step="any" {...register(`${prefix}.${index}.y`)} defaultValue={field.y} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">W</Label>
            <Input type="number" step="any" {...register(`${prefix}.${index}.width`)} defaultValue={field.width} />
          </div>
           <div className="space-y-1">
            <Label className="text-xs">H</Label>
            <Input type="number" step="any" {...register(`${prefix}.${index}.height`)} defaultValue={field.height} />
          </div>
           <Button variant="ghost" size="icon" onClick={() => removeFn(index)} className="self-end">
             <Trash2 className="h-4 w-4 text-destructive" />
           </Button>
        </div>
      ))}
    </div>
  );

  // Watch leavesPerSpread for conditional leaf selection
  const watchedLeavesPerSpread = watch('leavesPerSpread');
  const isTwoLeafSpread = watchedLeavesPerSpread === '2';

  // Render a page layout config section (cover, back cover, inside, or title page)
  const renderPageLayoutSection = (
    title: string,
    prefix: 'coverLayout' | 'backCoverLayout' | 'insideLayout' | 'titlePageLayout',
    options: { showStyling?: boolean; showLeafSelector?: boolean } = {}
  ) => {
    const { showStyling = true, showLeafSelector = false } = options;
    const showLeafDropdown = showLeafSelector && isTwoLeafSpread;

    return (
      <div className="rounded-lg border p-4 space-y-4">
        <h4 className="font-semibold text-sm">{title}</h4>

        {/* Image Box Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Image Box</Label>
            <Controller
              name={`${prefix}.imageBoxEnabled` as any}
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Enabled</Label>
                  <Switch
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </div>
          <Controller
            name={`${prefix}.imageBoxEnabled` as any}
            control={control}
            render={({ field: enabledField }) => (
              enabledField.value !== false ? (
                <div className="space-y-2">
                  <div className={`grid gap-2 ${showLeafDropdown ? 'grid-cols-5' : 'grid-cols-4'}`}>
                    {showLeafDropdown && (
                      <div className="space-y-1">
                        <Label className="text-xs">Leaf</Label>
                        <Controller
                          name={`${prefix}.imageBox.leaf` as any}
                          control={control}
                          render={({ field }) => (
                            <Select
                              onValueChange={(val) => field.onChange(val === '__none__' ? undefined : Number(val))}
                              value={field.value?.toString() || '__none__'}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">—</SelectItem>
                                <SelectItem value="1">1 (Left)</SelectItem>
                                <SelectItem value="2">2 (Right)</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">X</Label>
                      <Input type="number" step="any" {...register(`${prefix}.imageBox.x`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Y</Label>
                      <Input type="number" step="any" {...register(`${prefix}.imageBox.y`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">W</Label>
                      <Input type="number" step="any" {...register(`${prefix}.imageBox.width`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">H</Label>
                      <Input type="number" step="any" {...register(`${prefix}.imageBox.height`)} />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Image box disabled for this page type</p>
              )
            )}
          />
        </div>

        {/* Text Box Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Text Box</Label>
            <Controller
              name={`${prefix}.textBoxEnabled` as any}
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Enabled</Label>
                  <Switch
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </div>
          <Controller
            name={`${prefix}.textBoxEnabled` as any}
            control={control}
            render={({ field: enabledField }) => (
              enabledField.value !== false ? (
                <div className="space-y-2">
                  <div className={`grid gap-2 ${showLeafDropdown ? 'grid-cols-5' : 'grid-cols-4'}`}>
                    {showLeafDropdown && (
                      <div className="space-y-1">
                        <Label className="text-xs">Leaf</Label>
                        <Controller
                          name={`${prefix}.textBox.leaf` as any}
                          control={control}
                          render={({ field }) => (
                            <Select
                              onValueChange={(val) => field.onChange(val === '__none__' ? undefined : Number(val))}
                              value={field.value?.toString() || '__none__'}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">—</SelectItem>
                                <SelectItem value="1">1 (Left)</SelectItem>
                                <SelectItem value="2">2 (Right)</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">X</Label>
                      <Input type="number" step="any" {...register(`${prefix}.textBox.x`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Y</Label>
                      <Input type="number" step="any" {...register(`${prefix}.textBox.y`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">W</Label>
                      <Input type="number" step="any" {...register(`${prefix}.textBox.width`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">H</Label>
                      <Input type="number" step="any" {...register(`${prefix}.textBox.height`)} />
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
                        step="any"
                        className="w-20 text-xs"
                        placeholder="0.1"
                        {...register(`${prefix}.textBox.borderRadius`)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Text box disabled for this page type</p>
              )
            )}
          />
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="leaf-width">Leaf Width (in)</Label>
          <Input id="leaf-width" type="number" step="any" {...register('leafWidth')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leaf-height">Leaf Height (in)</Label>
          <Input id="leaf-height" type="number" step="any" {...register('leafHeight')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fontSize">Font Size (pt)</Label>
          <Input id="fontSize" type="number" step="any" {...register('fontSize')} />
        </div>
      </div>

      {/* Font Selection */}
      <Controller
        name="font"
        control={control}
        render={({ field }) => (
          <FontSelector value={field.value} onChange={field.onChange} />
        )}
      />

      {/* Page-type-specific layouts */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm border-b pb-2">Page-Type Layouts</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderPageLayoutSection('Cover (Front)', 'coverLayout', { showStyling: true })}
          {renderPageLayoutSection('Back Cover', 'backCoverLayout', { showStyling: true })}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderPageLayoutSection('Inside Pages', 'insideLayout', { showStyling: true, showLeafSelector: true })}
          {renderPageLayoutSection('Title Page', 'titlePageLayout', { showStyling: true })}
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
