'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase/auth/use-user';
import type { PrintOrder, MixamOrderStatus } from '@/lib/types';

export default function PrintOrdersPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'submitted'>('pending');

  useEffect(() => {
    if (!userLoading && user) {
      loadOrders();
    }
  }, [filter, user, userLoading]);

  async function loadOrders() {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const idToken = await user.getIdToken();
      const response = await fetch(`/api/admin/print-orders?filter=${filter}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.errorMessage || 'Failed to load orders');
      }

      setOrders(data.orders || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadgeColor(status: MixamOrderStatus): string {
    const colors: Record<MixamOrderStatus, string> = {
      draft: 'bg-gray-200 text-gray-800',
      validating: 'bg-blue-200 text-blue-800',
      validation_failed: 'bg-red-200 text-red-800',
      ready_to_submit: 'bg-green-200 text-green-800',
      awaiting_approval: 'bg-yellow-200 text-yellow-800',
      approved: 'bg-green-300 text-green-900',
      submitting: 'bg-purple-100 text-purple-700',
      submitted: 'bg-purple-200 text-purple-800',
      confirmed: 'bg-purple-300 text-purple-900',
      in_production: 'bg-indigo-200 text-indigo-800',
      shipped: 'bg-blue-300 text-blue-900',
      delivered: 'bg-green-400 text-green-950',
      cancelled: 'bg-gray-300 text-gray-900',
      failed: 'bg-red-300 text-red-900',
    };
    return colors[status] || 'bg-gray-200 text-gray-800';
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

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Print Orders</h1>
            <p className="text-gray-600 mt-1">Review and manage print orders</p>
          </div>
          <Link
            href="/admin"
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Back to Admin
          </Link>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {[
                { key: 'pending', label: 'Pending Approval' },
                { key: 'approved', label: 'Approved' },
                { key: 'submitted', label: 'Submitted' },
                { key: 'all', label: 'All Orders' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key as any)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                    filter === tab.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {(loading || userLoading) ? (
          <div className="text-center py-12">
            <div className="text-gray-500">Loading orders...</div>
          </div>
        ) : !user ? (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded mb-6">
            Please sign in to view orders.
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500 text-lg">No orders found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-lg shadow hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Order #{order.id?.slice(-8).toUpperCase()}
                        </h3>
                        <span
                          className={`px-3 py-1 text-xs font-medium rounded-full ${getStatusBadgeColor(
                            order.fulfillmentStatus
                          )}`}
                        >
                          {order.fulfillmentStatus.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Created: {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/print-orders/${order.id}`}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                    >
                      Review Order
                    </Link>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Product</p>
                      <p className="text-sm font-medium text-gray-900">
                        {order.productSnapshot?.name || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Quantity</p>
                      <p className="text-sm font-medium text-gray-900">{order.quantity}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Total Cost</p>
                      <p className="text-sm font-medium text-gray-900">
                        {order.estimatedCost?.total ? formatCurrency(order.estimatedCost.total) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Delivery To</p>
                      <p className="text-sm font-medium text-gray-900">
                        {order.shippingAddress ? `${order.shippingAddress.city}, ${order.shippingAddress.postalCode}` : 'N/A'}
                      </p>
                    </div>
                  </div>

                  {order.validationResult && !order.validationResult.valid && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                      <p className="text-sm font-medium text-red-800 mb-1">Validation Issues:</p>
                      <ul className="text-sm text-red-700 list-disc list-inside">
                        {order.validationResult.errors.map((error, i) => (
                          <li key={i}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
