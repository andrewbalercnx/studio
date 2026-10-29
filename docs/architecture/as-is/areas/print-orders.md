# As-is: Print, Orders & Commercial Model

> Scope: from a finished digital storybook to a delivered printed book, plus the commercial
> catalog/entitlements. Mapped from code on 2026-10-29 (read-only survey). Every claim cites
> `file:line`. Paths are relative to the repo root; `api/` = `src/app/api/`.
>
> **Handoffs to neighbouring areas**
> - *Storybook pipeline* owns `stories/{storyId}/storybooks/{storybookId}` (pages, images,
>   `artStatus`, `finalization.status` up to `finalized`/`isLocked`, set by
>   `api/storybookV2/finalize/route.ts:99,144`). This area starts at "generate printable PDFs".
> - *Clients* own the parent pages that link into the print flow (`storybook/[bookId]/page.tsx:768`,
>   `parent/storybooks/[childId]/page.tsx:732`, `story/[storyId]/page.tsx:357`).
> - *Config & admin* owns `systemConfig/*` editing and email config (`systemConfig/email`).
> - *Creation modes* consumes `story_allowance`/`storybook_allowance` (`api/storyCompile/route.ts:174`,
>   `api/storybookV2/create/route.ts:140`); the ledger library itself is described here.

---

## 1. The flow, step by step

There are **two parallel "make it printable" paths** that converge on one order route, plus a
**legacy order path** that is still reachable.

### 1a. Path A — "Print storybook" (`printStoryBooks` collection)

| # | Step | Trigger / who | Code | Writes | Failure handling |
|---|------|---------------|------|--------|------------------|
| A1 | Pick a print layout | Parent, `/storybook/{bookId}/print-layout?storyId=` (linked from viewer `storybook/[bookId]/page.tsx:768`) | `storybook/[bookId]/print-layout/page.tsx:102-208` lists `printLayouts` via **client SDK** (`:90`) | — | — |
| A2 | Create `printStoryBooks` doc | Parent (client SDK `addDoc`) | `print-layout/page.tsx:129-155` | `printStoryBooks/{id}` `{ownerUserId, storyId, storybookId?, storySessionId, title, childName, printLayoutId, pages:[], pdfStatus:'draft'}` | none; note `childName: story.childId` (`:140`) stores an id, not a name |
| A3 | Auto-layout | Client calls `POST /api/printStoryBooks/{id}/auto-layout` (`print-layout/page.tsx:171`) | `api/printStoryBooks/[printStoryBookId]/auto-layout/route.ts:32-283` (Admin SDK) | `printStoryBooks.pages[]` (`:272`) — covers, endpapers, interior | 500 with **stack trace in body** (`:292-297`); a failed auto-layout leaves an orphan `draft` doc |
| A4 | Review pages, generate PDFs | Parent, `/storybook/{bookId}/print-layout/{id}/pages` → `POST .../generate-pdfs` (`pages/page.tsx:56`) | `generate-pdfs/route.ts:788-955` | `pdfStatus: generating_pdfs` (`:858`) → uploads `print_storybooks/{id}/cover.pdf`, `interior.pdf` (`:730,763`) → `coverPdfUrl, interiorPdfUrl, printableMetadata, pdfStatus:'ready'` (`:915-922`) | `pdfStatus:'error'`, `pdfErrorMessage` (`:935`); no guard against concurrent runs |
| A5 | Go to order page | Client `router.push('/storybook/{bookId}/order?printStoryBookId=')` (`pages/page.tsx:73`) | — | — | **`storyId` query param is dropped**: in the new model `bookId` is the *storybookId* (`print-layout/page.tsx:33-41`), but the order page treats `bookId` as the storyId (`order/page.tsx:82,196`). `GET /api/storyBook/{bookId}` then 404s via `requireStoryReader` (`api/storyBook/[bookId]/route.ts:30`). Path A looks **broken end-to-end for new-model books** (works only when storyId == storybookId). |

Padding in Path A is **hard-coded** to min 24 / multiple of 4 (`generate-pdfs/route.ts:851-854`),
ignoring the layout/product constraints that Path B uses.

### 1b. Path B — "Printable" on the storybook itself (`finalization.*`)

