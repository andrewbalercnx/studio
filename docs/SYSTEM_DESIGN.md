# System Design Document

> **Last Updated**: 2026-01-07
>
> This document describes the current architecture of StoryPic Kids. It should be read at the beginning of any major piece of work to understand the system before making changes.

---

## Overview

StoryPic Kids is an interactive story creation platform for children. Children create personalized stories through guided conversations with an AI, which are then transformed into illustrated storybooks that can be viewed digitally or printed as physical books.

### Core User Flows

1. **Story Creation**: Child interacts with AI through warmup → story beats → ending → compilation
2. **Storybook Generation**: Story text is paginated, images are generated, audio narration is added
3. **Print Ordering**: Parents can order physical copies through Mixam print-on-demand integration

---

## Technology Stack

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI Library**: React 18.3 with TypeScript 5
- **Styling**: Tailwind CSS with Radix UI components (shadcn/ui)
- **Forms**: React Hook Form with Zod validation

### Backend
- **API Routes**: Next.js App Router API handlers (`src/app/api/`)
- **AI Orchestration**: Genkit 1.25 for managing AI flows
- **Database**: Cloud Firestore (NoSQL)
- **Storage**: Firebase Storage for images, audio, and PDFs
- **Authentication**: Firebase Authentication

### AI/ML Services
- **Text Generation**: Google Gemini models (2.5-pro via googleAI plugin)
- **Image Generation**: Vertex AI (Imagen)
- **Video Generation**: Vertex AI (Veo for avatar animations)
- **Voice Cloning & TTS**: ElevenLabs

### External Integrations
- **Print-on-Demand**: Mixam API for book printing
- **Payment**: (Future integration point)

---

## Architecture Decisions

### Why Firestore (NoSQL)?

Firestore was chosen for several reasons:
- **Real-time subscriptions**: UI can react to data changes immediately
- **Hierarchical data model**: Natural fit for parent → child → story → pages structure
- **Offline support**: Progressive web app can work offline
- **Security rules**: Fine-grained access control at document level
- **Scalability**: Automatic scaling without database administration

### Why Genkit for AI Orchestration?

Genkit provides:
- **Flow abstraction**: Complex AI operations broken into testable flows
- **Model abstraction**: Easy to switch between Gemini versions
- **Tracing**: Built-in observability for debugging AI calls
- **Type safety**: TypeScript-first with Zod schema validation

### Why Next.js App Router?

- **Server Components**: Reduced client bundle size
- **API Routes**: Backend logic colocated with frontend
- **Static/Dynamic rendering**: Optimal performance per route
- **Middleware**: Authentication and routing logic

### Why ElevenLabs for Voice?

- **Voice cloning**: Parents can clone their voice for narration
- **High quality TTS**: Natural-sounding narration for children
- **Multiple voices**: Preset voices available without cloning

---

## System Components

### 1. Authentication Layer

```
Firebase Auth → Custom Claims → Role-Based Access
```

**Roles**:
- `isAdmin`: Full system access, order management
- `isWriter`: Content configuration (prompts, story types)
- `isParent`: Own children, stories, orders

**Implementation**: Custom claims set via Firebase Admin SDK. Firestore security rules enforce access based on claims.

### 2. Story Session Engine

```
Session State Machine:
warmup → story (beats 0-N) → ending → final/completed
```

**Key Collections**:
- `storySessions`: Session state and metadata
- `storySessions/{id}/messages`: Chat history

**Flow**:
1. Session created with `currentPhase: 'warmup'`
2. `/api/warmupReply` handles warmup interactions
3. Session transitions to `story` phase with `storyTypeId` set
4. `/api/storyBeat` generates story options, advances `arcStepIndex`
5. At arc completion, `/api/storyEnding` generates endings
6. `/api/storyCompile` creates final story text

### 3. Storybook Generation Pipeline

```
Story → Pages → Images → Audio → Finalization
```

**Data Model** (new structure):
```
stories/{storyId}
  └── storybooks/{storybookId}
        └── pages/{pageId}
```

