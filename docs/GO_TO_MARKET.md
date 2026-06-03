# Go-to-Market Plan

> **Last Updated**: 2026-06-03
>
> This document defines the full end-to-end go-to-market plan for StoryPic Kids, structured as executable todos organised by phase. It is designed to be executed with minimal headcount.

---

## Overview

The plan has four sequential phases:

| Phase | Focus | Goal |
|-------|-------|------|
| 1 | MVP Finalisation | Production-quality product with automated usability tests |
| 2 | Monetisation & Journey Visibility | Stripe payments, usage limits, and user analytics |
| 3 | Beta Launch | Real families, real costs, real feedback |
| 4 | Public Launch | Scale, iterate, grow |

---

## Phase 1 — MVP Finalisation

> **Goal**: A polished, tested product that can be confidently put in front of paying strangers.

### 1.1 UI Polish & Consistency

- [ ] **Conduct a full UI consistency audit across all parent-facing routes** (`/parent/**`)
  - Typography, spacing, colour, and component alignment
  - Every async state must have a loading skeleton or spinner
  - Every empty state (no children, no stories, no books) must have a helpful prompt/CTA
  - Every error state must show a user-actionable message, not a raw error string

- [ ] **Conduct a full UI audit across all kids-facing routes** (`/kids/**`, `/story/**`, `/storybook/**`)
  - Touch targets ≥ 44×44px throughout
  - All interactive elements reachable without hover
  - Animations don't block interaction or cause seizure risk (check timing/flicker)
  - Story creation flow tested on iPad (768px) and phone (390px)

- [ ] **Implement consistent onboarding / empty-state journey for new parents**
  - Welcome screen after first sign-up
  - Guided prompt to add first child
  - Guided prompt to create first story after child is added
  - "Your first storybook is ready" celebratory moment after generation completes

- [ ] **Audit all modals and dialogs**
  - Focus trapped inside while open
  - Escape key and backdrop click close them
  - Scroll position preserved behind modal

### 1.2 Automated Usability Tests

- [ ] **Set up Playwright E2E test suite**
  - Install as a dev dependency, configure for the Next.js dev server
  - Run against a dedicated Firebase Emulator project (not production data)
  - Integrate into CI so tests must pass before merge to main

- [ ] **Write E2E test: Happy-path story creation**
  - Sign in as parent → add child → launch story session
  - Complete warmup → pick a story beat path → reach ending → compile
  - Assert story appears in parent storybooks list

- [ ] **Write E2E test: Storybook generation**
  - Trigger generation from a compiled story
  - Poll until `imageGeneration.status === 'ready'`
  - Assert all pages have `imageUrl` set and storybook is viewable

- [ ] **Write E2E test: Print order placement**
  - From a finalized storybook, open print flow
  - Select product, confirm order
  - Assert order appears in admin order list

- [ ] **Write E2E test: Kids reading flow**
  - Open a ready storybook in kids mode
  - Navigate through all pages, assert audio plays, assert page turns work

- [ ] **Write E2E test: Auth flows**
  - Sign up, sign in, password reset, sign out
  - Verify protected routes redirect unauthenticated users

### 1.3 Public Marketing Page

- [ ] **Build a public landing page at `/`** (currently unclear what the root route shows)
  - Hero section: value proposition in one sentence ("Turn your child's imagination into a real illustrated storybook")
  - Example storybook embed or image carousel showing real output quality
  - How it works: 3-step visual (Create story → Generate book → Print & keep)
  - Social proof placeholder (ready for beta testimonials)
  - Single prominent CTA: "Create your child's first story — free"

- [ ] **Build a `/pricing` page** (can be placeholder until monetisation is complete)
  - Communicate free vs paid tiers clearly
  - Highlight what makes paid worth it (unlimited stories, physical books)

- [ ] **Set up basic SEO**
  - `<title>` and `<meta description>` on all public pages
  - Open Graph tags for social sharing
  - `robots.txt` and `sitemap.xml`

### 1.4 End-to-End QA Pass

