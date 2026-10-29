# ADR-0012: Real payment with Stripe

**Status**: Accepted (owner, 2026-10-29)

## Context

There is no payment today: parents see our Mixam cost as the price, and `/pay` marks orders paid.
The `products` / `prices` catalogue and `print_credit` entitlements exist but are not connected to
ordering. `prices.externalPriceId` was reserved for a payment provider.

## Decision

The print and orders slice includes a real Stripe checkout:

- Retail prices come from `prices` (with `externalPriceId` → Stripe Price); the Mixam cost stays
  internal and is never shown to parents.
- A PrintOrder moves `awaiting_payment → paid` only on a verified Stripe webhook
  (`checkout.session.completed`), idempotent on the Stripe event id.
- Credits (`print_credit` entitlements) can pay for an order instead of, or as well as, money.
- Refunds move an order to `refunded` through the Stripe webhook, not by hand.

## Consequences

- New secrets (Stripe API key, webhook signing secret) in Secret Manager; a new webhook route
  with signature verification like the Mixam one.
- Admin "mark as paid" stays only as an audited admin action for exceptional cases.