| # | Step | Trigger / who | Code | Writes | Failure handling |
|---|------|---------------|------|--------|------------------|
| B1 | Generate printable PDFs | Parent, "Print" on `/parent/storybooks/[childId]` (`page.tsx:212,459`; layout defaults to `'mixam-8x10-hardcover'` `:462`); also regression page | `api/storyBook/printable/route.ts:993-1289` (Admin SDK). Ownership `:1058-1061`; rejects only `isLocked === false` (`:1074`) | `finalization.printableStatus:'generating'` (`:1089`) → `storybook_printables/{storyId}/{storybookId}/{storybook,cover,interior}-vNNN.pdf` (`:964`) → `finalization.printable*` URLs/paths/metadata, `printableStatus:'ready'`, **`finalization.status:'printable_ready'`** (`:1222-1237`); session event (`:1251`) | `printableStatus:'error'`, `printableErrorMessage` (`:1276-1278`) |
| B2 | Constraints | — | `resolvePageConstraints(layout, product)` (`print-constraints.ts:66`) via `layout.printProductId` (`printable/route.ts:1041-1053`); falls back to bundled JSON layouts (`src/data/print-layouts.json`, `printable/route.ts:1031`) | — | — |
| B3 | Go to order page | Link `/storybook/{storyId}/order?storybookId=` (`parent/storybooks/[childId]/page.tsx:732`) | — | — | This is the **only entry whose URL shape matches the order page**. The `story/[storyId]/page.tsx:357` link (`/storybook/{storybook.id}/order?storyId=`) passes `storyId` which the order page ignores → same 404 as A5. |

### 1c. Order placement (both paths converge)

| # | Step | Trigger | Code | Writes |
|---|------|---------|------|--------|
| O1 | Load order page | Parent | `storybook/[bookId]/order/page.tsx:77-165`: `GET /api/storyBook/{bookId}` (+`printStoryBookId`/`storybookId`), `GET /api/printOrders/products`, `GET /api/user/addresses` | `GET /api/user/addresses` **writes on read**: migrates legacy `users.savedShippingAddress` into the subcollection (`api/user/addresses/route.ts:27-44`) |
| O2 | Price shown | Client | `order/page.tsx:265-282` computes tier×qty + shipping + setup **client-side** from `printProducts.pricingTiers` | — |
| O3 | Submit order | Parent → `POST /api/printOrders/mixam` (`order/page.tsx:214`) | `api/printOrders/mixam/route.ts:16-475` | see below |

`POST /api/printOrders/mixam` (Admin SDK):
1. auth `requireParentOrAdminUser` (`:18`); qty 1–100 (`:34`).
2. `printProducts/{productId}` must exist & be active (`:45-60`).
3. `stories/{storyId}.parentUid == uid` unless admin (`:63-79`).
4. Resolve PDFs from **one of three sources**: `printStoryBooks` (`pdfStatus=='ready'`, `:91-121`),
   `stories/{storyId}/storybooks/{storybookId}.finalization` (`:122-176`), or legacy
   `stories/{storyId}/outputs/storybook.finalization` (`:177-194`). Requires cover+interior (`:196`).
5. Degraded-art gate `evaluateOrderArtGate` (`:206`, `lib/storybook-status.ts:108-129`) — only the
   `storybookId` branch computes `artStatus`; other branches pass `null` and the gate **fails open** (`storybook-status.ts:115`).
6. UK-only address validation/normalisation (`lib/mixam/address-validator.ts:14-89`, called `:231`).
7. Price = Mixam **cost** tiers (`:244-260`; `types.ts:911` "your cost from Mixam").
8. `printOrders.add(...)` (`:395`) with `fulfillmentStatus:'awaiting_approval'`, `paymentStatus:'unpaid'`,
   `productSnapshot`, `printableFiles`, `printableMetadata`, `estimatedCost`, `statusHistory`, `processLog`,
   `artStatusSnapshot`/`degradedArtAcknowledged` (`:264-368`). **No `approvalStatus`, `trimSize`, `pageCount`.**
9. Overwrites `users/{uid}.savedShippingAddress` every order (`:398-401`) and, if `saveAddress`,
   adds a deduped `users/{uid}/addresses` doc (`:405-433`).
10. Emails admins (`notifyOrderSubmitted`, `:439`). Returns server-derived timeline (`:451-466`).

No idempotency key, no transaction, no entitlement consumption (`print_credit` is never consumed), no payment.

### 1d. Payment

There is **no payment integration**. `paymentStatus` is only ever set by
`POST /api/printOrders/{orderId}/pay` (`api/printOrders/[orderId]/pay/route.ts:34-39`), which **the order's
own parent may call** (`:28-32`). The parent Orders page shows a "Mark as Paid (test)" button to every parent
(`parent/orders/page.tsx:352-360`). Nothing downstream checks `paymentStatus` (approve/submit do not, see 1e).
Billing to Mixam is via `systemConfig/mixam.paymentMethod` (`TEST_ORDER|ACCOUNT|CARD_ON_FILE`, default `ACCOUNT`,
`types.ts:2264-2282`; read at `submit/route.ts:166-178`).

### 1e. Admin workflow → Mixam (all manual, `/admin/print-orders[/{id}]`)

Admin detail page calls each route (`admin/print-orders/[orderId]/page.tsx:49-261`). All routes use
`requireParentOrAdminUser` + `claims.isAdmin` check, Admin SDK, read-then-write without transactions.