**Pipeline Steps**:
1. **Pagination** (`/api/storybookV2/pages`): Story text → page structure
2. **Image Generation** (`/api/storybookV2/images`): Page descriptions → illustrations
3. **Audio** (`/api/storyBook/audio`): Text → TTS narration
4. **Finalization** (`/api/storybookV2/finalize`): Lock content version

### 4. Print Production System

```
Storybook → PrintStoryBook → PDF Generation → Mixam Order
```

**Key Collections**:
- `printStoryBooks`: Print-specific layout and configuration
- `printOrders`: Order tracking and fulfillment
- `printProducts`: Product catalog (hardcover, paperback options)
- `printLayouts`: Page layout templates

**Workflow**:
1. Parent initiates print from finalized storybook
2. `PrintStoryBook` created with layout configuration
3. PDFs generated (separate cover and interior for Mixam)
4. Order created, awaits admin approval
5. Admin approves → submitted to Mixam API
6. Webhooks update order status through fulfillment

### 5. Character & Actor System

**Actors** are entities that appear in stories (children, characters). They use `$$id$$` placeholder syntax in story text for personalization.

**Collections**:
- `children`: Child profiles with photos, preferences
- `characters`: Story characters (pets, toys, family members)

**Avatar Generation**:
- Photos uploaded → AI generates consistent cartoon avatar
- Optional dancing animation via Veo video generation

### 6. Configuration System

**Admin-Managed Collections**:
- `promptConfigs`: AI prompt templates per phase/level
- `storyTypes`: Story arc templates (adventure, mystery, etc.)
- `storyPhases`: Phase definitions (warmup, beat, ending)
- `storyOutputTypes`: Output formats (picture book, poem)
- `imageStyles`: Art style prompts (watercolor, cartoon)
- `systemConfig/*`: Global settings (diagnostics, prompts)

**Design Principle**: Content configuration is data-driven, allowing non-developers to adjust AI behavior and story options.

---

## Data Flow Diagrams

### Story Creation Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Child     │────▶│  /api/*      │────▶│  Firestore  │
│   (React)   │◀────│  (Genkit)    │◀────│  (NoSQL)    │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Gemini AI   │
                    │  (Text Gen)  │
                    └──────────────┘
```

### Storybook Generation Flow

```
┌──────────┐    ┌───────────┐    ┌───────────┐    ┌──────────┐
│  Story   │───▶│  Pages    │───▶│  Images   │───▶│ Finalize │
│  Text    │    │  API      │    │  API      │    │  API     │
└──────────┘    └───────────┘    └───────────┘    └──────────┘
                     │                │
                     ▼                ▼
               ┌───────────┐   ┌───────────┐
               │  Gemini   │   │  Imagen   │
               │  (Layout) │   │  (Art)    │
               └───────────┘   └───────────┘
```

### Print Order Flow

```
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ Storybook │───▶│  Print    │───▶│   Admin   │───▶│   Mixam   │
│ Finalized │    │  Order    │    │  Approval │    │   API     │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
                                                         │
                                                         ▼
                                                  ┌───────────┐
                                                  │  Webhook  │
                                                  │  Updates  │
                                                  └───────────┘
