'use client';

import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrderDetail } from '@/components/orders/order-detail';
import { useParentGuard } from '@/hooks/use-parent-guard';

/** Web: one print order (slice 5.6). Stripe Checkout returns here with `?paid=1`. */
export default function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const justPaid = useSearchParams().get('paid') === '1';
  const { isParentGuardValidated, showPinModal } = useParentGuard();
  const requireGuard = () => {
    if (isParentGuardValidated) return true;
    showPinModal();
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      <div className="container mx-auto max-w-3xl px-2 py-6">
        <OrderDetail orderId={orderId} justPaid={justPaid} requireGuard={requireGuard} />
      </div>
    </div>
  );
}