| Action | Route | Allowed from | Sets | Notes |
|--------|-------|--------------|------|-------|
| Approve | `.../approve/route.ts` | `awaiting_approval`, `ready_to_submit` (`:43`) | `fulfillmentStatus:'approved'`, `approvedBy/At` (`:61-72`) | Does **not** set `approvalStatus`; does not check payment. Emails admins. |
| Reject | `.../reject/route.ts` | same (`:53`) | `fulfillmentStatus:'cancelled'`, `approvalStatus:'rejected'`, `rejectedReason` (`:65-78`) | Only writer of `approvalStatus`. |
| Submit | `.../submit/route.ts` | `approved` (`:45`) | `validating` (`:105`) → build MxJdf (`:180`) → `mixamClient.submitOrderWithLogging` (`:193`) → `submitted`, `mixamOrderId/JobNumber/Status`, `mixamResponse`, `submittedToMixamAt` (`:204-233`) | On any error → back to `approved` (`:282-292`) so the admin can retry. Page-count checks duplicated (`:71-98`). Billing address from `systemConfig/addresses.mixamBillToAddressId` (`:135-160`). |
| Reset | `.../reset/route.ts` | `validating`, `validation_failed` (`:41`) | `approved` (`:52`) | Manual unstick for a crashed submit. |
| Confirm | `.../confirm/route.ts` | `submitted`, `on_hold` (`:46`) | calls Mixam confirm (`:74`) → `confirmed`, `confirmedAt/By` (`:102-117`) | |
| Resubmit | `.../resubmit/route.ts` | `on_hold`, **`submitted`** (`:50`) | `validating` → cancel previous Mixam order (`:119`) → **proceeds even if cancel fails** (`:143-167`) → new Mixam order → `submitted`, `previousMixamOrderId` (`:249-281`) | On failure → `on_hold`. |
| Cancel | `.../cancel/route.ts` | draft…`confirmed` (`:56-65`) | Mixam cancel if `mixamOrderId` (`:82`); on non-"in production" Mixam errors **still cancels locally** (`:109-111`) → `cancelled` (`:117-140`) | Emails admins. |
| Refresh | `.../refresh-status/route.ts` | any with `mixamOrderId` | `mixamStatus`, maps to `fulfillmentStatus` incl. non-enum `'printed'` (`:123-141`) | statusHistory `source:'mixam'` (not in type). |

MxJdf: `lib/mixam/mxjdf-builder.ts:237` — uses validated `productSnapshot.mixamMapping` if present else
"legacy hardcoded mappings" (`:257-267`); `externalOrderId = order.id` (`:378`); webhook URL from
`MIXAM_WEBHOOK_URL` or `NEXT_PUBLIC_APP_URL` (`:368-370`); rounds page count up to ×4 (`:361-362`);
Mixam fetches PDFs from the Firebase download-token URLs (`submit/route.ts:183-184`).

### 1f. Mixam → us: webhook

`POST /api/webhooks/mixam` (`api/webhooks/mixam/route.ts:149-470`): HMAC-SHA256 over raw body,
header `X-Mixam-Signature`, secret `MIXAM_WEBHOOK_SECRET` (503 if unset, 401 if bad, `:165-182`).
Looks up `printOrders/{metadata.externalOrderId}` (`:196-208`); calls Mixam GET status for an
authoritative value (`:247-262`); maps via `mapMixamStatusToInternal` (`:79-114`) — any `hasErrors` →
`on_hold`, unknown → `submitted`. Writes `mixamStatus`, `fulfillmentStatus` (if changed), tracking/shipment
fields, artwork errors, `lastWebhookPayload`, `adminNextAction`, `needsAdminAttention`, `failureSummary`
(`:276-401`). Emails admins on change (`:439-452`). Always returns 200, including on internal errors (`:465-468`).

### 1g. Delivery / parent visibility

`GET /api/printOrders/my-orders` (`api/printOrders/my-orders/route.ts:36-92`) — orders by `parentUid` **or**
legacy `ownerUserId` (`:45-48`), adds `timeline`, `statusCategory` (`lib/order-timeline.ts:132,180`) and
turnaround from `systemConfig/orderTransparency` (default 10–15 business days,
`lib/order-transparency-config.server.ts:12-30`; no admin writer exists). Returns the **whole order doc**
(`:66`) incl. `productSnapshot` (our costs), `mixamInteractions`, `lastWebhookPayload`. **Parents receive no
emails** — all order emails go to `users.notifiedUser == true` (`lib/email/get-notified-users.ts:11-14`).
"Delivered" is only reached if Mixam reports `DELIVERED`; there is no other delivery signal.

### 1h. Legacy order path (still routable)

