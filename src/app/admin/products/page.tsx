'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useUser } from '@/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { LoaderCircle, ArrowLeft, Plus, Trash2, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ENTITLEMENT_COMPONENT_LIST } from '@/lib/catalog/entitlement-components';
import { formatPrice } from '@/lib/catalog/validate';
import type {
  Product, Price, ProductGrant, ProductKind, ProductScope, BillingInterval, Currency,
  EntitlementComponentKey, GrantReset,
} from '@/lib/types';

const KINDS: ProductKind[] = ['one_time', 'subscription', 'free'];
const SCOPES: ProductScope[] = ['family', 'child', 'gift'];
const INTERVALS: BillingInterval[] = ['month', 'year'];
const RESETS: GrantReset[] = ['one_time', 'per_period', 'lifetime'];
const CURRENCIES: Currency[] = ['GBP', 'USD', 'EUR'];

type ProductWithPrices = Product & { prices: Price[] };

const emptyForm = (): Partial<Product> => ({
  name: '', description: '', kind: 'subscription', scope: 'family', interval: 'month',
  grants: [{ component: 'story_allowance', quantity: 1, reset: 'per_period' }],
  printProductId: '', active: false, sortOrder: 0,
});

export default function ProductsAdminPage() {
  const { isAdmin, loading: authLoading } = useAdminStatus();
  const { user } = useUser();
  const { toast } = useToast();

  const [products, setProducts] = useState<ProductWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Product>>(emptyForm());
  const [saving, setSaving] = useState(false);

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const token = await user!.getIdToken();
    return fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  }, [user]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [pRes, prRes] = await Promise.all([authed('/api/admin/products'), authed('/api/admin/prices')]);
      const pData = await pRes.json();
      const prData = await prRes.json();
      if (!pData.ok) throw new Error(pData.errorMessage || 'Failed to load products');
      const pricesByProduct = new Map<string, Price[]>();
      (prData.prices || []).forEach((pr: Price) => {
        const list = pricesByProduct.get(pr.productId) ?? [];
        list.push(pr); pricesByProduct.set(pr.productId, list);
      });
      setProducts((pData.products as Product[]).map((p) => ({ ...p, prices: pricesByProduct.get(p.id) ?? [] })));
    } catch (e: any) {
      toast({ title: 'Load failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, authed, toast]);

  useEffect(() => { if (isAdmin && user) load(); }, [isAdmin, user, load]);

  // ---- Product create/edit ----
  const openCreate = () => { setEditingId(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (p: Product) => { setEditingId(p.id); setForm({ ...p }); setDialogOpen(true); };

  const setGrant = (i: number, patch: Partial<ProductGrant>) => {
    setForm((f) => ({ ...f, grants: (f.grants || []).map((g, idx) => (idx === i ? { ...g, ...patch } : g)) }));
  };
  const addGrant = () => setForm((f) => ({ ...f, grants: [...(f.grants || []), { component: 'story_allowance', quantity: 1, reset: f.kind === 'subscription' ? 'per_period' : 'one_time' }] }));
  const removeGrant = (i: number) => setForm((f) => ({ ...f, grants: (f.grants || []).filter((_, idx) => idx !== i) }));

  const saveProduct = async () => {
    setSaving(true);
    try {
      const payload = { ...form, interval: form.kind === 'subscription' ? form.interval : null, printProductId: form.printProductId || null };
      const res = await authed('/api/admin/products', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(editingId ? { ...payload, productId: editingId } : payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.errorMessage || 'Save failed');
      toast({ title: editingId ? 'Product updated' : 'Product created' });
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!confirm('Delete this product and its prices?')) return;
    try {
      const res = await authed(`/api/admin/products?productId=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.errorMessage || 'Delete failed');
      toast({ title: 'Product deleted' });
      await load();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  // ---- Price add/delete ----
  const addPrice = async (productId: string, currency: Currency, major: string, interval: BillingInterval | null, active: boolean) => {
    const amountMinor = Math.round(parseFloat(major || '0') * 100);
    try {
      const res = await authed('/api/admin/prices', { method: 'POST', body: JSON.stringify({ productId, currency, amountMinor, interval, active }) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.errorMessage || 'Price add failed');
      toast({ title: 'Price added' });
      await load();
    } catch (e: any) {
      toast({ title: 'Price add failed', description: e.message, variant: 'destructive' });
    }
  };
  const deletePrice = async (priceId: string) => {
    try {
      const res = await authed(`/api/admin/prices?priceId=${priceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.errorMessage || 'Price delete failed');
      await load();
    } catch (e: any) {
      toast({ title: 'Price delete failed', description: e.message, variant: 'destructive' });
    }
  };

  if (authLoading) return <div className="flex min-h-[50vh] items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin" /></div>;
  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>;

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Products &amp; Pricing</h1>
            <p className="text-sm text-muted-foreground">Assemble purchasable products from entitlement components. No payment is taken yet.</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New product</Button>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin" /></div>
      ) : products.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No products yet. Create your first one.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {products.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {p.name}
                      <Badge variant={p.active ? 'default' : 'outline'}>{p.active ? 'active' : 'inactive'}</Badge>
                      <Badge variant="secondary">{p.kind}</Badge>
                      <Badge variant="secondary">{p.scope}{p.interval ? ` · ${p.interval}` : ''}</Badge>
                    </CardTitle>
                    {p.description && <CardDescription>{p.description}</CardDescription>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteProduct(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Grants</p>
                  <div className="flex flex-wrap gap-2">
                    {p.grants.map((g, i) => (
                      <Badge key={i} variant="outline">{g.quantity} × {g.component} ({g.reset})</Badge>
                    ))}
                  </div>
                </div>
                <PriceManager product={p} onAdd={addPrice} onDelete={deletePrice} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Edit product' : 'New product'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kind</Label>
                <Select value={form.kind} onValueChange={(v: ProductKind) => setForm({ ...form, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={form.scope} onValueChange={(v: ProductScope) => setForm({ ...form, scope: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {form.kind === 'subscription' && (
              <div>
                <Label>Billing interval</Label>
                <Select value={form.interval || 'month'} onValueChange={(v: BillingInterval) => setForm({ ...form, interval: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Grants (components)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addGrant}><Plus className="mr-1 h-3 w-3" /> Add</Button>
              </div>
              <div className="space-y-2">
                {(form.grants || []).map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={g.component} onValueChange={(v: EntitlementComponentKey) => setGrant(i, { component: v })}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{ENTITLEMENT_COMPONENT_LIST.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={1} className="w-20" value={g.quantity} onChange={(e) => setGrant(i, { quantity: Number(e.target.value) })} />
                    <Select value={g.reset} onValueChange={(v: GrantReset) => setGrant(i, { reset: v })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{RESETS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeGrant(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            </div>

            <div><Label>Linked PrintProduct ID (optional, for printed books)</Label><Input value={form.printProductId || ''} onChange={(e) => setForm({ ...form, printProductId: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={!!form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} /><Label>Active (visible in catalog)</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveProduct} disabled={saving}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PriceManager({
  product, onAdd, onDelete,
}: {
  product: ProductWithPrices;
  onAdd: (productId: string, currency: Currency, major: string, interval: BillingInterval | null, active: boolean) => void;
  onDelete: (priceId: string) => void;
}) {
  const [currency, setCurrency] = useState<Currency>('GBP');
  const [amount, setAmount] = useState('');
  const [active, setActive] = useState(true);
  const recurring = product.kind === 'subscription';

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Prices (SKUs)</p>
      <div className="space-y-1">
        {product.prices.length === 0 && <p className="text-sm text-muted-foreground">No price yet — configured but not for sale.</p>}
        {product.prices.map((pr) => (
          <div key={pr.id} className="flex items-center gap-2 text-sm">
            <Badge variant={pr.active ? 'default' : 'outline'}>{formatPrice(pr.amountMinor, pr.currency)}{pr.interval ? `/${pr.interval}` : ''}</Badge>
            <span className="text-muted-foreground">{pr.active ? 'active' : 'inactive'}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(pr.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div>
          <Label className="text-xs">Currency</Label>
          <Select value={currency} onValueChange={(v: Currency) => setCurrency(v)}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Amount (e.g. 24.99)</Label>
          <Input className="w-28" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex items-center gap-1 pb-2"><Switch checked={active} onCheckedChange={setActive} /><span className="text-xs">active</span></div>
        <Button size="sm" variant="outline" onClick={() => { onAdd(product.id, currency, amount, recurring ? (product.interval || 'month') : null, active); setAmount(''); }}>
          <Plus className="mr-1 h-3 w-3" /> Add price
        </Button>
      </div>
    </div>
  );
}
