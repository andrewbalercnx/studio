# Commercial Catalog — Products, Prices & Entitlements

> **Last Updated**: 2026-06-05 · **Status**: catalog + admin management built (payment-agnostic).
> Ledger/enforcement and gifting are deferred (see end). No money moves yet — Stripe is a later sprint.

This describes the payment-agnostic commercial catalog that lets a product manager assemble and manage
purchasable products ("SKUs") from a fixed set of entitlement components, independent of any payment
provider.

## Why a separate layer from `PrintProduct`

`PrintProduct` (see SCHEMA) is the **manufacturing spec + our Mixam cost** for a physical book — not a
customer-facing offer. The catalog here is the **commercial** layer: what we sell, what it grants, and
(eventually) what it costs. A sellable printed-book product *links* a `PrintProduct` for the physical
spec but carries its own customer price and entitlement grant.

## Three layers

### 1. Entitlement components (code-defined)
The grantable building blocks. Fixed in code because each needs enforcement logic; the PM assembles
products from them but does not invent new ones. Registry: `src/lib/catalog/entitlement-components.ts`.

| Key | Meter | Unit | Meaning |
|-----|-------|------|---------|
| `print_credit` | consumable | books | balance that decrements when a physical book is printed |
| `story_allowance` | quota | stories | how many stories may be created |
| `storybook_allowance` | quota | storybooks | how many storybooks may be generated |

Each grant in a product also has a **reset rule**: `one_time` (a print credit), `per_period`
(subscription quota that resets each billing cycle), or `lifetime` (e.g. free tier "1 story ever").

### 2. Products & Prices (data, admin-managed)
- **Product** (`products` collection): an assembled offer — `name`, `kind` (`one_time` | `subscription`
  | `free`), `scope` (`family` | `child` | `gift`), `interval` (`month`/`year`, subscriptions only),
  `grants[]` (components + quantity + reset), optional `printProductId` (link to manufacturing spec),
  `active`. This is what the PM builds.
- **Price** (`prices` collection): a money point on a product — `currency`, `amountMinor` (minor units,
  e.g. pence), `interval`, `active`, and a reserved `externalPriceId` (Stripe later). **£0 is allowed**
  (free tier); a product with **no active price** is "configured, not for sale". Mirrors Stripe's
  Product/Price split 1:1 so there's no migration when payment lands.

A **purchasable SKU = an active product + an active price.**

### 3. Entitlement ledger (runtime — modelled later)
Per-family / per-child balances that a grant tops up and that story/storybook/print creation consume.
Config + catalog land now; ledger and enforcement (blocking at the limit) are a deferred follow-up.

## How the example cases assemble

| Case | kind / scope | grants | price |
|------|--------------|--------|-------|
| Printed book | `one_time` / `family` (+`printProductId`) | `print_credit ×1 one_time` | per-unit £ |
| Friend buys a print token | `one_time` / `gift` | `print_credit ×1 one_time` | per-unit £ |
| Family subscription | `subscription` / `family`, monthly | `story_allowance ×N per_period`, `storybook_allowance ×M per_period` | £/mo |
| Child subscription | `subscription` / `child`, monthly | `story_allowance ×… per_period`, … | £/mo |
| Free tier (1 story, 2 storybooks) | `free` / `family` | `story_allowance ×1 lifetime`, `storybook_allowance ×2 lifetime` | £0 |

## Management & access

- Admin/PM page: `/admin/products` — list, create, edit (assemble components + prices),
  activate/deactivate.
- Writes go through **server-validated, admin-gated API routes** (`/api/admin/products`,
  `/api/admin/prices`) — pricing is server-authoritative, never trusted from the client.
- Consumer/purchase read: `/api/catalog` returns active products with their active prices, assembled
  server-side (server-first).
- Firestore rules: `products`/`prices` readable by authenticated users, writable by admins only.

## Design decisions (agreed defaults)

1. **Components fixed in code; products fully admin-assembled.**
2. **Catalog + admin first; ledger/enforcement second.**
3. **Gifting (friend → print token) is phase 2** (purchaser ≠ recipient + redeemable codes).
4. **Scope resolution (when enforcement lands):** consume a child's own allowance first, then draw
   from the family pool.

## Deferred (clearly out of this build)

- **Entitlement ledger + enforcement** — granting on purchase/free-tier assignment, and
  consuming/blocking at story/storybook/print creation.
- **Gifting / redeemable print tokens** — `scope: 'gift'` is modelled in the type but the
  purchaser→recipient redemption flow is phase 2.
- **Payment** — Stripe Checkout/webhooks (separate sprint); `externalPriceId` is the reserved hook.