`POST /api/printOrders` (`api/printOrders/route.ts:40-145`) reads `stories/{id}/outputs/{outputId}`,
requires `finalization.status == 'printable_ready'` (`:80`), writes an order with
`fulfillmentStatus:'pending'` (not a `MixamOrderStatus`) and only `printablePdfUrl` (combined PDF)
(`:87-107`), and sets `finalization.status:'ordered'` (`:109-113`). Only caller: regression page
(`admin/regression/page.tsx:859` writes orders directly via client SDK; `/api/printOrders` itself has no UI caller).
Such orders can never be submitted (no `printableFiles`).

---

## 2. Data model

### 2a. Printable edition, layout, PDFs

| Thing | Where stored | Shape |
|-------|--------------|-------|
| Layout template | `printLayouts/{id}` (admin client SDK `admin/print-layouts/page.tsx:416-421`) **and** bundled fallback `src/data/print-layouts.json` (3 layouts, none with `printProductId`/`pageConstraints`) | `PrintLayout` `types.ts:1655-1700` (inches; `leavesPerSpread`; per-page-type boxes; optional `printProductId`, `pageConstraints`; deprecated `textBoxes/imageBoxes`) |
| Print edition (Path A) | `printStoryBooks/{id}` | `PrintStoryBook` `types.ts:593-615`: `pages[]` (copy of text/image URLs), `pdfStatus`, `coverPdfUrl`, `interiorPdfUrl`, `combinedPdfUrl` (never written), `printableMetadata`, `pdfGenerationWarnings` |
| Print edition (Path B) | `stories/{s}/storybooks/{b}.finalization.*` | `StoryBookFinalization` `types.ts:303-331`: `printablePdfUrl` (combined), `printableCoverPdfUrl`, `printableInteriorPdfUrl`, `*StoragePath`, `printableMetadata`, `printableStatus`, `status`; also writes untyped `pdfGenerationWarnings`, `printablePaddingPdfUrl:null` (`printable/route.ts:1234-1237`) |
| Print edition (legacy) | `stories/{s}/outputs/storybook.finalization` | same `finalization` shape; read by order routes |
| Client-facing merge | `StoryOutput` `types.ts:762-790` — `finalization` and `storybookFinalization` (same object twice, `api/storyBook/[bookId]/route.ts:152-155`) |
| PDF metadata | `PrintableAssetMetadata` `types.ts:287-301` — stored on `printStoryBooks`, on `finalization`, and copied onto `printOrders` |
| PDF files | Storage `print_storybooks/{printStoryBookId}/{cover,interior}.pdf` (Path A) and `storybook_printables/{storyId}/{storybookId}/{storybook,cover,interior}-vNNN.pdf` (Path B). Only the latter has a storage rule (`storage.rules:45-48`). Both are fixed object names, overwritten on regeneration with a new download token. |

### 2b. Products, catalog, prices, entitlements

| Thing | Collection | Shape / notes |
|-------|-----------|---------------|
| Manufacturing spec + our cost | `printProducts/{id}` | `PrintProduct` `types.ts:826-938`: `mixamSpec` (cover/interior/binding/format/files), `pricingTiers` (cost), `shippingCost`, optional `mixamMapping` (`MixamProductMapping` `:941-988`). Seeded by `lib/seed-print-products.ts:11` (`POST /api/admin/print-products/seed`), edited by admin client SDK (`admin/print-products/page.tsx:297-326,926`). |
| Sellable offer | `products/{id}` | `Product` `types.ts:2443-2458` (`kind`, `scope`, `grants[]`, optional `printProductId`) — admin API `api/admin/products/route.ts` |
| Money point | `prices/{id}` | `Price` `types.ts:2462-2473` (`amountMinor`, `currency`, `externalPriceId` reserved for Stripe) — admin API `api/admin/prices/route.ts` |
| Catalog view | computed | `GET /api/catalog` (`api/catalog/route.ts`) — **no UI caller** |
| Entitlement components | code | `lib/catalog/entitlement-components.ts:8` (`print_credit`, `story_allowance`, `storybook_allowance`) |
| Ledger | `entitlementLedgers/{parentUid}` | `EntitlementLedger` `types.ts:2528-2535`; Admin-SDK transactions in `lib/entitlements/ledger.server.ts:55,143`; free tier = 1 story + 2 storybooks lifetime, **no print credit** (`lib/entitlements/grant.ts:29-32`) |

The two commercial layers are **not connected**: the order route prices from `printProducts.pricingTiers`
(cost) and never reads `products`/`prices` or the ledger. `applyProductGrants` (`grant.ts:118`) has no
production caller (no purchase flow).

### 2c. Order