- [ ] **Full manual walkthrough of story creation with at least 3 different story types**
  - Verify all AI phases complete without errors
  - Check compiled story text is coherent and appropriately personalised

- [ ] **Full manual walkthrough of storybook generation**
  - Verify exemplars generate correctly for each actor
  - Verify images are consistent with character descriptions
  - Verify audio narration is correct and synced

- [ ] **Full manual walkthrough of print order flow**
  - Place a test order through to admin approval
  - Verify PDF is print-quality (300 DPI, correct dimensions)
  - Verify Mixam submission succeeds in staging

- [ ] **Test all admin pages**
  - AI logs, run traces, order management, content config
  - Verify regression test page passes all tests

---

## Phase 2 — Monetisation & Journey Visibility

> **Goal**: The product earns money and you can see exactly what users are doing and what it costs to serve them.

### 2.1 Pricing Model Decision

- [ ] **Define subscription tiers** (decision required before building)
  - Suggested: **Free** (1 story/month, digital only) | **Family £7.99/mo** (unlimited stories, 10% off prints) | **Annual £69/yr** (same as Family, ~28% saving)
  - Document the tier definitions and feature gates in this file before implementation

- [ ] **Define what's gated behind paid tier**
  - Story creation beyond monthly limit
  - Voice cloning (currently ElevenLabs cost)
  - Priority image generation queue
  - Print ordering (or just discount?)

### 2.2 Stripe Integration

- [ ] **Add Stripe as payment provider**
  - Install `stripe` npm package server-side
  - Create Stripe products and prices for each tier
  - Store `stripeCustomerId` and `subscriptionStatus` on the parent's Firestore document
  - Create `/api/billing/create-checkout-session` for new subscriptions
  - Create `/api/billing/portal` for existing subscription management (Stripe Customer Portal)
  - Create `/api/billing/webhook` to handle Stripe events (subscription created/updated/cancelled/payment failed)

- [ ] **Enforce feature gates based on subscription tier**
  - Middleware or per-route check: count stories created this billing period
  - Return `402 Payment Required` with a `reason` field when limit exceeded
  - Client-side shows upgrade prompt modal on 402

- [ ] **Add `/parent/billing` page**
  - Current plan name and renewal date
  - Stories used this month / limit
  - "Manage subscription" button → Stripe Customer Portal
  - "Upgrade" CTA if on free tier

### 2.3 Print Order Payment

- [ ] **Add Stripe payment step to print order flow**
  - Before order is submitted to admin queue, collect payment via Stripe
  - Print product prices stored in `printProducts` collection — sync to Stripe prices
  - On successful payment, create order with `paymentStatus: 'paid'`
  - On failed payment, show error and allow retry

- [ ] **Email receipts**
  - Send order confirmation email after payment
  - Send dispatch notification email when Mixam ships
  - Use a transactional email provider (e.g., Resend or SendGrid)

### 2.4 User Journey Tracking & Funnel Analytics

- [ ] **Define and instrument key funnel events**
  - `signup_completed` — parent finishes registration
  - `child_added` — first child profile created
  - `story_started` — story session initiated
  - `story_completed` — story compiled successfully
  - `storybook_generation_started`
  - `storybook_generation_completed`
  - `print_order_initiated`
  - `print_order_paid`
  - Write events to a `analyticsEvents` Firestore collection with `{eventName, userId, sessionId, timestamp, properties}`

- [ ] **Build funnel visualisation in admin dashboard**
  - New admin page: `/admin/funnel`
  - Show conversion at each step: signups → child added → story created → storybook generated → print ordered
  - Date range filter (last 7d, 30d, all time)
  - Identify and highlight the biggest drop-off point

- [ ] **Build per-user journey view in admin**
  - From the users admin page, click into a user to see their full event timeline
  - Useful for diagnosing where a specific beta user got stuck

### 2.5 Per-Family AI Cost Monitoring

