'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OrderForm } from '@/components/orders/order-form';
import { useUser } from '@/firebase/auth/use-user';
import { useParentGuard } from '@/hooks/use-parent-guard';

/** Web: order printed copies of a Book (slice 5.6). Parent actions ask for the PIN. */
export default function OrderBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const router = useRouter();
  const { user } = useUser();
  const { isParentGuardValidated, showPinModal } = useParentGuard();
  const requireGuard = () => {
    if (isParentGuardValidated) return true;
    showPinModal();
    return false;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      <div className="container mx-auto max-w-3xl px-2 py-4">
        <Button variant="ghost" onClick={() => router.back()} className="mb-2 text-amber-800">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="mb-4 text-center text-2xl font-bold text-amber-900">Order a printed copy</h1>
        <OrderForm bookId={bookId} defaultEmail={user?.email ?? null} requireGuard={requireGuard} />
      </div>
    </div>
  );
}