`printOrders/{id}` — `PrintOrder` `types.ts:990-1138`. Fields actually written but not in the type:
`mixamResponse`, `submittedToMixamAt/By` (type says `mixamSubmittedAt`), `confirmedAt/By`, `resubmittedAt/By`,
`previousMixamOrderId/JobNumber`, `mixamStatusCheckedAt`, `mixamArtworkComplete`, `mixamHasErrors`,
`mixamStatusReason`, `mixamArtworkErrors`, `mixamParcelNumbers`, `mixamShipmentDate`, `mixamShipments`,
`lastWebhookPayload/At`, `artStatusSnapshot`, `degradedArtAcknowledged`, `storySessionId` (legacy).
Typed but never written: `approvalStatus` on create/approve, `trimSize`, `pageCount`, `validationResult`,
`mixamCost`, `mixamFileReferences`, `mixamSubmittedAt`, `notificationAdminUid`. `mixamInteractions[]`
(`lib/mixam/interaction-logger.ts:81,117`) grows unboundedly inside the order doc with full payloads.

### 2d. Addresses

| Thing | Where | Notes |
|-------|-------|-------|
| Address book | `users/{uid}/addresses/{id}` (`SavedAddress` `types.ts:50-56`) | CRUD `api/user/addresses/*`; also written by order route |
| Legacy single address | `users/{uid}.savedShippingAddress` (`types.ts:83`) | Still **written on every order** (`mixam/route.ts:398`); read by `GET /api/user/shipping-address` (no UI caller) and lazily migrated by `GET /api/user/addresses` |
| Order snapshot | `printOrders.shippingAddress` (normalised, country forced `GB`) | |
| System addresses | `systemConfig/addresses` `{addresses[], mixamBillToAddressId}` (`types.ts:59-64`) | Admin API `api/admin/system-config/addresses/route.ts`; used as Mixam bill-to |
| Postcode lookup | `GET /api/postcode/lookup` → getaddress.io (`GETADDRESS_API_KEY`, `api/postcode/lookup/route.ts:103-175`) | |

### 2e. Stored twice / two shapes

- **Printable edition** in three places: `printStoryBooks`, `storybooks/{b}.finalization`, legacy `outputs/storybook.finalization`.
- **PDF URLs + metadata** copied: edition → `printOrders.printableFiles` + `printableMetadata`.
- **Product spec** copied into every order (`productSnapshot`).
- **Order owner**: `parentUid` vs legacy `ownerUserId` (rules `firestore.rules:229-246`, `my-orders:45-48`, `pay:28`).
- **Finalization**: `stories/{id}.storybookFinalization` (written by pay route `pay/route.ts:46`) vs `.../finalization`.
- **Shipping address**: `savedShippingAddress` vs `addresses` subcollection.
- **Page constraints**: `PrintLayout.pageConstraints`, `PrintProduct.mixamSpec.format`, binding minimum
  (`print-constraints.ts:35-40`), hard-coded 24/×4 in `generate-pdfs/route.ts:851`, and again in
  `submit/route.ts:77-98` and `resubmit/route.ts:77-97`.
- **Status**: `fulfillmentStatus` vs `mixamStatus` (raw Mixam string) vs `statusHistory[]` vs `adminNextAction` (persisted by webhook, re-derived by list API `admin/print-orders/route.ts:122-137`).
- **Price**: `PrintProduct.pricingTiers` (cost, shown as price) vs `prices.amountMinor` (retail, unused).

---

## 3. Status fields

