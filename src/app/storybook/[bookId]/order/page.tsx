'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase/auth/use-user';
import { useDiagnosticsOptional } from '@/hooks/use-diagnostics';
import type { PrintProduct, PrintOrderAddress, StoryOutput, SavedAddress, StoryBookArtStatus } from '@/lib/types';
import { AddressSelector, PostcodeLookup } from '@/components/address';

type EndPaperColor = 'white' | 'cream' | 'black' | 'red' | 'blue' | 'green';

export default function OrderPrintBookPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const diagnostics = useDiagnosticsOptional();
  const bookId = params.bookId as string;
  const printStoryBookId = searchParams.get('printStoryBookId');
  const storybookId = searchParams.get('storybookId'); // For new model: stories/{storyId}/storybooks/{storybookId}

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [story, setStory] = useState<StoryOutput | null>(null);
  const [products, setProducts] = useState<PrintProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // Degraded-book contract (Sprint W2-C): server-computed rollup, used for the
  // proactive warning banner; the server gate is the source of truth.
  const [artStatus, setArtStatus] = useState<StoryBookArtStatus | null>(null);
  // 409 degraded_confirmation_required -> explicit confirmation dialog state
  const [degradedConfirm, setDegradedConfirm] = useState<StoryBookArtStatus | null>(null);

  // Order customization
  const [quantity, setQuantity] = useState(1);
  const [endPaperColor, setEndPaperColor] = useState<EndPaperColor>('white');

  // Shipping address
  const [address, setAddress] = useState<PrintOrderAddress>({
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'GB',
  });
  const [addressMode, setAddressMode] = useState<'saved' | 'manual'>('saved');
  const [hasSavedAddresses, setHasSavedAddresses] = useState<boolean | null>(null);

  // Save-address option for manually entered addresses (Sprint W2-C)
  const [saveAddress, setSaveAddress] = useState(true);
  const [addressLabel, setAddressLabel] = useState('');

  useEffect(() => {
    loadData();
  }, [bookId, printStoryBookId, storybookId, user]);

  async function loadData() {
    try {
      setLoading(true);

      // Build story API URL with optional query parameters
      let storyApiUrl = `/api/storyBook/${bookId}`;
      const queryParams: string[] = [];
      if (printStoryBookId) {
        queryParams.push(`printStoryBookId=${encodeURIComponent(printStoryBookId)}`);
      }
      if (storybookId) {
        queryParams.push(`storybookId=${encodeURIComponent(storybookId)}`);
      }
      if (queryParams.length > 0) {
        storyApiUrl += `?${queryParams.join('&')}`;
      }

      // Load story, print products, and saved address in parallel
      const fetchPromises: Promise<Response>[] = [
        fetch(storyApiUrl),
        fetch('/api/printOrders/products'),
      ];

      // Only fetch saved addresses if user is logged in
      if (user) {
        const idToken = await user.getIdToken();
        fetchPromises.push(
          fetch('/api/user/addresses', {
            headers: { Authorization: `Bearer ${idToken}` },
          })
        );
      }

      const responses = await Promise.all(fetchPromises);
      const [storyResponse, productsResponse] = responses;
      const addressesResponse = responses[2];

      if (!storyResponse.ok) throw new Error('Failed to load story');
      if (!productsResponse.ok) throw new Error('Failed to load print products');

      const storyData = await storyResponse.json();
      const productsData = await productsResponse.json();

      setStory(storyData.story);
      setArtStatus(storyData.story?.artStatus ?? null);
      setProducts(productsData.products || []);

      // Auto-select first product if available
      if (productsData.products && productsData.products.length > 0) {
        setSelectedProductId(productsData.products[0].id);
      }

      // Check if user has saved addresses
      if (addressesResponse?.ok) {
        const addressesData = await addressesResponse.json();
        const savedAddresses = addressesData.addresses || [];
        setHasSavedAddresses(savedAddresses.length > 0);

        // If user has saved addresses, start in saved mode
        // Otherwise, start in manual mode
        if (savedAddresses.length > 0) {
          setAddressMode('saved');
          // Pre-select default address
          const defaultAddr = savedAddresses.find((a: SavedAddress) => a.isDefault) || savedAddresses[0];
          if (defaultAddr) {
            setAddress({
              name: defaultAddr.name,
              line1: defaultAddr.line1,
              line2: defaultAddr.line2 || '',
              city: defaultAddr.city,
              state: defaultAddr.state || '',
              postalCode: defaultAddr.postalCode,
              country: defaultAddr.country || 'GB',
            });
          }
        } else {
          setAddressMode('manual');
        }
      } else {
        setHasSavedAddresses(false);
        setAddressMode('manual');
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitOrder(acknowledgeDegraded: boolean) {
    if (!user) {
      console.log('[order] No user');
      alert('You must be logged in to place an order');
      return;
    }

    if (!selectedProductId) {
      console.log('[order] No product selected');
      alert('Please select a product');
      return;
    }

    // Validate address
    if (!address.name || !address.line1 || !address.city || !address.postalCode) {
      console.log('[order] Address validation failed:', { name: address.name, line1: address.line1, city: address.city, postalCode: address.postalCode });
      alert('Please fill in all required address fields');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      console.log('[order] Submitting order...');

      // Get Firebase ID token for authentication
      const idToken = await user.getIdToken();

      const requestBody = {
        storyId: bookId,
        printStoryBookId: printStoryBookId || undefined,
        storybookId: storybookId || undefined,
        productId: selectedProductId,
        quantity,
        customOptions: {
          endPaperColor,
          headTailBandColor: 'white', // Default
        },
        shippingAddress: address,
        // Degraded-book contract: explicit confirmation that partial-art pages print without art
        acknowledgeDegraded,
        // Save manually entered addresses to the user's address book (server-side)
        saveAddress: addressMode === 'manual' && saveAddress,
        addressLabel: addressMode === 'manual' && saveAddress ? addressLabel.trim() : undefined,
      };
      console.log('[order] Request body:', requestBody);

      const response = await fetch('/api/printOrders/mixam', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[order] Response status:', response.status);
      const data = await response.json();
      console.log('[order] Response data:', data);

      // The server gate asks for an explicit confirmation before printing a
      // partial-art (degraded) book — show the confirmation dialog.
      if (response.status === 409 && data?.code === 'degraded_confirmation_required') {
        setDegradedConfirm(data.artStatus ?? artStatus ?? null);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to create order');
      }

      alert('Order submitted successfully! An admin will review and approve your order.');
      router.push(`/parent/orders`);

    } catch (err: any) {
      console.error('[order] Error:', err);
      setError(err.message);
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    await submitOrder(false);
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
  }

  function calculateEstimatedCost(): number {
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return 0;

    // Use pricingTiers from the PrintProduct type
    const tier = product.pricingTiers?.find(
      t => quantity >= t.minQuantity && (t.maxQuantity === null || quantity <= t.maxQuantity)
    );

    if (!tier) return 0;

    const baseTotal = tier.basePrice * quantity;
    const shippingTotal = (product.shippingCost?.baseRate || 0) +
                          ((product.shippingCost?.perItemRate || 0) * quantity);
    const setupFee = tier.setupFee || 0;

    return baseTotal + shippingTotal + setupFee;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || 'Story not found'}
          </div>
          <Link href="/stories" className="text-blue-600 hover:underline mt-4 inline-block">
            ← Back to Stories
          </Link>
        </div>
      </div>
    );
  }

  // Check if story has printable PDFs
  if (!story.finalization?.printableCoverPdfUrl || !story.finalization?.printableInteriorPdfUrl) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
            <p className="font-semibold">Story not ready for print</p>
            <p className="text-sm mt-1">
              This story needs to have printable PDFs generated before you can order a physical book.
            </p>
          </div>
          <Link href={`/story/${bookId}`} className="text-blue-600 hover:underline mt-4 inline-block">
            ← Back to Story
          </Link>

          {/* Diagnostics Panel */}
          {diagnostics?.showDiagnosticsPanel && (
            <div className="mt-6 bg-gray-900 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-auto">
              <h3 className="text-yellow-400 font-bold mb-2">🔍 Diagnostics: Story Data</h3>
              <div className="space-y-2">
                <div>
                  <span className="text-gray-400">bookId:</span> {bookId}
                </div>
                <div>
                  <span className="text-gray-400">printStoryBookId:</span> {printStoryBookId || '(none)'}
                </div>
                <div>
                  <span className="text-gray-400">storybookId:</span> {storybookId || '(none)'}
                </div>
                <div>
                  <span className="text-gray-400">story.id:</span> {story.id}
                </div>
                <div>
                  <span className="text-gray-400">story.title:</span> {story.title}
                </div>
                <div className="border-t border-gray-700 pt-2 mt-2">
                  <span className="text-yellow-400">finalization:</span>
                  <pre className="mt-1 whitespace-pre-wrap text-green-400">
                    {JSON.stringify(story.finalization, null, 2) || 'null'}
                  </pre>
                </div>
                <div className="border-t border-gray-700 pt-2 mt-2">
                  <span className="text-yellow-400">printStoryBook:</span>
                  <pre className="mt-1 whitespace-pre-wrap text-green-400">
                    {JSON.stringify((story as any).printStoryBook, null, 2) || 'null'}
                  </pre>
                </div>
                {(story as any)._debug && (
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <span className="text-yellow-400">_debug:</span>
                    <pre className="mt-1 whitespace-pre-wrap text-cyan-400">
                      {JSON.stringify((story as any)._debug, null, 2)}
                    </pre>
                  </div>
                )}
                <div className="border-t border-gray-700 pt-2 mt-2">
                  <span className="text-yellow-400">Check conditions:</span>
                  <div className="mt-1 space-y-1">
                    <div>
                      <span className={story.finalization?.printableCoverPdfUrl ? 'text-green-400' : 'text-red-400'}>
                        {story.finalization?.printableCoverPdfUrl ? '✓' : '✗'}
                      </span>
                      {' '}printableCoverPdfUrl: {story.finalization?.printableCoverPdfUrl ? 'present' : 'missing'}
                    </div>
                    <div>
                      <span className={story.finalization?.printableInteriorPdfUrl ? 'text-green-400' : 'text-red-400'}>
                        {story.finalization?.printableInteriorPdfUrl ? '✓' : '✗'}
                      </span>
                      {' '}printableInteriorPdfUrl: {story.finalization?.printableInteriorPdfUrl ? 'present' : 'missing'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const estimatedCost = calculateEstimatedCost();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Order Physical Book</h1>
          <p className="text-gray-600 mt-1">Create a beautiful hardcover book of your story</p>
        </div>

        {/* Degraded-art warning (Sprint W2-C): some pages will print without art */}
        {artStatus?.completeness === 'degraded' && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="font-semibold text-amber-900">
              {artStatus.pagesFailed} of {artStatus.pagesTotal} pages have no picture
            </p>
            <p className="text-sm text-amber-800 mt-1">
              You can still order this book, but those pages will print without artwork.
              We&apos;ll ask you to confirm before the order is placed. To fix them first, go back
              to the book and retry the missing pictures.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmitOrder} className="space-y-6">
          {/* Story Info */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Story</h2>
            <p className="text-gray-700">{story.title || 'Untitled Story'}</p>
            <p className="text-sm text-gray-500 mt-1">
              {story.finalization?.printableMetadata?.pageCount} pages
            </p>
          </div>

          {/* Product Selection */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Product Options</h2>

            {products.length === 0 ? (
              <p className="text-gray-500">No products available</p>
            ) : (
              <div className="space-y-4">
                {products.map((product) => (
                  <label
                    key={product.id}
                    className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      selectedProductId === product.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="product"
                      value={product.id}
                      checked={selectedProductId === product.id}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{product.name}</p>
                      <p className="text-sm text-gray-600 mt-1">{product.description}</p>
                      <p className="text-sm text-gray-500 mt-2">
                        Starting from {formatCurrency(product.pricingTiers?.[0]?.basePrice || 0)} per book
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Quantity */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Quantity</h2>
            <div className="flex items-center gap-4">
              <label className="text-gray-700">Number of books:</label>
              <input
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-24 border border-gray-300 rounded-md px-3 py-2"
                required
              />
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Ordering more books typically reduces the price per book
            </p>
          </div>

          {/* Customization */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Customization</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 mb-2">End Paper Color</label>
                <select
                  value={endPaperColor}
                  onChange={(e) => setEndPaperColor(e.target.value as EndPaperColor)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="white">White</option>
                  <option value="cream">Cream</option>
                  <option value="black">Black</option>
                  <option value="red">Red</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  The colored paper inside the front and back covers
                </p>
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Shipping Address</h2>

            {/* Address mode toggle (only show if user has saved addresses) */}
            {hasSavedAddresses && (
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setAddressMode('saved')}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    addressMode === 'saved'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Saved Addresses
                </button>
                <button
                  type="button"
                  onClick={() => setAddressMode('manual')}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    addressMode === 'manual'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Enter New Address
                </button>
              </div>
            )}

            {/* Saved Address Selector */}
            {addressMode === 'saved' && hasSavedAddresses && (
              <AddressSelector
                onAddressSelected={(selectedAddress) => setAddress(selectedAddress)}
                label=""
                showAddNew={false}
              />
            )}

            {/* Manual Address Entry */}
            {addressMode === 'manual' && (
              <div className="space-y-4">
                {/* Postcode Lookup */}
                <PostcodeLookup
                  onAddressSelected={(lookupAddress) => {
                    setAddress({
                      ...address,
                      line1: lookupAddress.line1,
                      line2: lookupAddress.line2 || '',
                      city: lookupAddress.city,
                      state: lookupAddress.state,
                      postalCode: lookupAddress.postalCode,
                      country: lookupAddress.country,
                    });
                  }}
                />

                <div className="border-t pt-4">
                  <div>
                    <label className="block text-gray-700 mb-1">
                      Recipient Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={address.name}
                      onChange={(e) => setAddress({ ...address, name: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 mb-1">
                    Address Line 1 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={address.line1}
                    onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-700 mb-1">Address Line 2</label>
                  <input
                    type="text"
                    value={address.line2}
                    onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-700 mb-1">
                      City/Town <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={address.city}
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-gray-700 mb-1">County/Region</label>
                    <input
                      type="text"
                      value={address.state}
                      onChange={(e) => setAddress({ ...address, state: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-700 mb-1">
                    Postcode <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={address.postalCode}
                    onChange={(e) => setAddress({ ...address, postalCode: e.target.value.toUpperCase() })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="SW1A 1AA"
                    required
                  />
                </div>

                <div>
                  <label className="block text-gray-700 mb-1">Country</label>
                  <input
                    type="text"
                    value="United Kingdom"
                    disabled
                    className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-100"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Currently only shipping to UK addresses
                  </p>
                </div>

                {/* Save address for future orders (Sprint W2-C) */}
                <div className="border-t pt-4 space-y-3">
                  <label className="flex items-center gap-2 text-gray-700">
                    <input
                      type="checkbox"
                      checked={saveAddress}
                      onChange={(e) => setSaveAddress(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Save this address for future orders
                  </label>
                  {saveAddress && (
                    <div>
                      <label className="block text-gray-700 mb-1 text-sm">
                        Label (optional)
                      </label>
                      <input
                        type="text"
                        value={addressLabel}
                        onChange={(e) => setAddressLabel(e.target.value)}
                        maxLength={50}
                        placeholder={'e.g. Home, Grandma’s'}
                        className="w-full max-w-xs border border-gray-300 rounded-md px-3 py-2"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cost Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Estimated Cost</h2>
            <div className="flex justify-between items-center text-2xl">
              <span className="text-gray-700">Total:</span>
              <span className="font-bold text-gray-900">
                {estimatedCost > 0 ? formatCurrency(estimatedCost) : 'Select options'}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Final price will be confirmed after admin review
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-4">
            <Link
              href={`/story/${bookId}`}
              className="px-6 py-3 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting || !selectedProductId}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit Order for Review'}
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>What happens next:</strong>
            </p>
            <ul className="text-sm text-blue-700 list-disc list-inside mt-2 space-y-1">
              <li>Your order will be reviewed by an admin for quality and accuracy</li>
              <li>You'll receive an email when your order is approved</li>
              <li>Once approved, your order will be sent to our print partner</li>
              <li>You'll receive tracking information when your book ships</li>
            </ul>
          </div>
        </form>

        {/* Degraded-art order confirmation (Sprint W2-C) */}
        {degradedConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="degraded-confirm-title"
          >
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
              <h2 id="degraded-confirm-title" className="text-xl font-semibold text-gray-900">
                Some pages will print without pictures
              </h2>
              <p className="text-gray-700">
                {degradedConfirm.pagesFailed} of {degradedConfirm.pagesTotal} pages in this book
                don&apos;t have artwork — those pages will be printed with their words but{' '}
                <strong>no picture</strong>.
              </p>
              <p className="text-sm text-gray-500">
                If you&apos;d rather fix them first, go back to the book and retry the missing
                pictures before ordering.
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setDegradedConfirm(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Go back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setDegradedConfirm(null);
                    submitOrder(true);
                  }}
                  className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Print without those pictures'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
