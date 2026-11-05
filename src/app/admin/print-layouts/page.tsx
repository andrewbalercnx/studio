'use client';

import { useAdminStatus } from '@/hooks/use-admin-status';
import { LoaderCircle } from 'lucide-react';
import { PrintLayoutsPanel } from '@/components/admin/print-layouts/print-layouts-panel';

export default function AdminPrintLayoutsPage() {
    const { isAdmin, isWriter, loading: adminLoading } = useAdminStatus();

    if (adminLoading) {
        return <div className="flex justify-center items-center h-screen"><LoaderCircle className="h-8 w-8 animate-spin" /></div>;
    }

    if (!isAdmin && !isWriter) {
        return <p className="text-destructive text-center p-8">Admin or writer access required.</p>;
    }

    return (
        <div className="container mx-auto p-4 sm:p-6 md:p-8">
            <PrintLayoutsPanel />
        </div>
    );
}