| Field | Values (type) | Setters | Notes / contradictions |
|-------|---------------|---------|------------------------|
| `printStoryBooks.pdfStatus` | `draft, generating_pdfs, ready, error` (`types.ts:580`) | `draft` client (`print-layout/page.tsx:143`); `generating_pdfs` (`generate-pdfs:858`); `ready` (`:919`); `error` (`:936`) | Type is named `PrintStoryBookStatus` but field is `pdfStatus`. A stuck `generating_pdfs` has no recovery. Owner can write any value via client SDK (`firestore.rules:224-225`). |
| `finalization.status` | `draft, ready_to_finalize, finalized, printable_pending, printable_ready, ordered` (`types.ts:269-275`) | `printable_ready` (`printable/route.ts:1232`, and synthesised in GET `storyBook/[bookId]/route.ts:113`); `ordered` only by legacy `api/printOrders/route.ts:110` | `ready_to_finalize`, `printable_pending` never set. New-model orders never set `ordered`/`lastOrderId`. `StoryOutput` re-declares a 4-value subset (`types.ts:775`). |
| `storybookFinalization.status` | same | `ordered` by pay route on the **story** doc (`pay/route.ts:46`, errors swallowed) | Different document and field from the above. |
| `finalization.printableStatus` | `idle, generating, ready, error` | `printable/route.ts:1090,1231,1277` | Parallel to `pdfStatus`. |
| `printOrders.fulfillmentStatus` | `MixamOrderStatus`: `draft, validating, validation_failed, ready_to_submit, awaiting_approval, approved, submitting, submitted, confirmed, in_production, on_hold, shipped, delivered, cancelled, failed` (`types.ts:808-823`) | `awaiting_approval` (`mixam/route.ts:288`); `approved` (approve `:62`, reset `:53`, submit-fail `:283`); `validating` (submit `:106`, resubmit `:104`); `submitted` (submit `:205`, resubmit `:250`, webhook); `confirmed` (confirm `:103`, webhook); `cancelled` (reject `:66`, cancel `:118`, webhook); `on_hold` (resubmit-fail `:304`, webhook); `in_production/shipped/delivered` (webhook, refresh); **`pending`** (legacy `printOrders/route.ts:100`); **`printed`** (`refresh-status:130`) | Never set: `draft, validation_failed` (only as a history entry), `ready_to_submit, submitting, failed`. Webhook's local `MixamOrderStatus` type shadows the shared one (`webhooks/mixam/route.ts:69-77`). No transition guard in webhook/refresh, so `delivered→submitted` or `cancelled→in_production` regressions are possible. `deriveOrderStatusCategory` maps unknown (`pending`, `printed`) to `pending` (`order-timeline.ts:202`). |
| `printOrders.mixamStatus` | free string | submit/resubmit/confirm/refresh/webhook; `'CANCELED'` by cancel (`:137`) | Raw Mixam vocabulary (`PENDING, INPRODUCTION, DISPATCHED, ONHOLD…`). |
| `printOrders.paymentStatus` | `unpaid, paid, refunded` | `unpaid` on create; `paid` by parent/admin via `/pay` | `refunded` never set; nothing checks it. |
| `printOrders.approvalStatus` | `pending, approved, rejected` | only `rejected` (`reject/route.ts:67`) | Read by parent page (`parent/orders/page.tsx:299`). Approval is actually encoded in `fulfillmentStatus`. |
| `adminNextAction.action` | `AdminNextActionId` (`lib/mixam/order-state.ts:16`): `none, monitor, review_approval, submit_to_mixam, confirm_order, investigate_hold, fix_artwork, investigate_failure` | webhook persists (`:382-387`); list API re-derives (`admin/print-orders/route.ts:122`) | Pure function `deriveAdminNextAction` (`order-state.ts:47-111`) = the admin "state machine"; it is advisory only. |
| Parent timeline | steps `placed, review, submitted, printing, shipped`; state `active, shipped, delivered, cancelled, failed`; category `pending, in_progress, completed, cancelled` (`order-timeline.ts:16-45`) | derived only | |
| Art gate | `completeness` (`ready/degraded/...`), `isOrderable` → `degraded_confirmation_required` / `not_orderable` (`storybook-status.ts:108-129`) | derived | Applied only in the `storybookId` branch. |
| Entitlements | `meter: consumable/quota/boolean`; `reset: one_time/per_period/lifetime`; `GrantSource` (`types.ts:2415-2486`) | ledger transactions | `print_credit` never granted or consumed in production code. |
| `MixamConfig.paymentMethod` | `TEST_ORDER, ACCOUNT, CARD_ON_FILE` | admin `api/admin/system-config/mixam/route.ts:79` | Default `ACCOUNT` = real billing if the config doc is missing. |

---

## 4. Terminology

| Concept | Names used | Where |
|---------|-----------|-------|
| Print-ready edition of a book | `PrintStoryBook` / "print storybook" | `printStoryBooks`, `types.ts:593`, `print-layout/*` pages |
| | "printable", `printable*` fields, "printable PDFs" | `finalization.printable*`, `/api/storyBook/printable` |
| | "output", `outputId` | `PrintOrder.outputId` holds a printStoryBookId **or** storybookId **or** storyId (`mixam/route.ts:267`) |
| Book | storybook / storyBook / StoryBookOutput / StoryOutput / `bookId` | `bookId` means storyId on some routes and storybookId on others |
| Layout | print layout / `PrintLayout` / `printLayoutId` | `printLayouts` |
| Manufacturing spec | print product / `PrintProduct` / "products" | `printProducts`, `/api/printOrders/products`, order page `products` state |
| Sellable offer | product / catalog product / `Product` / `CatalogEntry` | `products`, `/api/catalog`, `/admin/products` |
| Price | `pricingTiers.basePrice` (cost, GBP major units) / `estimatedCost` / `Price.amountMinor` (retail, minor units) | `types.ts:911`, `mixam/route.ts:280`, `types.ts:2462` |
| Order | print order / `PrintOrder` / Mixam order / job | `printOrders`; `mixamOrderId` vs `mixamJobNumber` |
| Order status | fulfillment status / Mixam status / `MixamOrderStatus` | `MixamOrderStatus` type is our status, not Mixam's |
| Submit | submit / send to printer / `submitted` | admin submit route; parent timeline "Sent to printer" |
| Owner | `parentUid` / `ownerUserId` | orders use both; `printStoryBooks` uses `ownerUserId` |
| Padding | padding pages / blank pages / `blankPages` | `PrintProduct.blankPages` (unused by generators) |

---

## 5. Collections touched

SDK: **C** = client Firestore SDK (rules apply), **A** = Admin SDK (bypasses rules).

