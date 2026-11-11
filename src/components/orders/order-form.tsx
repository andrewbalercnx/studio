'use client';

/**
 * Order printed copies of a Book (slice 5.6) in the print template the parent
 * tied to it on the Book page, once its print pictures are ready, with
 * the number of copies and a UK address. Placing the order makes its print
 * files, which locks the Book.
 * Every action asks for the parent PIN first through `requireGuard`.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Lock, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { api, ChoiceKeys, formatMoney, type PrintOption } from '@/lib/api';

const MAX_COPIES = 10;

type AddressForm = { name: string; line1: string; line2: string; city: string; postalCode: string };
const EMPTY_ADDRESS: AddressForm = { name: '', line1: '', line2: '', city: '', postalCode: '' };

export function OrderForm({ bookId, defaultEmail, requireGuard }: { bookId: string; defaultEmail: string | null; requireGuard: () => boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [options, setOptions] = useState<PrintOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [layoutId, setLayoutId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [placing, setPlacing] = useState(false);
  const [keys] = useState(() => new ChoiceKeys());

  useEffect(() => {
    api.books.printOptions(bookId)
      .then((opts) => {
        // The server says which template can be ordered now: the Book's own, priced, print pictures ready.
        const orderable = opts.filter((o) => o.orderable);
        setOptions(orderable);
        setChosen(opts.some((o) => o.isCurrent));
        setLayoutId(orderable[0]?.layoutId ?? '');
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [bookId]);

  useEffect(() => {
    if (defaultEmail && !email) setEmail(defaultEmail);
  }, [defaultEmail, email]);

  const option = options?.find((o) => o.layoutId === layoutId) ?? null;
  // One address only: autofill can append a second one to a prefilled box.
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const complete = !!option && !!address.name.trim() && !!address.line1.trim() && !!address.city.trim() && !!address.postalCode.trim() && emailValid;
  // A changed choice is a new order; the same choice again (a double tap) is the same order.
  const choice = useMemo(() => JSON.stringify({ layoutId, quantity, address, email }), [layoutId, quantity, address, email]);

  const place = async () => {
    if (!option || !requireGuard()) return;
    setPlacing(true);
    try {
      const order = await api.orders.create({
        bookId,
        layoutId,
        quantity,
        shippingAddress: { ...address, line2: address.line2.trim() || null },
        contactEmail: email.trim(),
        idempotencyKey: keys.keyFor(choice),
      });
      // Replace, not push: Back must not return to a form whose next tap would place a second order.
      router.replace(`/orders/${encodeURIComponent(order.id)}`);
    } catch (err) {
      toast({ title: 'Could not place the order', description: (err as Error).message, variant: 'destructive' });
      setPlacing(false);
    }
  };

  if (loadError) return <p className="py-12 text-center text-amber-800">{loadError}</p>;
  if (!options) {
    return (
      <div className="flex justify-center py-24">
        <LoaderCircle className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-2 p-6 text-center text-amber-900">
          <Printer className="mx-auto h-8 w-8 text-amber-500" />
          <p>
            {chosen
              ? 'The pictures for print are not ready yet. Check them on the book page, then come back to order.'
              : 'Choose a print template for this book first. Its pictures get a copy shaped for the printed page, free of charge.'}
          </p>
          <Button asChild variant="outline">
            <Link href={`/parent/books/${encodeURIComponent(bookId)}`}>{chosen ? 'Back to the book' : 'Choose a print template'}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const field = (key: keyof AddressForm, label: string, autoComplete: string, optional = false) => (
    <div className="space-y-1">
      <Label htmlFor={`addr-${key}`}>
        {label}
        {optional && <span className="text-muted-foreground"> (optional)</span>}
      </Label>
      <Input id={`addr-${key}`} autoComplete={autoComplete} value={address[key]} onChange={(e) => setAddress((a) => ({ ...a, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-amber-900">Print template</CardTitle>
          <CardDescription>
            The price includes UK delivery.{' '}
            <Link href={`/parent/books/${encodeURIComponent(bookId)}`} className="underline">
              Change template
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2" role="radiogroup" aria-label="Print format">
          {options.map((o) => (
            <button
              key={o.layoutId}
              type="button"
              role="radio"
              aria-checked={o.layoutId === layoutId}
              onClick={() => setLayoutId(o.layoutId)}
              className={`flex w-full items-center justify-between rounded-md border p-3 text-left ${o.layoutId === layoutId ? 'border-amber-500 bg-amber-50' : 'border-border'}`}
            >
              <span>
                <span className="block font-medium text-amber-900">{o.name}</span>
                <span className="text-sm text-muted-foreground">
                  {o.trim.widthIn} × {o.trim.heightIn} in · {o.interiorPages} pages{o.leavesPerSpread === 2 ? ' · words and pictures on facing pages' : ''}
                </span>
              </span>
              <span className="font-semibold text-amber-900">{o.price ? formatMoney(o.price.amountMinor, o.price.currency) : ''}</span>
            </button>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <Label htmlFor="copies">Copies</Label>
            <select id="copies" className="rounded-md border px-2 py-1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
              {Array.from({ length: MAX_COPIES }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-amber-900">Delivery address (UK)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {field('name', 'Name', 'name')}
          {field('line1', 'Address', 'address-line1')}
          {field('line2', 'Address line 2', 'address-line2', true)}
          {field('city', 'Town or city', 'address-level2')}
          {field('postalCode', 'Postcode', 'postal-code')}
          <div className="space-y-1">
            <Label htmlFor="email">Email for order updates</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!email.trim() && !emailValid}
            />
            {!!email.trim() && !emailValid && (
              <p className="text-xs text-destructive" data-testid="email-invalid">
                Enter one email address, like name@example.com.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          {option?.price && (
            <p className="flex justify-between text-lg font-semibold text-amber-900">
              <span>Total</span>
              <span>{formatMoney(option.price.amountMinor * quantity, option.price.currency)}</span>
            </p>
          )}
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            Ordering prints this exact book, so it will be locked. Once the print files are made you can unlock it to make changes, but that will need a new order.
          </p>
          <Button className="w-full" disabled={!complete || placing} onClick={place}>
            {placing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Place order
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
