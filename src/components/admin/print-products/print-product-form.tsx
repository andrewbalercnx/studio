'use client';
import { useState } from 'react';
import { useFirestore } from '@/firebase';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { PrintProduct, MixamProductMapping } from '@/lib/types';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { MixamMappingEditor } from '@/components/admin/MixamMappingEditor';
import { zodResolver } from '@hookform/resolvers/zod';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { PrintProductFormValues, defaultFormValues, printProductFormSchema } from './shared';

export function PrintProductForm({
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

      await api.catalog.admin.set('printProducts', docId, docData, { merge: true });

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