| Collection / doc | Reads | Writes |
|------------------|-------|--------|
| `printStoryBooks` | A: auto-layout, generate-pdfs, `printOrders/mixam:93`, `storyBook/[bookId]:89`, cleanup, help-sample-data. C: pages page (`:34`) | C: create (`print-layout/page.tsx:155`). A: auto-layout (`:272`), generate-pdfs (`:858,915,935`), help-sample-data |
| `printLayouts` | C: print-layout page, admin print-layouts, `parent/storybooks`, story/create-book pages, writer. A: auto-layout, generate-pdfs, printable, storybookV2/images & create, pagination flow | C: admin print-layouts (`:416,932,969,989`) — rules allow writers too (`firestore.rules:296-299`) |
| `printProducts` | A: `printOrders/products`, `printOrders/mixam`, printable, pagination flow. C: admin print-products, print-layouts | C: admin print-products (`:326,926`). A: seed (`seed-print-products.ts`) |
| `printOrders` | A: all `api/printOrders/*`, `api/admin/print-orders/*`, webhook, ops metrics/health-check, audit, cleanup. C: view-as-parent (`:402`), firestore-test | A: `printOrders/mixam:395`, legacy `printOrders:87`, `pay:34`, every admin action route, webhook (`:401`), interaction-logger. C: regression page (`:859`); **rules allow owner create/update/delete** (`firestore.rules:240-246`) |
| `stories/{s}/storybooks/{b}` | A: printable, `printOrders/mixam:125`, `storyBook/[bookId]:60` | A: printable (`finalization.*`) |
| `stories/{s}/outputs/storybook` | A: legacy `printOrders`, `printOrders/mixam:180`, `storyBook/[bookId]:34` | A: legacy `printOrders:109` |
| `stories/{s}` | A: all order routes (ownership) | A: pay route `storybookFinalization.*` |
| `storySessions/{id}/events` | — | A: printable, legacy order, pay, submit, webhook |
| `users/{uid}` | A: addresses GET, shipping-address, notified users | A: `savedShippingAddress` (order route, addresses migration) |
| `users/{uid}/addresses` | A: addresses API, order route | A: addresses API, order route (`:422`) |
| `systemConfig/addresses` | A: submit, resubmit, admin API | A: admin API (`:157`) |
| `systemConfig/mixam` | A: submit, resubmit, admin API | A: admin API (`:79`) |
| `systemConfig/orderTransparency` | A: `order-transparency-config.server.ts:28` | none |
| `systemConfig/email`, `systemConfig/diagnostics` | A: send-email, webhook | (config area) |
| `products`, `prices` | A: `/api/catalog`, admin APIs | A: admin APIs |
| `entitlementLedgers` | A: `/api/entitlements/check`, `/summary` | A: ledger transactions (from storyCompile / storybookV2 create) |

---

## 6. Live vs dead, bugs, risks

### 6a. Live vs dead

| Item | Status | Evidence |
|------|--------|----------|
| Path B (`/api/storyBook/printable` → order with `storybookId`) | **Live, coherent** | `parent/storybooks/[childId]/page.tsx:459,732` |
| Path A (`printStoryBooks` + auto-layout + generate-pdfs) | **Reachable, likely broken at order step** for new-model books | §1a A5; `story/[storyId]/page.tsx:357` link has the same defect |
| `POST /api/printOrders` (legacy create) | Dead in UI (regression only) | no caller in app/components |
| `POST /api/printOrders/{id}/pay` | Live but a test stub exposed to parents | `parent/orders/page.tsx:352-360` |
| `GET /api/user/shipping-address` | Dead (no caller); `PUT` documented but not implemented | `api-documentation/page.tsx:67-68`, `docs/API.md:3685` |
| `GET /api/catalog` | No UI caller | grep |
| `lib/mixam/pdf-validator.ts` | Dead (no importer) | grep |
| `mixamClient.uploadFile`, `getPriceQuote` | Dead (only wrappers / mixam-catalogue calls used) | `lib/mixam/client.ts:217,808` |
| `lib/seed-print-products.ts` `getActivePrintProducts`, `getPrintProduct` | Dead | grep |
| `lib/email/templates.ts` order templates via `test-email` only; `get-notified-users` used by notify-admins | Live | |
| Legacy `stories/{s}/outputs/storybook` branches in order + `storyBook/[bookId]` | Legacy | `mixam/route.ts:177-194` |
| `PrintLayout.textBoxes/imageBoxes`, `PrintStoryBook.combinedPdfUrl`, `PrintOrder.mixamCost/mixamFileReferences/validationResult/notificationAdminUid`, `PrintProduct.blankPages` | Never written | grep |
| `api-documentation/page.tsx:58` describes `/api/printOrders/mixam` as "Get Mixam pricing quote" | Wrong | it creates orders |

### 6b. Bugs and inconsistencies