```

---

## Security Model

### Authentication
- Firebase Auth with email/password
- Parent PIN for child-lock feature (client-side gate)
- Custom claims for role-based access

### Authorization
- Firestore security rules enforce document-level access
- API routes verify auth token and check claims
- Soft delete pattern: `deletedAt` hides from non-admins

### Data Isolation
- Parents only see their own children/stories
- Writers can manage content config but not user data
- Admins have full access for support/debugging

---

## Performance Considerations

### Caching
- System config cached server-side (60s TTL)
- Static assets via CDN (Firebase Hosting)

### Rate Limiting
- AI-intensive endpoints have request limits
- Image generation: 10 req/min
- TTS generation: 20 req/min

### Optimizations
- Images generated at print-ready resolution (300 DPI)
- PDF generation uses streaming for large files
- Firestore queries use composite indexes

---

## Error Handling

### AI Flow Errors
- Logged to `aiFlowLogs` collection
- Rate limit errors trigger retry with backoff
- User-facing errors provide actionable messages

### Order Errors
- Status history tracks all state changes
- Process log captures detailed events
- Admin dashboard shows error details

---

## Monitoring & Diagnostics

### System Config
- `systemConfig/diagnostics` controls logging levels
- Toggle client/server/AI flow logging independently
- API documentation exposed via diagnostic switch

### Tracing
- `aiRunTraces` aggregates all AI calls per session
- Includes token usage, costs, latencies
- Accessible via Admin > Run Traces

---

## Directory Structure

```
/
├── packages/                    # Shared packages (npm workspaces)
│   ├── shared-types/           # TypeScript types for API contracts
│   │   └── src/index.ts        # Child-facing type definitions
│   └── api-client/             # Typed API client for child features
│       └── src/client.ts       # StoryPicClient class
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API route handlers
│   │   ├── admin/             # Admin dashboard pages
│   │   ├── parent/            # Parent-facing pages
│   │   ├── kids/              # Kids PWA pages
│   │   ├── story/             # Story creation pages
│   │   └── storybook/         # Storybook viewing pages
│   ├── components/            # React components
│   │   ├── ui/               # Base UI components (shadcn)
│   │   └── admin/            # Admin-specific components
│   ├── contexts/              # React contexts
│   │   └── api-client-context.tsx  # API client provider
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Shared utilities
│   │   ├── types.ts          # Full TypeScript type definitions
│   │   ├── genkit/           # AI flow definitions
│   │   └── firestore-hooks.ts # Firestore React hooks
│   └── firebase/             # Firebase client setup
└── mobile/                    # (Future) Expo React Native app
```

### Workspace Packages

The project uses npm workspaces to share code between the web app and future mobile clients:

**@storypic/shared-types**: TypeScript type definitions for API contracts
- Child-facing types only (ChildProfile, Story, StoryBookOutput, etc.)
- API request/response types
- Used by both web app and API client

**@storypic/api-client**: Typed HTTP client for child-facing features
- `StoryPicClient` class with methods for story creation, storybook generation
- Used via `ApiClientProvider` context in React components
- Designed for reuse in mobile apps

---

## Key Files Reference

| Purpose | Location |
|---------|----------|
| Type definitions | `src/lib/types.ts` |
| API contract types | `packages/shared-types/src/index.ts` |
| API client | `packages/api-client/src/client.ts` |
| API client context | `src/contexts/api-client-context.tsx` |
| Firestore rules | `firestore.rules` |
| AI flows | `src/ai/flows/*.ts` |
| API routes | `src/app/api/*/route.ts` |
| Admin dashboard | `src/app/admin/page.tsx` |
| Kids PWA layout | `src/app/kids/layout.tsx` |
| Diagnostics hook | `src/hooks/use-diagnostics.tsx` |

---

## Future Considerations

### Planned Enhancements
- **Mobile Clients**: Expo React Native apps for Android and iOS using the API client
- Payment integration for print orders
- Multi-language support
- Collaborative story creation (multiple children)

### Mobile Client Architecture
The `/packages` workspace structure prepares for mobile development:
1. `@storypic/shared-types` - Shared types used by all clients
2. `@storypic/api-client` - HTTP client for child-facing API calls
3. `/mobile` (future) - Expo React Native app sharing the API client

Mobile scope is strictly child-facing: story creation, story reading, storybook generation, storybook viewing. No parent management or print ordering in mobile.

### Technical Debt
- Legacy `storyBooks` collection migration to new nested structure
- Some prompt configs still use old field names
- Test coverage for AI flows needs expansion
- Gradual migration of direct fetch calls in components to use API client

---

## Related Documentation

- [SCHEMA.md](./SCHEMA.md) - Database schema reference
- [API.md](./API.md) - API route documentation
- [CLAUDE.md](../CLAUDE.md) - Development workflow rules
- [CHANGES.md](./CHANGES.md) - Change history by commit
