'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useUser } from '@/firebase/auth/use-user';
import { LoaderCircle, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { MixamProductMapping } from '@/lib/types';

type CatalogueProduct = {
  id: number;
  name: string;
  subProducts?: { id: number; name: string }[];
};

type CatalogueData = {
  products?: CatalogueProduct[] | Record<string, string>;
  dinSizes?: Record<string, any[]>;
  standardSizes?: Record<string, any[]>;
};

type ProductMetadata = {
  productId: number;
  subProductId: number;
  formats?: any[];
  substrates?: any[];
  bindings?: any[];
  laminations?: any[];
  raw?: any;
};

type SubstrateOption = {
  typeId: number;
  typeName: string;
  weights: { id: number; weight: number; unit?: string }[];
};

// Helper to convert products map to array
function parseProducts(products: any): CatalogueProduct[] {
  if (Array.isArray(products)) {
    return products;
  }
  if (typeof products === 'object' && products !== null) {
    return Object.entries(products).map(([id, name]) => ({
      id: parseInt(id, 10),
      name: String(name),
    })).sort((a, b) => a.id - b.id);
  }
  return [];
}

// DIN format labels
const DIN_FORMAT_LABELS: Record<number, string> = {
  0: 'A0 (841 x 1189 mm)',
  1: 'A1 (594 x 841 mm)',
  2: 'A2 (420 x 594 mm)',
  3: 'A3 (297 x 420 mm)',
  4: 'A4 (210 x 297 mm)',
  5: 'A5 (148 x 210 mm)',
  6: 'A6 (105 x 148 mm)',
  7: 'A7 (74 x 105 mm)',
};

// Common standard sizes for books
const STANDARD_SIZE_LABELS: Record<string, string> = {
  'IN_8_5_X_11': 'Letter (8.5" x 11" / 216 x 279 mm)',
  'IN_8_X_10': '8" x 10" (203 x 254 mm)',
  'US_ROYAL': 'US Royal (6" x 9" / 152 x 229 mm)',
  'DEMY': 'Demy (5.5" x 8.5" / 138 x 216 mm)',
  'NOVEL': 'Novel (5" x 8" / 127 x 203 mm)',
  'ROYAL': 'Royal (156 x 234 mm)',
  'SQUARE_210_MM': 'Square 210mm',
  'SQUARE_200_MM': 'Square 200mm',
};

type MixamMappingEditorProps = {
  value?: MixamProductMapping;
  onChange: (mapping: MixamProductMapping | undefined) => void;
};

export function MixamMappingEditor({ value, onChange }: MixamMappingEditorProps) {
  const { user } = useUser();
  const [expanded, setExpanded] = useState(!!value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalogue data
  const [catalogue, setCatalogue] = useState<CatalogueData | null>(null);
  const [metadata, setMetadata] = useState<ProductMetadata | null>(null);

  // Form state - initialize from value or defaults
  const [productId, setProductId] = useState<number>(value?.productId ?? 7); // 7 = BOOK
  const [subProductId, setSubProductId] = useState<number>(value?.subProductId ?? 1); // 1 = Hardcover

  // Bound component
  const [boundFormat, setBoundFormat] = useState<number>(value?.boundComponent?.format ?? 4);
  const [boundStandardSize, setBoundStandardSize] = useState<string>(value?.boundComponent?.standardSize ?? '');
  const [boundOrientation, setBoundOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>(value?.boundComponent?.orientation ?? 'PORTRAIT');
  const [boundSubstrateType, setBoundSubstrateType] = useState<number>(value?.boundComponent?.substrate?.typeId ?? 1);
  const [boundSubstrateWeight, setBoundSubstrateWeight] = useState<number>(value?.boundComponent?.substrate?.weightId ?? 5);
  const [boundSubstrateColour, setBoundSubstrateColour] = useState<number>(value?.boundComponent?.substrate?.colourId ?? 0);

  // Cover component
  const [coverFormat, setCoverFormat] = useState<number>(value?.coverComponent?.format ?? 4);
  const [coverStandardSize, setCoverStandardSize] = useState<string>(value?.coverComponent?.standardSize ?? '');
  const [coverOrientation, setCoverOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>(value?.coverComponent?.orientation ?? 'PORTRAIT');
  const [coverSubstrateType, setCoverSubstrateType] = useState<number>(value?.coverComponent?.substrate?.typeId ?? 1);
  const [coverSubstrateWeight, setCoverSubstrateWeight] = useState<number>(value?.coverComponent?.substrate?.weightId ?? 5);
  const [coverSubstrateColour, setCoverSubstrateColour] = useState<number>(value?.coverComponent?.substrate?.colourId ?? 0);
  const [coverLamination, setCoverLamination] = useState<'NONE' | 'GLOSS' | 'MATT' | 'SOFT_TOUCH'>(value?.coverComponent?.lamination ?? 'MATT');
  const [coverBackColours, setCoverBackColours] = useState<'PROCESS' | 'NONE'>(value?.coverComponent?.backColours ?? 'NONE');

  // End papers
  const [hasEndPapers, setHasEndPapers] = useState<boolean>(!!value?.endPapersComponent);
  const [endPapersSubstrateType, setEndPapersSubstrateType] = useState<number>(value?.endPapersComponent?.substrate?.typeId ?? 0);
  const [endPapersSubstrateWeight, setEndPapersSubstrateWeight] = useState<number>(value?.endPapersComponent?.substrate?.weightId ?? 0);
  const [endPapersSubstrateColour, setEndPapersSubstrateColour] = useState<number>(value?.endPapersComponent?.substrate?.colourId ?? 1);

  // Binding
  const [bindingType, setBindingType] = useState<'PUR' | 'CASE' | 'STAPLED' | 'LOOP' | 'WIRO'>(value?.binding?.type ?? 'CASE');
  const [bindingEdge, setBindingEdge] = useState<'LEFT_RIGHT' | 'TOP_BOTTOM'>(value?.binding?.edge ?? 'LEFT_RIGHT');
  const [bindingSewn, setBindingSewn] = useState<boolean>(value?.binding?.sewn ?? false);

  // Validation state
  const [validated, setValidated] = useState<boolean>(value?.validated ?? false);

  // Fetch auth headers
  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    return {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  }, [user]);

  // Fetch catalogue
  const fetchCatalogue = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/mixam-catalogue?type=catalogue', { headers });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch catalogue');
      }
      setCatalogue(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, getAuthHeaders]);

  // Fetch metadata for selected product/subProduct
  const fetchMetadata = useCallback(async (pid: number, spid: number) => {
    if (!user) return;

    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/admin/mixam-catalogue?type=metadata&productId=${pid}&subProductId=${spid}`,
        { headers }
      );
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch metadata');
      }
      setMetadata(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, getAuthHeaders]);

  // When product/subProduct changes, fetch metadata
  useEffect(() => {
    if (expanded && catalogue && productId && subProductId !== undefined) {
      fetchMetadata(productId, subProductId);
    }
  }, [expanded, catalogue, productId, subProductId, fetchMetadata]);

  // Build the mapping object from current state
  const buildMapping = useCallback((): MixamProductMapping => {
    const mapping: MixamProductMapping = {
      productId,
      subProductId,
      validated,
      validatedAt: validated ? new Date() : undefined,
      boundComponent: {
        format: boundFormat,
        ...(boundStandardSize ? { standardSize: boundStandardSize } : {}),
        orientation: boundOrientation,
        substrate: {
          typeId: boundSubstrateType,
          weightId: boundSubstrateWeight,
          colourId: boundSubstrateColour,
        },
      },
      coverComponent: {
        format: coverFormat,
        ...(coverStandardSize ? { standardSize: coverStandardSize } : {}),
        orientation: coverOrientation,
        substrate: {
          typeId: coverSubstrateType,
          weightId: coverSubstrateWeight,
          colourId: coverSubstrateColour,
        },
        lamination: coverLamination,
        backColours: coverBackColours,
      },
      binding: {
        type: bindingType,
        edge: bindingEdge,
        sewn: bindingSewn,
      },
    };

    if (hasEndPapers) {
      mapping.endPapersComponent = {
        substrate: {
          typeId: endPapersSubstrateType,
          weightId: endPapersSubstrateWeight,
          colourId: endPapersSubstrateColour,
        },
      };
    }

    return mapping;
  }, [
    productId, subProductId, validated,
    boundFormat, boundStandardSize, boundOrientation, boundSubstrateType, boundSubstrateWeight, boundSubstrateColour,
    coverFormat, coverStandardSize, coverOrientation, coverSubstrateType, coverSubstrateWeight, coverSubstrateColour, coverLamination, coverBackColours,
    hasEndPapers, endPapersSubstrateType, endPapersSubstrateWeight, endPapersSubstrateColour,
    bindingType, bindingEdge, bindingSewn,
  ]);

  // Update parent when values change
  useEffect(() => {
    if (expanded) {
      // Mark as not validated when any value changes
      setValidated(false);
      onChange(buildMapping());
    }
  }, [
    productId, subProductId,
    boundFormat, boundStandardSize, boundOrientation, boundSubstrateType, boundSubstrateWeight, boundSubstrateColour,
    coverFormat, coverStandardSize, coverOrientation, coverSubstrateType, coverSubstrateWeight, coverSubstrateColour, coverLamination, coverBackColours,
    hasEndPapers, endPapersSubstrateType, endPapersSubstrateWeight, endPapersSubstrateColour,
    bindingType, bindingEdge, bindingSewn,
  ]); // Note: excluding buildMapping and onChange from deps to avoid infinite loop

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // Handle validation - calls the API to validate against Mixam catalogue
  const handleValidate = async () => {
    if (!user) return;

    setValidating(true);
    setValidationErrors([]);
    setValidationWarnings([]);

    try {
      const headers = await getAuthHeaders();
      const mapping = buildMapping();

      const response = await fetch('/api/admin/print-products/validate-mixam', {
        method: 'POST',
        headers,
        body: JSON.stringify(mapping),
      });

      const result = await response.json();

      if (!result.ok) {
        setValidationErrors([result.error || 'Validation request failed']);
        return;
      }

      const { validation } = result;
      setValidationErrors(validation.errors || []);
      setValidationWarnings(validation.warnings || []);

      if (validation.valid) {
        setValidated(true);
        mapping.validated = true;
        mapping.validatedAt = new Date();
        onChange(mapping);
      } else {
        setValidated(false);
        mapping.validated = false;
        onChange(mapping);
      }
    } catch (err: any) {
      setValidationErrors([err.message || 'Failed to validate mapping']);
    } finally {
      setValidating(false);
    }
  };

  // Handle clear mapping
  const handleClear = () => {
    setExpanded(false);
    onChange(undefined);
  };

  // Parse substrates from metadata
  const parseSubstrates = (meta: ProductMetadata | null): SubstrateOption[] => {
    if (!meta?.substrates) return [];
    return meta.substrates.map((s: any) => ({
      typeId: s.typeId ?? s.id ?? 0,
      typeName: s.typeName ?? s.name ?? 'Unknown',
      weights: s.weights || [],
    }));
  };

  const substrates = parseSubstrates(metadata);
  const products = catalogue ? parseProducts(catalogue.products) : [];

  // Get available standard sizes from catalogue
  const availableStandardSizes = catalogue?.standardSizes ? Object.keys(catalogue.standardSizes) : [];

  return (
    <Card className="border-dashed">
      <CardHeader
        className="cursor-pointer"
        onClick={() => {
          if (!expanded && !catalogue) {
            fetchCatalogue();
          }
          setExpanded(!expanded);
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              Mixam Catalogue Mapping
              {value?.validated && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Validated
                </Badge>
              )}
              {value && !value.validated && (
                <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Not Validated
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Map this product to exact Mixam catalogue IDs for reliable order submission
            </CardDescription>
          </div>
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}

          {/* Load Catalogue Button */}
          {!catalogue && (
            <Button onClick={fetchCatalogue} disabled={loading}>
              {loading ? <LoaderCircle className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Load Mixam Catalogue
            </Button>
          )}

          {catalogue && (
            <>
              {/* Product Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Product</Label>
                  <Select
                    value={String(productId)}
                    onValueChange={(v) => setProductId(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} (ID: {p.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sub-Product</Label>
                  <Select
                    value={String(subProductId)}
                    onValueChange={(v) => setSubProductId(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Paperback (ID: 0)</SelectItem>
                      <SelectItem value="1">Hardcover (ID: 1)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Bound Component (Interior) */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-sm">Interior (Bound Component)</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">DIN Format</Label>
                    <Select value={String(boundFormat)} onValueChange={(v) => setBoundFormat(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DIN_FORMAT_LABELS).map(([id, label]) => (
                          <SelectItem key={id} value={id}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Standard Size (optional)</Label>
                    <Select value={boundStandardSize || '_none_'} onValueChange={(v) => setBoundStandardSize(v === '_none_' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="None (use DIN)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">None (use DIN only)</SelectItem>
                        {availableStandardSizes.slice(0, 30).map((key) => (
                          <SelectItem key={key} value={key}>
                            {STANDARD_SIZE_LABELS[key] || key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Orientation</Label>
                    <Select value={boundOrientation} onValueChange={(v) => setBoundOrientation(v as 'PORTRAIT' | 'LANDSCAPE')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PORTRAIT">Portrait</SelectItem>
                        <SelectItem value="LANDSCAPE">Landscape</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Substrate Type</Label>
                    <Select value={String(boundSubstrateType)} onValueChange={(v) => setBoundSubstrateType(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {substrates.length > 0 ? (
                          substrates.map((s) => (
                            <SelectItem key={s.typeId} value={String(s.typeId)}>
                              {s.typeName} (ID: {s.typeId})
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="1">Silk (ID: 1)</SelectItem>
                            <SelectItem value="2">Gloss (ID: 2)</SelectItem>
                            <SelectItem value="3">Uncoated (ID: 3)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Weight ID</Label>
                    <Select value={String(boundSubstrateWeight)} onValueChange={(v) => setBoundSubstrateWeight(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {substrates.find(s => s.typeId === boundSubstrateType)?.weights?.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.weight} {w.unit || 'GSM'} (ID: {w.id})
                          </SelectItem>
                        )) || (
                          <>
                            <SelectItem value="0">90 GSM (ID: 0)</SelectItem>
                            <SelectItem value="2">115 GSM (ID: 2)</SelectItem>
                            <SelectItem value="3">130 GSM (ID: 3)</SelectItem>
                            <SelectItem value="4">150 GSM (ID: 4)</SelectItem>
                            <SelectItem value="5">170 GSM (ID: 5)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Colour ID</Label>
                    <Select value={String(boundSubstrateColour)} onValueChange={(v) => setBoundSubstrateColour(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">White (ID: 0)</SelectItem>
                        <SelectItem value="1">Cream (ID: 1)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Cover Component */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-sm">Cover Component</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">DIN Format</Label>
                    <Select value={String(coverFormat)} onValueChange={(v) => setCoverFormat(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DIN_FORMAT_LABELS).map(([id, label]) => (
                          <SelectItem key={id} value={id}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Standard Size (optional)</Label>
                    <Select value={coverStandardSize || '_none_'} onValueChange={(v) => setCoverStandardSize(v === '_none_' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="None (use DIN)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">None (use DIN only)</SelectItem>
                        {availableStandardSizes.slice(0, 30).map((key) => (
                          <SelectItem key={key} value={key}>
                            {STANDARD_SIZE_LABELS[key] || key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Orientation</Label>
                    <Select value={coverOrientation} onValueChange={(v) => setCoverOrientation(v as 'PORTRAIT' | 'LANDSCAPE')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PORTRAIT">Portrait</SelectItem>
                        <SelectItem value="LANDSCAPE">Landscape</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Lamination</Label>
                    <Select value={coverLamination} onValueChange={(v) => setCoverLamination(v as 'NONE' | 'GLOSS' | 'MATT' | 'SOFT_TOUCH')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None</SelectItem>
                        <SelectItem value="GLOSS">Gloss</SelectItem>
                        <SelectItem value="MATT">Matt</SelectItem>
                        <SelectItem value="SOFT_TOUCH">Soft Touch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Substrate Type</Label>
                    <Select value={String(coverSubstrateType)} onValueChange={(v) => setCoverSubstrateType(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {substrates.length > 0 ? (
                          substrates.map((s) => (
                            <SelectItem key={s.typeId} value={String(s.typeId)}>
                              {s.typeName} (ID: {s.typeId})
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="1">Silk (ID: 1)</SelectItem>
                            <SelectItem value="2">Gloss (ID: 2)</SelectItem>
                            <SelectItem value="3">Uncoated (ID: 3)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Weight ID</Label>
                    <Select value={String(coverSubstrateWeight)} onValueChange={(v) => setCoverSubstrateWeight(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {substrates.find(s => s.typeId === coverSubstrateType)?.weights?.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.weight} {w.unit || 'GSM'} (ID: {w.id})
                          </SelectItem>
                        )) || (
                          <>
                            <SelectItem value="0">90 GSM (ID: 0)</SelectItem>
                            <SelectItem value="5">170 GSM (ID: 5)</SelectItem>
                            <SelectItem value="14">200 GSM (ID: 14)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Colour ID</Label>
                    <Select value={String(coverSubstrateColour)} onValueChange={(v) => setCoverSubstrateColour(parseInt(v, 10))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">White (ID: 0)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Back Colours</Label>
                    <Select value={coverBackColours} onValueChange={(v) => setCoverBackColours(v as 'PROCESS' | 'NONE')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None (hardcover)</SelectItem>
                        <SelectItem value="PROCESS">Process (paperback)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* End Papers (for hardcover) */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">End Papers (Hardcover only)</h4>
                  <Switch checked={hasEndPapers} onCheckedChange={setHasEndPapers} />
                </div>
                {hasEndPapers && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Substrate Type ID</Label>
                      <Select value={String(endPapersSubstrateType)} onValueChange={(v) => setEndPapersSubstrateType(parseInt(v, 10))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Standard (ID: 0)</SelectItem>
                          <SelectItem value="1">Premium (ID: 1)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Weight ID</Label>
                      <Select value={String(endPapersSubstrateWeight)} onValueChange={(v) => setEndPapersSubstrateWeight(parseInt(v, 10))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Default (ID: 0)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Colour ID</Label>
                      <Select value={String(endPapersSubstrateColour)} onValueChange={(v) => setEndPapersSubstrateColour(parseInt(v, 10))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">White (ID: 0)</SelectItem>
                          <SelectItem value="1">Colored (ID: 1)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              {/* Binding */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <h4 className="font-medium text-sm">Binding</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Binding Type</Label>
                    <Select value={bindingType} onValueChange={(v) => setBindingType(v as 'PUR' | 'CASE' | 'STAPLED' | 'LOOP' | 'WIRO')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASE">Case Binding (Hardcover)</SelectItem>
                        <SelectItem value="PUR">PUR Binding (Paperback)</SelectItem>
                        <SelectItem value="STAPLED">Stapled</SelectItem>
                        <SelectItem value="LOOP">Loop Stitch</SelectItem>
                        <SelectItem value="WIRO">Wire-O</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Binding Edge</Label>
                    <Select value={bindingEdge} onValueChange={(v) => setBindingEdge(v as 'LEFT_RIGHT' | 'TOP_BOTTOM')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LEFT_RIGHT">Left/Right</SelectItem>
                        <SelectItem value="TOP_BOTTOM">Top/Bottom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 flex items-end gap-2">
                    <Switch id="sewn" checked={bindingSewn} onCheckedChange={setBindingSewn} />
                    <Label htmlFor="sewn" className="text-xs">Sewn</Label>
                  </div>
                </div>
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm space-y-1">
                  <div className="font-medium flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    Validation Failed
                  </div>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Validation Warnings */}
              {validationWarnings.length > 0 && validationErrors.length === 0 && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm space-y-1">
                  <div className="font-medium">Warnings:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {validationWarnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex items-center gap-2">
                  {validated ? (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Mapping Validated
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Not Validated
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    Clear Mapping
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchMetadata(productId, subProductId)}
                    disabled={loading}
                  >
                    {loading ? <LoaderCircle className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Refresh Options
                  </Button>
                  <Button size="sm" onClick={handleValidate} disabled={validating || validated}>
                    {validating ? <LoaderCircle className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    {validating ? 'Validating...' : 'Validate Mapping'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
