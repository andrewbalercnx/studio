'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase/auth/use-user';
import type { PrintOrder, PrintOrderAddress, MixamInteraction } from '@/lib/types';

export default function PrintOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: userLoading } = useUser();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<PrintOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showInteractions, setShowInteractions] = useState(false);
  const [expandedInteraction, setExpandedInteraction] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && user) {
      loadOrder();
    }
  }, [orderId, user, userLoading]);

  async function getAuthHeaders(): Promise<HeadersInit> {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    return {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    };
  }

  async function loadOrder() {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.errorMessage || 'Failed to load order');
      }

      setOrder(data.order);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/approve`, {
        method: 'POST',
        headers,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve order');
      }

      await loadOrder(); // Reload to see updated status
      setActionResult({ type: 'success', message: 'Order approved successfully!' });
    } catch (err: any) {
      console.error('Approve error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setActionResult({ type: 'error', message: 'Please provide a reason for rejection' });
      return;
    }

    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: rejectReason }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reject order');
      }

      await loadOrder();
      setShowRejectDialog(false);
      setRejectReason('');
      setActionResult({ type: 'success', message: 'Order rejected' });
    } catch (err: any) {
      console.error('Reject error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSubmitToMixam() {
    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/submit`, {
        method: 'POST',
        headers,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit order');
      }

      await loadOrder();
      setActionResult({ type: 'success', message: 'Order submitted to Mixam successfully!' });
    } catch (err: any) {
      console.error('Submit error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResetToApproved() {
    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/reset`, {
        method: 'POST',
        headers,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset order');
      }

      await loadOrder();
      setActionResult({ type: 'success', message: 'Order reset to Approved status. You can now resubmit.' });
    } catch (err: any) {
      console.error('Reset error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRefreshMixamStatus() {
    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/refresh-status`, {
        method: 'POST',
        headers,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh status');
      }

      await loadOrder();
      if (data.statusChanged) {
        setActionResult({ type: 'success', message: `Status updated: ${data.mixamStatus}` });
      } else {
        setActionResult({ type: 'success', message: `Status unchanged: ${data.mixamStatus}` });
      }
    } catch (err: any) {
      console.error('Refresh status error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelOrder() {
    try {
      setActionLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/print-orders/${orderId}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: cancelReason }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel order');
      }

      await loadOrder();
      setShowCancelDialog(false);
      setCancelReason('');
      setActionResult({
        type: 'success',
        message: data.mixamCancelled
          ? 'Order cancelled successfully (including Mixam)'
          : 'Order cancelled successfully',
      });
    } catch (err: any) {
      console.error('Cancel error:', err);
      setActionResult({ type: 'error', message: err.message });
    } finally {
      setActionLoading(false);
    }
  }

  function formatDate(timestamp: any): string {
    if (!timestamp) return 'N/A';

    let date: Date;

    // Handle Firestore Timestamp with toDate() method (client SDK)
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    }
    // Handle serialized Firestore Timestamp from Admin SDK ({ _seconds, _nanoseconds } or { seconds, nanoseconds })
    else if (timestamp._seconds !== undefined || timestamp.seconds !== undefined) {
      const seconds = timestamp._seconds ?? timestamp.seconds;
      date = new Date(seconds * 1000);
    }
    // Handle ISO string or other date formats
    else {
      date = new Date(timestamp);
    }

    // Check if the date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
  }

  function renderAddress(address: PrintOrderAddress) {
    return (
      <div className="text-sm">
        <p className="font-medium">{address.name}</p>
        <p>{address.line1}</p>
        {address.line2 && <p>{address.line2}</p>}
        <p>{address.city}</p>
        {address.state && <p>{address.state}</p>}
        <p>{address.postalCode}</p>
        <p>{address.country}</p>
      </div>
    );
  }

  if (loading || userLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading order...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
            Please sign in to view this order.
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || 'Order not found'}
          </div>
          <Link href="/admin/print-orders" className="text-blue-600 hover:underline mt-4 inline-block">
            ← Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  const canApprove = order.fulfillmentStatus === 'awaiting_approval' || order.fulfillmentStatus === 'ready_to_submit';
  const canReject = order.fulfillmentStatus === 'awaiting_approval' || order.fulfillmentStatus === 'ready_to_submit';
  const canSubmit = order.fulfillmentStatus === 'approved';
  const canReset = order.fulfillmentStatus === 'validating';
  const canRefreshStatus = !!order.mixamOrderId;
  // Can cancel if order is in any state before production (not in_production, shipped, delivered, or already cancelled)
  const canCancel = [
    'draft', 'validating', 'validation_failed', 'ready_to_submit',
    'awaiting_approval', 'approved', 'submitted', 'confirmed'
  ].includes(order.fulfillmentStatus);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Order #{order.id?.slice(-8).toUpperCase()}
            </h1>
            <p className="text-gray-600 mt-1">Created: {formatDate(order.createdAt)}</p>
          </div>
          <Link
            href="/admin/print-orders"
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Back to Orders
          </Link>
        </div>

        {/* Action Result Banner */}
        {actionResult && (
          <div className={`mb-6 p-4 rounded-lg ${actionResult.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-center justify-between">
              <p className={actionResult.type === 'success' ? 'text-green-800' : 'text-red-800'}>
                {actionResult.type === 'success' ? '✓' : '✗'} {actionResult.message}
              </p>
              <button
                onClick={() => setActionResult(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Status and Actions */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Status</p>
              <p className="text-2xl font-semibold text-gray-900">
                {order.fulfillmentStatus.replace(/_/g, ' ').toUpperCase()}
              </p>
            </div>
            <div className="flex gap-3">
              {canApprove && (
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  Approve Order
                </button>
              )}
              {canReject && (
                <button
                  onClick={() => setShowRejectDialog(true)}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  Reject Order
                </button>
              )}
              {canSubmit && (
                <button
                  onClick={handleSubmitToMixam}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
                >
                  Submit to Mixam
                </button>
              )}
              {canReset && (
                <button
                  onClick={handleResetToApproved}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
                >
                  Reset to Approved
                </button>
              )}
              {canRefreshStatus && (
                <button
                  onClick={handleRefreshMixamStatus}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Refresh Mixam Status
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => setShowCancelDialog(true)}
                  disabled={actionLoading}
                  className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  Cancel Order
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mixam Details */}
        {order.mixamOrderId && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Mixam Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Mixam Order ID</p>
                <p className="font-mono text-sm">{order.mixamOrderId}</p>
                <a
                  href={`https://mixam.co.uk/orders/${order.mixamOrderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-xs"
                >
                  View in Mixam Dashboard
                </a>
              </div>
              {order.mixamJobNumber && (
                <div>
                  <p className="text-sm text-gray-600">Job Number</p>
                  <p className="font-mono font-medium">{order.mixamJobNumber}</p>
                </div>
              )}
              {order.mixamStatus && (
                <div>
                  <p className="text-sm text-gray-600">Mixam Status</p>
                  <p className="font-medium">{order.mixamStatus.replace(/_/g, ' ').toUpperCase()}</p>
                </div>
              )}
              {(order as any).mixamStatusCheckedAt && (
                <div>
                  <p className="text-sm text-gray-600">Last Checked</p>
                  <p className="text-sm">{formatDate((order as any).mixamStatusCheckedAt)}</p>
                </div>
              )}
            </div>
            {/* Shipping/Tracking Info (from webhooks) */}
            {((order as any).mixamTrackingNumber || (order as any).mixamTrackingUrl || (order as any).mixamEstimatedDelivery || (order as any).mixamCarrier || (order as any).mixamShipmentDate || (order as any).mixamParcelNumbers) && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-2">Shipping Information</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(order as any).mixamCarrier && (
                    <div>
                      <p className="text-sm text-gray-600">Carrier</p>
                      <p className="text-sm font-medium">{(order as any).mixamCarrier}</p>
                    </div>
                  )}
                  {(order as any).mixamTrackingNumber && (
                    <div>
                      <p className="text-sm text-gray-600">Tracking Number</p>
                      <p className="font-mono text-sm">{(order as any).mixamTrackingNumber}</p>
                    </div>
                  )}
                  {(order as any).mixamTrackingUrl && (
                    <div>
                      <p className="text-sm text-gray-600">Track Shipment</p>
                      <a
                        href={(order as any).mixamTrackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Track Package →
                      </a>
                    </div>
                  )}
                  {(order as any).mixamShipmentDate && (
                    <div>
                      <p className="text-sm text-gray-600">Shipment Date</p>
                      <p className="text-sm">{(order as any).mixamShipmentDate}</p>
                    </div>
                  )}
                  {(order as any).mixamEstimatedDelivery && (
                    <div>
                      <p className="text-sm text-gray-600">Estimated Delivery</p>
                      <p className="text-sm">{formatDate((order as any).mixamEstimatedDelivery)}</p>
                    </div>
                  )}
                  {(order as any).mixamParcelNumbers && (order as any).mixamParcelNumbers.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600">Parcel Numbers</p>
                      <p className="font-mono text-sm">{(order as any).mixamParcelNumbers.join(', ')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Mixam Artwork Status (from webhook) */}
            {((order as any).mixamArtworkComplete !== undefined || (order as any).mixamHasErrors !== undefined) && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-2">Artwork Status</p>
                <div className="flex gap-4">
                  {(order as any).mixamArtworkComplete !== undefined && (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${(order as any).mixamArtworkComplete ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {(order as any).mixamArtworkComplete ? '✓ Artwork Complete' : '⏳ Artwork Processing'}
                    </span>
                  )}
                  {(order as any).mixamHasErrors && (
                    <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                      ✗ Has Errors
                    </span>
                  )}
                </div>
                {(order as any).mixamStatusReason && (
                  <p className="text-sm text-gray-600 mt-2">
                    Reason: {(order as any).mixamStatusReason}
                  </p>
                )}
              </div>
            )}
            {/* Mixam Artwork Errors (from webhook) */}
            {(order as any).mixamArtworkErrors && (order as any).mixamArtworkErrors.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-medium text-red-700 mb-2">Artwork Errors</p>
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <ul className="space-y-2">
                    {(order as any).mixamArtworkErrors.map((err: { itemId: string; filename: string; page: number; message: string }, i: number) => (
                      <li key={i} className="text-sm text-red-700">
                        <span className="font-medium">Page {err.page}</span>
                        {err.filename && <span className="text-red-600"> ({err.filename})</span>}
                        : {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {/* Mixam Validation Result (from webhook - legacy format) */}
            {(order as any).mixamValidation && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-2">Mixam File Validation</p>
                {(order as any).mixamValidation.valid ? (
                  <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                    Files validated successfully
                  </div>
                ) : (
                  <div className="p-2 bg-red-50 border border-red-200 rounded">
                    <p className="text-sm text-red-800 font-medium mb-1">Validation Failed</p>
                    <ul className="list-disc list-inside text-sm text-red-700">
                      {(order as any).mixamValidation.errors?.map((err: string, i: number) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {/* Full API Response (collapsible) */}
            {(order as any).mixamResponse && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <details className="cursor-pointer">
                  <summary className="text-sm text-gray-600 hover:text-gray-900">
                    View Full Mixam API Response
                  </summary>
                  <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-48">
                    {JSON.stringify((order as any).mixamResponse, null, 2)}
                  </pre>
                </details>
              </div>
            )}
            {/* Last Webhook Payload (collapsible) */}
            {(order as any).lastWebhookPayload && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <details className="cursor-pointer">
                  <summary className="text-sm text-gray-600 hover:text-gray-900">
                    View Last Webhook Payload
                    {(order as any).lastWebhookAt && (
                      <span className="ml-2 text-xs text-gray-400">
                        ({formatDate((order as any).lastWebhookAt)})
                      </span>
                    )}
                  </summary>
                  <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-48">
                    {JSON.stringify((order as any).lastWebhookPayload, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Submission Error (shown when order failed submission and is back to approved status) */}
        {order.fulfillmentNotes && order.fulfillmentNotes.toLowerCase().includes('fail') && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-red-900 mb-2">Submission Error</h2>
            <p className="text-red-800">{order.fulfillmentNotes}</p>
            {order.fulfillmentStatus === 'approved' && (
              <p className="text-sm text-red-600 mt-2">
                The order has been reset to "Approved" status. Review the error and try again.
              </p>
            )}
          </div>
        )}

        {/* Validation Results */}
        {order.validationResult && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Validation Results</h2>
            {order.validationResult.valid ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded">
                <p className="text-green-800 font-medium">✓ All validations passed</p>
              </div>
            ) : (
              <div className="p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-red-800 font-medium mb-2">✗ Validation errors:</p>
                <ul className="list-disc list-inside text-red-700 space-y-1">
                  {order.validationResult.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            {order.validationResult.warnings.length > 0 && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-yellow-800 font-medium mb-2">⚠ Warnings:</p>
                <ul className="list-disc list-inside text-yellow-700 space-y-1">
                  {order.validationResult.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Order Details Grid */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Product Details */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Product Details</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Product</p>
                <p className="font-medium">{order.productSnapshot?.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Description</p>
                <p className="text-sm">{order.productSnapshot?.description || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Quantity</p>
                <p className="font-medium">{order.quantity}</p>
              </div>
              {order.customOptions && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Customizations</p>
                  <div className="text-sm space-y-1">
                    {order.customOptions.endPaperColor && (
                      <p>End Paper: {order.customOptions.endPaperColor}</p>
                    )}
                    {order.customOptions.headTailBandColor && (
                      <p>Band: {order.customOptions.headTailBandColor}</p>
                    )}
                    {order.customOptions.ribbonColor && (
                      <p>Ribbon: {order.customOptions.ribbonColor}</p>
                    )}
                  </div>
                </div>
              )}
              {order.printableMetadata && (
                <div>
                  <p className="text-sm text-gray-600">Page Count</p>
                  <p className="text-sm">
                    Interior: {order.printableMetadata.interiorPageCount} pages
                    {order.printableMetadata.paddingPageCount && order.printableMetadata.paddingPageCount > 0 && (
                      <span className="text-gray-500 ml-1">
                        (incl. {order.printableMetadata.paddingPageCount} padding)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    Cover: {order.printableMetadata.coverPageCount} pages
                  </p>
                </div>
              )}
              {(order as any).pdfGenerationWarnings && (order as any).pdfGenerationWarnings.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-sm font-medium text-yellow-800 mb-1">PDF Generation Warnings</p>
                  <ul className="text-xs text-yellow-700 list-disc list-inside space-y-1">
                    {(order as any).pdfGenerationWarnings.map((warning: string, i: number) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Cost Breakdown */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Cost Breakdown</h2>
            {order.estimatedCost ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Unit Price</span>
                  <span className="font-medium">{formatCurrency(order.estimatedCost.unitPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Quantity</span>
                  <span className="font-medium">×{order.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(order.estimatedCost.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Shipping</span>
                  <span className="font-medium">{formatCurrency(order.estimatedCost.shipping)}</span>
                </div>
                {order.estimatedCost.setupFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Setup Fee</span>
                    <span className="font-medium">{formatCurrency(order.estimatedCost.setupFee)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-200">
                  <div className="flex justify-between text-lg">
                    <span className="font-semibold text-gray-900">Total</span>
                    <span className="font-bold text-gray-900">{formatCurrency(order.estimatedCost.total)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">Cost information not available</p>
            )}
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Shipping Address</h2>
            {order.shippingAddress ? renderAddress(order.shippingAddress) : <p className="text-gray-500">No address provided</p>}
          </div>

          {/* Story Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Story Information</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Story ID</p>
                <Link
                  href={`/story/${order.storyId}`}
                  className="font-mono text-sm text-blue-600 hover:underline"
                >
                  {order.storyId}
                </Link>
              </div>
              {order.printableFiles?.coverPdfUrl && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Cover PDF</p>
                  <a
                    href={order.printableFiles.coverPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View Cover PDF →
                  </a>
                </div>
              )}
              {order.printableFiles?.interiorPdfUrl && (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Interior PDF</p>
                  <a
                    href={order.printableFiles.interiorPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View Interior PDF →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status History */}
        {order.statusHistory && order.statusHistory.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Status History</h2>
            <div className="space-y-3">
              {order.statusHistory.map((entry, i) => (
                <div key={i} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {entry.status.replace(/_/g, ' ').toUpperCase()}
                    </p>
                    {entry.note && <p className="text-sm text-gray-600">{entry.note}</p>}
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>{formatDate(entry.timestamp)}</p>
                    <p className="text-xs">by {entry.source}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mixam API Interactions - Always shown */}
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Mixam API Log {order.mixamInteractions && order.mixamInteractions.length > 0 && `(${order.mixamInteractions.length})`}
            </h2>
            {order.mixamInteractions && order.mixamInteractions.length > 0 && (
              <button
                onClick={() => setShowInteractions(!showInteractions)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {showInteractions ? 'Hide Details' : 'Show Details'}
              </button>
            )}
          </div>
          {!order.mixamInteractions || order.mixamInteractions.length === 0 ? (
            <p className="text-gray-500 text-sm">No Mixam interactions recorded yet.</p>
          ) : showInteractions && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {[...order.mixamInteractions].reverse().map((interaction: MixamInteraction) => (
                  <div
                    key={interaction.id}
                    className={`border rounded-lg p-3 ${
                      interaction.type === 'webhook'
                        ? 'border-purple-200 bg-purple-50'
                        : interaction.error
                        ? 'border-red-200 bg-red-50'
                        : interaction.type === 'api_request'
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-green-200 bg-green-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            interaction.type === 'webhook'
                              ? 'bg-purple-200 text-purple-800'
                              : interaction.type === 'api_request'
                              ? 'bg-blue-200 text-blue-800'
                              : 'bg-green-200 text-green-800'
                          }`}
                        >
                          {interaction.type === 'webhook'
                            ? 'WEBHOOK'
                            : interaction.type === 'api_request'
                            ? `${interaction.method} →`
                            : `← ${interaction.statusCode}`}
                        </span>
                        <span className="font-medium text-sm text-gray-900">
                          {interaction.action}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDate(interaction.timestamp)}
                      </span>
                    </div>

                    {interaction.endpoint && (
                      <p className="text-xs font-mono text-gray-600 mt-1">
                        {interaction.endpoint}
                      </p>
                    )}

                    {interaction.error && (
                      <p className="text-sm text-red-600 mt-1">{interaction.error}</p>
                    )}

                    {interaction.durationMs !== undefined && (
                      <p className="text-xs text-gray-500 mt-1">
                        Duration: {interaction.durationMs}ms
                      </p>
                    )}

                    <button
                      onClick={() =>
                        setExpandedInteraction(
                          expandedInteraction === interaction.id ? null : interaction.id
                        )
                      }
                      className="text-xs text-blue-600 hover:text-blue-800 mt-2"
                    >
                      {expandedInteraction === interaction.id ? 'Hide payload' : 'Show payload'}
                    </button>

                    {expandedInteraction === interaction.id && (
                      <div className="mt-2">
                        {interaction.requestBody && (
                          <div className="mb-2">
                            <p className="text-xs font-semibold text-gray-700">Request:</p>
                            <pre className="text-xs bg-white p-2 rounded border overflow-x-auto max-h-40">
                              {typeof interaction.requestBody === 'string'
                                ? interaction.requestBody
                                : JSON.stringify(interaction.requestBody, null, 2)}
                            </pre>
                          </div>
                        )}
                        {interaction.responseBody && (
                          <div className="mb-2">
                            <p className="text-xs font-semibold text-gray-700">Response:</p>
                            <pre className="text-xs bg-white p-2 rounded border overflow-x-auto max-h-40">
                              {typeof interaction.responseBody === 'string'
                                ? interaction.responseBody
                                : JSON.stringify(interaction.responseBody, null, 2)}
                            </pre>
                          </div>
                        )}
                        {interaction.webhookPayload && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700">Webhook Payload:</p>
                            <pre className="text-xs bg-white p-2 rounded border overflow-x-auto max-h-40">
                              {JSON.stringify(interaction.webhookPayload, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* Reject Dialog */}
        {showRejectDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Reject Order</h3>
              <p className="text-gray-600 mb-4">
                Please provide a reason for rejecting this order:
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-3 mb-4"
                rows={4}
                placeholder="Enter rejection reason..."
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowRejectDialog(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={actionLoading || !rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  Reject Order
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cancel Order Dialog */}
        {showCancelDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Cancel Order</h3>
              <p className="text-gray-600 mb-4">
                Are you sure you want to cancel this order? This action cannot be undone.
                {order?.mixamOrderId && (
                  <span className="block mt-2 text-amber-600 font-medium">
                    This order has been submitted to Mixam. Cancellation will be sent to Mixam as well.
                  </span>
                )}
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-3 mb-4"
                rows={3}
                placeholder="Enter cancellation reason (optional)..."
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowCancelDialog(false);
                    setCancelReason('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Keep Order
                </button>
                <button
                  onClick={handleCancelOrder}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Cancelling...' : 'Cancel Order'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
