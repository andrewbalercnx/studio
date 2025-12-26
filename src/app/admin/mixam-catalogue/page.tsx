'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/firebase/auth/use-user';

type CatalogueProduct = {
  id: number;
  name: string;
  subProducts?: { id: number; name: string }[];
};

type CatalogueData = {
  products?: CatalogueProduct[] | Record<string, string>;
  dinSizes?: Record<string, any[]>;
  standardSizes?: Record<string, any[]>;
  [key: string]: any;
};

// Helper to convert products map to array
function parseProducts(products: any): CatalogueProduct[] {
  if (Array.isArray(products)) {
    return products;
  }
  if (typeof products === 'object' && products !== null) {
    // Convert { "7": "BOOK", "1": "BROCHURES" } to array format
    return Object.entries(products).map(([id, name]) => ({
      id: parseInt(id, 10),
      name: String(name),
    })).sort((a, b) => a.id - b.id);
  }
  return [];
}

export default function MixamCataloguePage() {
  const { user, loading: userLoading } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueData | null>(null);
  const [metadata, setMetadata] = useState<any | null>(null);
  const [spec, setSpec] = useState<any | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [selectedSubProduct, setSelectedSubProduct] = useState<number | null>(null);

  async function getAuthHeaders(): Promise<HeadersInit> {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    return {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  }

  const fetchCatalogue = async () => {
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
      setMetadata(null);
      setSpec(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async (productId: number, subProductId: number) => {
    setLoading(true);
    setError(null);
    setSelectedProduct(productId);
    setSelectedSubProduct(subProductId);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/admin/mixam-catalogue?type=metadata&productId=${productId}&subProductId=${subProductId}`,
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
  };

  const fetchSpec = async (productId: number, subProductId: number) => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/admin/mixam-catalogue?type=spec&productId=${productId}&subProductId=${subProductId}`,
        { headers }
      );
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch spec');
      }
      setSpec(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking auth
  if (userLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p>Loading...</p>
      </div>
    );
  }

  // Show login message if not authenticated
  if (!user) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-red-600">Please log in as an admin to access this page.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Mixam Catalogue Explorer</h1>
      <p className="text-gray-600 mb-6">
        Use this tool to explore Mixam&apos;s product catalogue and find the correct format/substrate IDs for orders.
      </p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="mb-6">
        <Button onClick={fetchCatalogue} disabled={loading}>
          {loading ? 'Loading...' : 'Fetch Catalogue'}
        </Button>
      </div>

      {/* Products List */}
      {catalogue && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Products</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const products = parseProducts(catalogue.products);
              if (products.length > 0) {
                return (
                  <div className="space-y-4">
                    {products.map((product: CatalogueProduct) => (
                      <div key={product.id} className="border-b pb-4 last:border-b-0">
                        <div className="font-semibold text-lg">
                          {product.name} (ID: {product.id})
                        </div>
                        <div className="mt-2 ml-4 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fetchMetadata(product.id, 0)}
                            disabled={loading}
                          >
                            Get Metadata (Sub 0)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fetchMetadata(product.id, 1)}
                            disabled={loading}
                          >
                            Get Metadata (Sub 1)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fetchSpec(product.id, 0)}
                            disabled={loading}
                          >
                            Get Spec (Sub 0)
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              return (
                <div className="text-gray-600">
                  <p className="mb-4">No products found. Raw catalogue data:</p>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-96">
                    {JSON.stringify(catalogue, null, 2)}
                  </pre>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* DIN Sizes */}
      {catalogue?.dinSizes && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>DIN Sizes (Format IDs)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 p-4 rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Format ID</th>
                    <th className="text-left py-2">Label</th>
                    <th className="text-left py-2">Dimensions (mm)</th>
                    <th className="text-left py-2">Dimensions (inches)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(catalogue.dinSizes).map(([id, sizes]: [string, any[]]) => {
                    const mmSize = sizes.find((s: any) => s.unitType === 'MILLIMETERS');
                    const inSize = sizes.find((s: any) => s.unitType === 'INCHES');
                    return (
                      <tr key={id} className="border-b last:border-b-0">
                        <td className="py-2 font-mono font-bold">{id}</td>
                        <td className="py-2">{mmSize?.label || '-'}</td>
                        <td className="py-2">{mmSize ? `${mmSize.width} x ${mmSize.height}` : '-'}</td>
                        <td className="py-2">{inSize ? `${inSize.width}" x ${inSize.height}"` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standard Sizes - Look for 8x10 */}
      {catalogue?.standardSizes && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Standard Sizes (Non-DIN) - Look for 8&quot;x10&quot;</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <strong>Looking for 8&quot;x10&quot;:</strong> Search for &quot;IN_8_X_10&quot; or similar in the list below.
              The key name is the standardSize ID to use in orders.
            </div>
            <div className="bg-gray-50 p-4 rounded max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b">
                    <th className="text-left py-2">Size Key</th>
                    <th className="text-left py-2">Label</th>
                    <th className="text-left py-2">Dimensions (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(catalogue.standardSizes)
                    .filter(([key]) => key.includes('8') || key.includes('10') || key.toLowerCase().includes('book'))
                    .map(([key, sizes]: [string, any[]]) => {
                      const mmSize = sizes.find((s: any) => s.unitType === 'MILLIMETERS');
                      return (
                        <tr key={key} className="border-b last:border-b-0 bg-green-50">
                          <td className="py-2 font-mono font-bold">{key}</td>
                          <td className="py-2">{mmSize?.label || '-'}</td>
                          <td className="py-2">{mmSize ? `${mmSize.width} x ${mmSize.height}` : '-'}</td>
                        </tr>
                      );
                    })}
                  {Object.entries(catalogue.standardSizes)
                    .filter(([key]) => !key.includes('8') && !key.includes('10') && !key.toLowerCase().includes('book'))
                    .slice(0, 20)
                    .map(([key, sizes]: [string, any[]]) => {
                      const mmSize = sizes.find((s: any) => s.unitType === 'MILLIMETERS');
                      return (
                        <tr key={key} className="border-b last:border-b-0">
                          <td className="py-2 font-mono">{key}</td>
                          <td className="py-2">{mmSize?.label || '-'}</td>
                          <td className="py-2">{mmSize ? `${mmSize.width} x ${mmSize.height}` : '-'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-gray-500">Showing first 20 non-matching sizes. Total: {Object.keys(catalogue.standardSizes).length}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata Display */}
      {metadata && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>
              Product Metadata (Product: {selectedProduct}, SubProduct: {selectedSubProduct})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Formats */}
            {metadata.formats && metadata.formats.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Formats / Sizes</h3>
                <div className="bg-gray-50 p-4 rounded">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">ID</th>
                        <th className="text-left py-2">Name</th>
                        <th className="text-left py-2">Dimensions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metadata.formats.map((f: any, i: number) => (
                        <tr key={i} className="border-b last:border-b-0">
                          <td className="py-2 font-mono">{f.id}</td>
                          <td className="py-2">{f.name}</td>
                          <td className="py-2">
                            {f.longEdge && f.shortEdge
                              ? `${f.longEdge}mm x ${f.shortEdge}mm`
                              : f.width && f.height
                              ? `${f.width}mm x ${f.height}mm`
                              : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Substrates */}
            {metadata.substrates && metadata.substrates.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Substrates / Paper Types</h3>
                <div className="bg-gray-50 p-4 rounded space-y-4">
                  {metadata.substrates.map((s: any, i: number) => (
                    <div key={i} className="border-b pb-4 last:border-b-0">
                      <div className="font-medium">
                        {s.typeName || s.name} (Type ID: {s.typeId || s.id})
                      </div>
                      {s.weights && s.weights.length > 0 && (
                        <div className="mt-2 ml-4">
                          <div className="text-sm text-gray-600 mb-1">Weights:</div>
                          <div className="flex flex-wrap gap-2">
                            {s.weights.map((w: any, wi: number) => (
                              <span
                                key={wi}
                                className="bg-white border px-2 py-1 rounded text-sm"
                              >
                                ID {w.id}: {w.weight} {w.unit || 'GSM'}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bindings */}
            {metadata.bindings && metadata.bindings.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Bindings</h3>
                <div className="bg-gray-50 p-4 rounded">
                  <div className="flex flex-wrap gap-2">
                    {metadata.bindings.map((b: any, i: number) => (
                      <span key={i} className="bg-white border px-2 py-1 rounded text-sm">
                        {b.type}: {b.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Laminations */}
            {metadata.laminations && metadata.laminations.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Laminations</h3>
                <div className="bg-gray-50 p-4 rounded">
                  <div className="flex flex-wrap gap-2">
                    {metadata.laminations.map((l: any, i: number) => (
                      <span key={i} className="bg-white border px-2 py-1 rounded text-sm">
                        {l.type}: {l.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* DIN and Standard Sizes Metadata - THE KEY SECTION */}
            {metadata.raw?.dinAndStandardSizesMetadata && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2 text-lg text-red-600">Size-Specific Substrate Options (CRITICAL)</h3>
                <p className="text-sm text-gray-600 mb-4">
                  This shows which substrate options are valid for each size. Look for &quot;IN_8_X_10&quot; to find valid options for 8×10&quot; books.
                </p>
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded max-h-[600px] overflow-auto">
                  {/* Search for IN_8_X_10 specifically */}
                  {metadata.raw.dinAndStandardSizesMetadata['IN_8_X_10'] && (
                    <div className="mb-6 p-4 bg-green-100 border border-green-300 rounded">
                      <h4 className="font-bold text-green-800 mb-2">IN_8_X_10 (8×10&quot;) - Found!</h4>
                      <pre className="text-xs overflow-auto">
                        {JSON.stringify(metadata.raw.dinAndStandardSizesMetadata['IN_8_X_10'], null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Show all sizes with 8 or 10 */}
                  <h4 className="font-semibold mb-2">All sizes containing &quot;8&quot; or &quot;10&quot;:</h4>
                  {Object.entries(metadata.raw.dinAndStandardSizesMetadata)
                    .filter(([key]) => key.includes('8') || key.includes('10'))
                    .map(([sizeKey, sizeData]: [string, any]) => (
                      <div key={sizeKey} className="mb-4 p-3 bg-white border rounded">
                        <div className="font-mono font-bold text-blue-600">{sizeKey}</div>
                        <pre className="text-xs mt-2 overflow-auto max-h-40">
                          {JSON.stringify(sizeData, null, 2)}
                        </pre>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Show bound/cover component substrate metadata if available */}
            {metadata.raw?.boundComponentMetadata?.substratesMetadata && (
              <div className="mb-6">
                <h3 className="font-semibold mb-2">Bound Component Substrate Metadata</h3>
                <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-96">
                  {JSON.stringify(metadata.raw.boundComponentMetadata.substratesMetadata, null, 2)}
                </pre>
              </div>
            )}

            {/* Raw Data */}
            <div>
              <h3 className="font-semibold mb-2">Raw Response</h3>
              <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-96">
                {JSON.stringify(metadata.raw || metadata, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Spec Display */}
      {spec && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Item Specification</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-96">
              {JSON.stringify(spec, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Usage Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Guide</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p>
            <strong>1.</strong> Click &quot;Fetch Catalogue&quot; to load the available products.
          </p>
          <p>
            <strong>2.</strong> For books, look for the &quot;Books&quot; product (usually ID: 2) with
            sub-products for Paperback and Hardcover.
          </p>
          <p>
            <strong>3.</strong> Click &quot;Get Metadata&quot; to see available formats (sizes),
            substrates (paper types), and bindings.
          </p>
          <p>
            <strong>4.</strong> Find the format ID that matches your book size (e.g., 8&quot;x10&quot; or
            A5).
          </p>
          <p>
            <strong>5.</strong> Note the substrate type IDs and weight IDs for your paper
            configuration.
          </p>
          <p>
            <strong>6.</strong> Update the mxjdf-builder.ts file with the correct IDs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