- [ ] **Aggregate AI costs per parent account**
  - `aiRunTraces` already captures token usage and cost estimates per session
  - Add a `parentId` field to `aiRunTraces` documents (currently may only have `sessionId`)
  - Create an aggregation query: total AI cost per parent per calendar month

- [ ] **Build AI cost dashboard in admin** (`/admin/costs`)
  - Table: parent email | stories this month | total AI cost | subscription tier
  - Flag families where AI cost > subscription revenue (loss-making accounts)
  - Monthly total AI spend trend graph
  - Alert when a single family exceeds a configurable cost threshold (e.g., £5/month in AI costs)

- [ ] **Set up cost alerts**
  - Admin notification (email or in-app) when monthly total AI spend exceeds a configured budget
  - Per-family alert when a family's cost exceeds their subscription value
  - Configuration in `systemConfig/costAlerts`

---

## Phase 3 — Beta Launch

> **Goal**: 20–50 real families using the product over 30–60 days. Validate engagement, costs, and willingness to pay.

### 3.1 Beta Infrastructure

- [ ] **Create a beta invite / waitlist system**
  - Simple `/beta` page with email capture form
  - Store waitlist entries in Firestore (`betaWaitlist` collection)
  - Manual invite flow: admin marks user as invited → Firebase Auth invite email sent
  - Cap beta cohort size (suggest 30 families for first cohort)

- [ ] **Add beta user flag to parent accounts**
  - `isBetaUser: true` on parent document
  - Beta users get full paid-tier access free for duration of beta
  - Visible label in admin user list

- [ ] **Set up a beta-specific feedback channel**
  - Create a dedicated email address or Slack channel for beta feedback
  - Communicate it clearly in onboarding

### 3.2 Beta Onboarding

- [ ] **Write and send welcome email sequence** (manual or via Resend/SendGrid)
  - **Day 0**: Welcome, how to get started (link to onboarding guide), feedback channel
  - **Day 3**: Check-in — "Have you created your first story? Here's a tip..."
  - **Day 7**: Feature highlight — "Did you know you can clone your voice for narration?"
  - **Day 14**: Mid-point feedback request (short Google Form or Typeform)
  - **Day 30**: Final survey link + thank you

- [ ] **Create a beta onboarding guide** (Google Doc or `/docs/beta-guide.md`)
  - Step-by-step: how to add a child, create a story, generate a book, order a print
  - Known limitations during beta
  - How to report bugs
  - What feedback is most valuable

### 3.3 Beta Monitoring Dashboard

- [ ] **Build a beta cohort dashboard** (`/admin/beta`)
  - List of all beta users with:
    - Account created date
    - Stories created count
    - Storybooks generated count
    - Print orders placed
    - Last activity date
    - Total AI cost incurred
  - Colour-coded: green (engaged), amber (started but stalled), red (no activity after signup)

- [ ] **Set up daily digest report**
  - Automated daily summary: new signups, active users today, stories completed, errors, AI cost (today + cumulative)
  - Delivered via email or Slack webhook to admin
  - Can start as a manual admin page that you check daily

- [ ] **Real-time error alerting**
  - Alert admin when an AI flow fails with `failure` status
  - Alert when a user encounters an unhandled error
  - Include: user email, flow name, error message, timestamp

### 3.4 In-App Beta Feedback

- [ ] **Add a persistent feedback button to the parent portal**
  - Floating button or nav item: "Send feedback"
  - Opens a modal: short text field + optional screenshot upload
  - Stores in `betaFeedback` Firestore collection
  - Email notification to admin on each submission

- [ ] **NPS prompt after first storybook generated**
  - One-time modal: "How likely are you to recommend StoryPic Kids? (0–10)"
  - Optional follow-up: "What's the one thing you'd improve?"
  - Store in `npsResponses` collection with userId and timestamp

### 3.5 Beta Exit & Go/No-Go Decision

- [ ] **Define beta success criteria** (decide before beta starts)
  - Suggested metrics:
    - ≥ 60% of beta families complete at least one storybook generation
    - ≥ 40% NPS score (% promoters − % detractors)
    - ≥ 25% of beta families express willingness to pay at the target price
    - AI cost per active family ≤ £3/month average
    - Zero P0 production bugs in final 2 weeks of beta