1. Path A order URL loses `storyId` → 404 (§1a A5); `childName` stores `story.childId` (`print-layout/page.tsx:140`).
2. Regenerating PDFs overwrites the same object path with a new download token (`printable/route.ts:964,980`;
   `generate-pdfs/route.ts:730-750`) — URLs already copied onto an order stop working, and artwork under an
   order is mutable after it is placed.
3. Path A padding ignores layout/product (`generate-pdfs:851`); the product chosen at checkout is not the
   product used to compute padding (Path B uses `layout.printProductId`, `printable:1044`) — trim size / binding can disagree with the order's `productSnapshot`.
4. `approvalStatus` is never `approved`; `validationResult` is never written, so its checks in approve/submit are no-ops.
5. Status vocabulary leaks: `pending`, `printed` outside the enum; webhook default maps unknown statuses to `submitted`.
6. Admin list fetches `limit(100)` without `orderBy` then sorts in memory (`admin/print-orders/route.ts:51,153`) — older/newer orders can silently drop out.
7. `GET /api/printOrders/my-orders` returns cost snapshot, raw Mixam payloads and interaction logs to parents.
8. Parents get no order emails; `notifyOrderApproved/Rejected/Cancelled` go to admins only.
9. `auto-layout` returns stack traces (`:296`).
10. `print-layout/page.tsx` creates the doc with the client SDK then relies on a follow-up API call; a failure leaves an empty `draft` edition.

### 6c. Unsafe for real orders (money, double submission, idempotency)

- **Firestore rules let a parent create/update/delete their own `printOrders`** (`firestore.rules:240-246`):
  they can set `fulfillmentStatus:'approved'`, `paymentStatus:'paid'`, change `estimatedCost`, `quantity`,
  `shippingAddress` or `printableFiles` URLs after admin review, and the admin submit route trusts the doc.
  Likewise owners can set `printStoryBooks.pdfStatus:'ready'` and arbitrary `coverPdfUrl` (`:224-225`), which
  the order route copies into the order.
- **No payment**: parent self-marks paid; approve/submit ignore payment; Mixam billing defaults to `ACCOUNT`.
- **Price shown = our Mixam cost**, computed client-side and again server-side; retail `prices` unused.
- **No idempotency on order creation** (`printOrders.add`, `mixam/route.ts:395`): double-submit creates duplicates.
- **Double submission to Mixam**: submit/resubmit are read-check-write without a transaction (`submit:33-106`);
  two concurrent clicks both pass `approved` and both POST to Mixam. If the Mixam call succeeds but the
  response is lost/times out, status returns to `approved` (`submit:283`) and a retry creates a second Mixam
  order. No idempotency key is sent (`mxjdf-builder.ts:378` uses `order.id` only as metadata).
- **Resubmit** proceeds when cancelling the previous Mixam order fails (`resubmit:143-167`) → two live jobs;
  it is also allowed from `submitted` (`:50`).
- **Cancel** marks the order cancelled locally even when Mixam cancel failed for reasons other than "in production" (`cancel:109-111`).
- **Webhook** does not check `webhook.orderId === order.mixamOrderId`, so events for a cancelled previous Mixam
  job (after resubmit) can overwrite the live order (e.g. to `cancelled`); no monotonic/terminal-state guard;
  returns 200 on internal errors so updates are lost without retry (`webhooks/mixam/route.ts:465-468`).
- **Order doc growth**: `mixamInteractions`, `statusHistory`, `processLog`, `lastWebhookPayload`, `mixamShipments` all
  accumulate in one document (1 MiB Firestore limit).
- **`'use server'` library modules** (`lib/entitlements/ledger.server.ts:1`, `lib/seed-print-products.ts:1`,
  `api/printOrders/route.ts:1`, `pay/route.ts:1`) export async functions such as `saveLedger(ledger)` and
  `seedHardcoverProduct()` without auth checks; if Next registers them as Server Actions they are callable
  from the client. Worth verifying.

---

## Observations for the redesign

- One **print edition** concept is needed; today there are three (printStoryBook, storybook finalization,
  legacy output), two PDF generators (`generate-pdfs` ~950 lines, `printable` ~1290 lines) with diverging
  padding/font logic, and three ways `bookId` is interpreted.
- An order should reference an **immutable, versioned artwork snapshot** (content-addressed PDFs), not
  mutable URLs.
- Status needs a single owned state machine with guarded transitions (server-only writes, transactions,
  idempotency keys toward Mixam, webhook matched on Mixam order id), separate from raw `mixamStatus`.
- The commercial layer (`products`/`prices`/`entitlementLedgers`/`print_credit`) exists but is not wired to
  ordering or payment; `PrintProduct.pricingTiers` is cost, not price.
- Parent-facing read model (timeline, status category) is already server-derived and could be the API
  contract; the raw order doc should not be returned to parents.
