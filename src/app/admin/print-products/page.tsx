'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { LoaderCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PrintProductsPanel } from '@/components/admin/print-products/print-products-panel';

export default function AdminPrintProductsPage() {
  const { isAdmin, isWriter, loading: adminLoading } = useAdminStatus();

  if (adminLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <LoaderCircle className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isAdmin && !isWriter) {
    return <p className="text-destructive text-center p-8">Admin or writer access required.</p>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <div className="mb-4">
        <Link
          href="/admin/mixam-catalogue"
          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          <ExternalLink className="mr-1 h-4 w-4" />
          Mixam Catalogue & Settings
        </Link>
      </div>
      <PrintProductsPanel />
    </div>
  );
}