- [ ] **Conduct beta exit survey** (send at day 30)
  - Ease of use (1–5 scale)
  - Child engagement (1–5 scale)
  - Quality of storybooks (1–5 scale)
  - Would you pay £7.99/month? (Yes/No/Maybe + what would you pay?)
  - Top 3 feature requests (open text)
  - Would you recommend to another parent? (NPS)

- [ ] **Conduct 3–5 user interviews** (30 min each, via video call)
  - Recruit from engaged beta users (completed ≥ 2 storybooks)
  - Focus on: motivations, friction points, willingness to pay, feature requests
  - Record and transcribe for reference

- [ ] **Beta retrospective and go/no-go decision**
  - Review all metrics against success criteria
  - Summarise feedback themes
  - Decide: launch as-is | iterate then launch | pivot

---

## Phase 4 — Public Launch

> **Goal**: Open access, scale operations, and establish a growth loop.

### 4.1 Pre-Launch

- [ ] **Activate payments** — Stripe live mode, real billing, free trial for new signups (7 days)

- [ ] **Set up transactional email** — order confirmations, subscription receipts, password resets

- [ ] **Set up a support channel**
  - Intercom widget or simple contact form on the site
  - Shared inbox for `support@storypic.kids` (or similar)
  - SLA: respond within 24 hours during beta, 48 hours post-launch

- [ ] **Legal & compliance**
  - Privacy Policy (required for GDPR / collecting children's data)
  - Terms of Service
  - Cookie consent banner (if using analytics)
  - COPPA consideration for US users (parental consent for children under 13)
  - Age verification or parental gate before child profile creation

- [ ] **Stress test and load testing**
  - Simulate 50 concurrent story generation sessions
  - Verify Firestore, Storage, and AI API rate limits hold
  - Verify Next.js on Firebase App Hosting scales correctly

### 4.2 Launch Channels

- [ ] **Product Hunt launch** — prepare assets, schedule for a Tuesday–Thursday
- [ ] **Parent community outreach** — identify 5–10 Facebook/Reddit parenting groups for launch day posts
- [ ] **Press outreach** — shortlist 3–5 journalists covering edtech, AI, or parenting products
- [ ] **Referral mechanism** — "Share with another parent and both get 1 free story" in-app prompt

### 4.3 Post-Launch Monitoring

- [ ] **Daily operational review** (first 2 weeks)
  - Error rate, AI costs, conversion rate, churn
  - Triage and fix P1 bugs within 24 hours

- [ ] **Weekly metrics review**
  - Funnel conversion rates (signup → paid)
  - MRR growth
  - AI cost as % of revenue (target: ≤ 40%)
  - Net Promoter Score (rolling 30-day)

---

## Appendix: Key Metrics to Track

| Metric | Target (Beta) | Target (Launch) |
|--------|--------------|-----------------|
| Story completion rate | ≥ 60% | ≥ 70% |
| Storybook generation success rate | ≥ 90% | ≥ 95% |
| AI cost per active family/month | ≤ £3 | ≤ £2.50 |
| NPS | ≥ 40 | ≥ 50 |
| Free → paid conversion | n/a (beta free) | ≥ 10% in 30 days |
| Monthly churn | n/a | ≤ 5% |
| Avg time to first storybook | — | ≤ 20 minutes |

---

## Appendix: Key Decisions Still Required

Before implementation can begin on some items, these decisions must be made:

1. **Pricing**: What are the exact tier prices and feature limits?
2. **Free trial**: 7-day trial, or a permanent free tier with a monthly story limit?
3. **Print pricing**: Handled by Stripe or invoiced separately through Mixam cost?
4. **Beta cohort size**: How many families in the first beta?
5. **Beta duration**: 30 days or 60 days?
6. **Support channel**: Intercom, Crisp, or email-only?
7. **Email provider**: Resend or SendGrid for transactional email?
