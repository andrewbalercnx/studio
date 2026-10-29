# As-Is: Characters, Children & Actors

> Area map for the architecture rebuild (see `docs/architecture/REVIEW_PLAN.md`).
> Describes the code **as it is on 2026-10-29**. Every claim cites `file:line`.
> Scope: the people and things that appear in stories, their derived AI assets, and how stories
> refer to them. Out of scope (handoffs noted inline): creation-mode conversation logic, storybook
> page/image pipeline internals, print, config/admin, client shells.

---

## 1. Entities and lifecycles

### 1.1 Entity types

| Entity | Collection | Type | Created by | Notes |
|---|---|---|---|---|
| **Child** | `children` | `ChildProfile` (`src/lib/types.ts:1191-1254`) | Parent via `EntityEditor` (client SDK `setDoc`, `src/components/shared/EntityEditor.tsx:506-517`); admin create page (`src/app/admin/create/page.tsx:36`); help sample data (`src/app/api/admin/help-sample-data/route.ts:53`) | The story's protagonist when `session.childId` points at it; other children of the same parent appear as **siblings**. |
| **Character** | `characters` | `Character` (`src/lib/types.ts:1352-1410`) | (a) Parent via `EntityEditor` (`EntityEditor.tsx:482-491`, `isParentGenerated: true`, `usageCount: 0`); (b) AI during a story via `POST /api/characters/create` → `createStoryCharacterFlow` (`src/ai/flows/create-story-character-flow.ts:84-104`, `isParentGenerated: false`, `usageCount: 1`) | `type: 'Family'|'Friend'|'Pet'|'Toy'|'Other'` (`types.ts:1364`); `childId` blank = family-wide, set = child-specific (`types.ts:1394`). AI-created characters are **always** child-specific (`create-story-character-flow.ts:87`). |
| **Actor exemplar** | `exemplars` | `ActorExemplar` (`types.ts:455-469`) | Only `actorExemplarFlow` (`src/ai/flows/actor-exemplar-flow.ts:318-330`) – **dead**, see §6 | Live exemplars are not documents; they are a map on the storybook (`actorExemplarUrls`, `types.ts:526-530`). |
| **Story actor avatar** ("cast" group image) | field on `stories/{id}` | `Story.actorAvatarUrl` + `actorAvatarGeneration` (`types.ts:415-422`) | `storyActorAvatarFlow` (`src/ai/flows/story-actor-avatar-flow.ts`) | One composite image per story. |
| "Placeholder child" | `children` (legacy) | — | Formerly seeded at signup ("My First Child"), no longer created (`src/lib/placeholder-child.ts:1-14`) | Detected by name only (`placeholder-child.ts:17-38`). |

There is no `actors` collection: "actor" is a role (any child or character ID referenced by a
story), resolved by probing both `children` and `characters` with the same ID
(`story-context-builder.ts:521-548`, `story-image-flow.ts:582-612`, `story-exemplar-generation-flow.ts:488-530`).

### 1.2 Creation paths

**Parent-created (child or character)** – `EntityEditor` writes directly with the client SDK:
- New doc ID minted client-side (`EntityEditor.tsx:415`), `photos: []`, and a **placeholder
  avatar `https://picsum.photos/seed/...`** (`EntityEditor.tsx:486` characters, `:512` children).
- Children also get `preferredVoiceId` and `autoReadAloud: true` (`EntityEditor.tsx:513-514`).
- No API route is involved; no server-side validation beyond Firestore rules
  (`firestore.rules:52-62`, `:140-154`).

**AI-created character during a story** – `POST /api/characters/create`
(`src/app/api/characters/create/route.ts:15-70`):
1. Caller must own the session (`route.ts:48`); owner/child come from the session, body values ignored (`route.ts:52-54`).
2. `extractDisplayName` regex-derives a name from the label (`create-story-character-flow.ts:42-59`).
3. `generateCharacterProfile` (Gemini 2.5 Pro, hard-coded, `character-profile-generator.ts:71`) returns pronouns, description, age→`dateOfBirth`, likes, dislikes (`character-profile-generator.ts:88-99`).
4. Character added with Admin SDK, picsum avatar (`create-story-character-flow.ts:97`); **no `id` field written** (contrast `EntityEditor.tsx:484`).
5. Session updated: `supportingCharacterIds: arrayUnion(newId)` (`create-story-character-flow.ts:107-111`). `session.actors` is **not** updated here.
6. Avatar: the flow does not generate one (`create-story-character-flow.ts:113-114`); the **client** fires `/api/generateCharacterAvatar` afterwards (`src/components/story/story-browser.tsx:850-861`; `src/app/story/session/[sessionId]/page.tsx:654-665`).
- Callers: `story-browser.tsx:828` (generator-driven modes) and `story/session/[sessionId]/page.tsx:633` (story-beat mode). Handoff → *creation modes* agent.

**Trait enrichment (story-beat mode only)** – after creating a character the session page calls
`POST /api/characterTraits` → `characterTraitsFlow` (`src/ai/flows/character-traits-flow.ts`, Gemini 2.5 Pro hard-coded at `:115`), which returns `{question, suggestedTraits}` without writing. The **client** then writes `characters/{id}.traits = suggestedTraits` and `session.pendingCharacterTraits` (`src/app/story/session/[sessionId]/page.tsx:588-601`), and later appends the child's answer with `traits: arrayUnion(...)` (`page.tsx:364-368`). `traits` is not in the `Character` type, was migrated away into `likes` (`src/lib/migration/migrate-children-characters.ts:179,195`), and **nothing reads it** — write-only data.

### 1.3 Derived assets and their order

```
photo upload (/api/{children|characters}/photos)
  ├─ Storage: users/{uid}/{children|characters}/{id}/photos/{ts}_{name}
  ├─ sets imageDescriptionGeneration.status=pending, canonicalImageGeneration.status=pending
  ├─ fire-and-forget imageDescriptionFlow   (photos → imageDescription)
  └─ fire-and-forget canonicalImageFlow     (photos [+imageDescription if present] → canonicalImageUrl)
client then appends downloadUrl to doc.photos   ← race; flows wait 1 s and re-read

"Generate avatar" (/api/generateAvatar | /api/generateCharacterAvatar)
  └─ avatarFlow | characterAvatarFlow (photos or profile → avatarUrl, synchronous)
       ├─ fire-and-forget avatarAnimationFlow (avatarUrl → avatarAnimationUrl)
       └─ fire-and-forget imageDescriptionFlow (again)

story compile (/api/storyCompile) → storyActorAvatarFlow (all actors' avatarUrl → story.actorAvatarUrl)
storybook pages (/api/storybookV2/pages) → storyExemplarGenerationFlow
       (per actor: avatarUrl + photos + imageDescription → storybook.actorExemplarUrls[actorId])
storybook images → storyImageFlow (exemplar if present, else avatarUrl + photos; imageDescription text)
```

| Asset | Producer (trigger) | Input | Output field / Storage path | Downstream consumers |
|---|---|---|---|---|
| `photos[]` | `POST /api/children/photos` / `POST /api/characters/photos` (`src/app/api/children/photos/route.ts:61-145`; characters route is a line-for-line copy) then client `updateDoc({photos})` (`EntityEditor.tsx:292-298`; `src/app/parent/children/page.tsx:434-437`) | user file (data URL, ≤8 MB, `route.ts:17,81`) | `users/{uid}/children/{id}/photos/…` (`route.ts:102`); characters `users/{uid}/characters/{id}/photos/…` | all flows below; story-image fallback refs |
| `imageDescription` | `imageDescriptionFlow` (`src/ai/flows/image-description-flow.ts:70-235`). Triggers: photo upload (`children/photos/route.ts:131`), photo removal in EntityEditor via `/api/regenerate-image-description` (`EntityEditor.tsx:321-333`), every avatar generation (`avatar-flow.ts:259`, `character-avatar-flow.ts:267`) | `entity.photos.slice(0,3)` (`image-description-flow.ts:89,137`) | `imageDescription` on entity (`:226-232`) | canonical prompt (`canonical-image-flow.ts:110-114`), exemplar prompt (`story-exemplar-generation-flow.ts:149-154`), page-image actor JSON (`story-image-flow.ts:378,397,503-504`), page-flow prompts (`story-page-flow.ts:209,361`) |
| `canonicalImageUrl` | `canonicalImageFlow` (`src/ai/flows/canonical-image-flow.ts:135-282`). Trigger: photo upload only (`children/photos/route.ts:135`) | `entity.photos.slice(0,5)` + text (`:158,195-213`) | `canonicals/{uid}/{entityId}/portrait.{ext}` (`:88`) | **Only** `actorExemplarFlow` (`actor-exemplar-flow.ts:344-349`), which has no caller → **no live consumer** |
| `avatarUrl` | `avatarFlow` (`src/ai/flows/avatar-flow.ts:114-264`), `characterAvatarFlow` (`src/ai/flows/character-avatar-flow.ts:113-273`); also manual "Set as Avatar" = raw photo (`parent/children/page.tsx:447-462`); initial value = picsum placeholder | photos (≤3) or profile text, plus optional feedback | `users/{uid}/children/{id}/avatars/avatar-{ts}.png` (`avatar-flow.ts:94`); flow writes the field itself (`avatar-flow.ts:246-251`, `character-avatar-flow.ts:246-249`) | UI everywhere; animation input; group avatar (`story-context-builder.ts:661-662`); exemplar refs (`story-exemplar-generation-flow.ts:244`); page-image fallback refs (`story-image-flow.ts:381-382,589-590`) |
| `avatarAnimationUrl` | `avatarAnimationFlow` (`src/ai/flows/avatar-animation-flow.ts:202-680`). Triggers: after avatar (`avatar-flow.ts:254`; characters only if they have photos, `character-avatar-flow.ts:251-264`); manual regenerate `POST /api/generateAvatar/animation` (`parent/children/page.tsx:205-211`) | `avatarUrl` | children `users/{uid}/children/{id}/animations/…`; characters `characters/{id}/animations/…` (`avatar-animation-flow.ts:180-182`) | "generating" screens and child UI (`src/components/child/child-avatar-animation.tsx`, `src/app/*/generating/page.tsx`, `story-card.tsx`) |
| `story.actorAvatarUrl` | `storyActorAvatarFlow`; triggers: `/api/storyCompile` background (`src/app/api/storyCompile/route.ts:203-209`), `/api/storyBook/actorAvatar` (`src/app/child/[childId]/stories/page.tsx:261`) | each actor's `avatarUrl` only (`story-context-builder.ts:661-662`) | `stories/{storyId}/actor-avatar-{ts}.png` (`story-actor-avatar-flow.ts:63`) | story cards / readers (`story-card.tsx`, `kids/stories/page.tsx`, read pages) |
| `storybook.actorExemplarUrls` | `storyExemplarGenerationFlow` (handoff → *storybook pipeline* agent); trigger `/api/storybookV2/pages` (`src/app/api/storybookV2/pages/route.ts:149,232`) | `avatarUrl` + `photos.slice(0,3)` + `imageDescription` (`story-exemplar-generation-flow.ts:242-245`) — **not** canonical | `stories/{storyId}/exemplars/{actorId}.{ext}` (`:105`) | `storyImageFlow` (`src/app/api/storybookV2/images/route.ts:292-346,467-488`) |

**Animation provider chain** (`avatar-animation-flow.ts`): fal.ai Kling image-to-video if `FAL_KEY` (`:299-411`) → Veo 2 REST only when **no** `FAL_KEY` (`:417`) → static "dance pose" PNG via the image model (`:569-650`). The field name `avatarAnimationUrl` therefore holds either an MP4 or a PNG; UI sniffs the URL (`parent/children/page.tsx:243-249`). Writes an undeclared `avatarAnimationGeneration.generatedWith` (`:551`, `:645`).

### 1.4 CLAUDE.md original-photo rule — does it hold?

- **Holds for `imageDescriptionFlow`**: it reads only `entity.photos` (`image-description-flow.ts:89,101,137`).
- But the *pipeline intent* in CLAUDE.md ("canonicalImageFlow → actorExemplarFlow serves visual consistency") is **not what runs**: the live exemplar path (`story-exemplar-generation-flow.ts:242-245`) uses `avatarUrl` + raw photos and never `canonicalImageUrl`; `actorExemplarFlow` lost its last caller when `src/app/api/storybookV2/exemplars/route.ts` was deleted in commit `69522a2` (2026-10-28). Canonical portraits are generated and stored for every photo upload and then never read.
- `canonicalImageFlow` *consumes* `imageDescription` (`canonical-image-flow.ts:110-114`) while running concurrently with the flow that produces it (`children/photos/route.ts:131-137`), so whether the description is included is timing-dependent (and may be the previous photo set's description).

---

## 2. How stories reference their cast

| Field | Where | Written by | Read by | Notes |
|---|---|---|---|---|
| `storySessions.childId` | `types.ts:192` | session creation (creation-modes area) | everything; always forced into `story.actors[0]` (`story-compile-flow.ts:192,321,434`) | The protagonist. |
| `storySessions.mainCharacterId` | `types.ts:211` | **only** regression test (`src/app/admin/regression/page.tsx:1728`) | `story-context-builder.ts:170-173,197-201` ("deprecated - kept for backward compatibility"), gemini3/ending/wizard/beat flows pass it through | Effectively dead. |
| `storySessions.supportingCharacterIds` | `types.ts:212` | `createStoryCharacterFlow` (`create-story-character-flow.ts:109`); friends confirm (`friends-flow.ts:1144`) | `buildStoryContext` (`story-context-builder.ts:212-222,249-251`) via story-beat flow (`story-beat-flow.ts:98-99`) | Not consulted at compile → not copied into `story.actors`. |
| `storySessions.actors` | `types.ts:224-226` | client `arrayUnion` of IDs scraped from AI text (`story-browser.tsx:435,480-484`); friends confirm (`friends-flow.ts:1145`) | compile (`story-compile-flow.ts:190,319,431`; `story-text-compile-flow.ts:180,419`); session page (`story/session/[sessionId]/page.tsx:1005`) | Never written in story-beat mode (`story/session/[sessionId]/page.tsx`) → that mode relies on text extraction. Client-side derivation contradicts the server-first rule. |
| `friendsProposedCharacterIds` / `friendsSelectedCharacterIds` | `types.ts:246-248` | `friends-flow.ts` | `friends-flow.ts:1134` | Third copy of the same list in friends mode (`selected`, `supportingCharacterIds`, `actors` all written together, `friends-flow.ts:1142-1146`). |
| `storySessions.worldState.presentActorIds` | `types.ts:185-188,227-228` | story-beat flow from structured output (`story-beat-flow.ts:536-543`) | next beat prompt (`story-beat-prompt-builder.ts:64,194-201`) | Story-beat mode only. |
| `ChatMessage.scene.presentActors` | `types.ts:164` | beat output schema (`src/lib/schemas/story-beat-output.ts:27`) | text compile scene annotations (`story-text-compile-flow.ts:199`) | Plain IDs, no `$$`. |
| `pendingCharacterTraits` | `types.ts:213-218` | client (`story/session/[sessionId]/page.tsx:595`) | same page | |
| `stories.actors` | `types.ts:410-411` | compile flows (`story-compile-flow.ts:234,357,484,612,650`; `story-text-compile-flow.ts:435`) = `[childId, …session.actors ∪ extractEntityIds(text) ∪ scene annotations]` | pagination (`story-pagination-flow.ts:169`), exemplars (`story-exemplar-generation-flow.ts:415`), group avatar (`story-actor-avatar-flow.ts:129`), audio (`story-audio-flow.ts:145`), `/api/stories` (`src/app/api/stories/route.ts:77`), usage counts (`story-compile-flow.ts:253,376,496,625`) | The canonical story cast. Falls back to text extraction where empty (`story-exemplar-generation-flow.ts:417-421`, `story-actor-avatar-flow.ts:131-135`). |
| `stories.metadata.characterIds` | `types.ts:381` | nobody | nobody | Dead type field. |
| page `entityIds` | `types.ts:715` | pagination (`story-pagination-flow.ts:476`) | image flow (`story-image-flow.ts:1504`) | Per-page cast. |
| page `imageScene.actors[]` | `types.ts:173-183` | pagination / page flow; repaired by `image-scene-repair.ts:83-135` | image flow (`story-image-flow.ts:791-792,1626`) | Plain IDs; must equal page actors (`story-pagination-flow.ts:293`). |
| `storybook.actorExemplarUrls` / deprecated `actorExemplars` | `types.ts:522-530` | exemplar flow | image route | Keyed by actor ID. |
| `$$id$$` placeholders in text | story text, synopsis, page text/imagePrompt, message text | AI (instructed in `build-story-system-message.ts:133`, `story-context-builder.ts:25`) and `replaceNamesWithPlaceholders` (page editor, `src/components/storybook/page-editor-dialog.tsx:114-117,162`) | resolvers below | Single-`$` form `$<15+ chars>$` accepted as "AI fallback" everywhere. |

**Placeholder resolution implementations** (all do "ID in characters → ID in children → displayName in characters → displayName in children"):

| Implementation | SDK | Used by |
|---|---|---|
| `src/lib/resolve-placeholders.server.ts:15-87` (`resolveEntitiesInText`, `replacePlaceholdersInText`, `replacePlaceholdersWithDescriptions`, `replacePlaceholdersForTTS`, `extractEntityMetadataFromText`, `buildActorDescriptionsForAudio`) | Admin | ~15 flows/routes (gemini3/4, beat, ending, wizard, friends, compile, pagination, title, audio, `/api/stories*`, `/api/tts`, share) |
| `src/lib/resolve-placeholders.ts:13-80` (+ `src/hooks/use-resolve-placeholders.ts`) | Client | `story-card.tsx:7`, `story/session/[sessionId]/compiled/page.tsx:16` |
| `story-image-flow.ts:548-650` (`fetchEntityReferenceData`) | Admin | page images |
| `story-context-builder.ts:513-560` (`loadActorsFromIds`) | Admin | group avatar, image flow |

**ID-extraction regex copies**: canonical `extractEntityIds` (`src/lib/entity-utils.ts:2-10`, `[a-zA-Z0-9_-]+`); re-implemented in `story-exemplar-generation-flow.ts:25-36` (`[^$]+`), `story-browser.tsx:66-80`, `story-synopsis-flow.ts:45`, and inline in every function of `resolve-placeholders.server.ts` (`:95-96,123-125,212-213,233-234`, `[^$]+`). The two character classes disagree (`[^$]+` accepts names with spaces, which feeds the displayName fallback).

---

## 3. Status fields

All generation sub-objects share the shape `{status, lastRunAt, lastCompletedAt, lastErrorMessage}` with declared values `'idle'|'pending'|'generating'|'ready'|'error'`.

| Field (doc) | Setters → value | Observed transitions | Issues |
|---|---|---|---|
| `imageDescriptionGeneration` (children, characters) | photos routes → `pending` (`children/photos/route.ts:126`); regen route → `pending` (`regenerate-image-description/route.ts:53-56`); flow → `generating` (`image-description-flow.ts:128-132`), `ready` (`:226-232`), `error` (`:146-150,206-210,217-221`), `idle` when no photos (`:109-114`) | pending→generating→ready/error; any→idle | Avatar flows invoke the flow without setting `pending`. `idle` doubles as "no photos" and "never run". |
| `canonicalImageGeneration` (children, characters) | photos routes → `pending` (`:127`); flow → `generating` (`canonical-image-flow.ts:188-192`), `ready` (`:252-258`), `error` (`:203-207,236-240,272-276`), `idle` no photos (`:171-176`) | same | Not re-run on photo removal (stale canonical). Error at `:238` stores raw model text, not user-safe. Status maintained for an asset nothing consumes. |
| `avatarAnimationGeneration` (children, characters) | avatar flows → `pending` (`avatar-flow.ts:250`, `character-avatar-flow.ts:257-259`); animation flow → `generating` (`avatar-animation-flow.ts:245-246`), `ready` (`:387-389,546-551,640-646`), `error` (`:670-673`) | pending→generating→ready/error; short-circuits when `ready` unless `forceRegenerate` (`:234-235`) | Extra undeclared key `generatedWith` (`fal`/`veo`/`imagen-fallback`). `ready` may mean a static PNG. Error branch omits `updatedAt`. |
| *(none for avatar)* | — | `avatarUrl` written synchronously | No `avatarGeneration` status; UI holds loading state locally (`EntityEditor.tsx:345-374`). |
| `stories.actorAvatarGeneration` | `generating` (`story-actor-avatar-flow.ts:124`), `ready` (`:261`), `error` (`:277`); dedupe on in-flight `generating` with timeout (`:111-119`) | — | `idle`/`pending` declared, never written by this flow. |
| `exemplars/{id}.status` | `generating` on create (`actor-exemplar-flow.ts:325`), `ready` (`:434-439`), `error` (`:467-470`) | — | Dead path; `pending` never used. |
| `storybook.exemplarGeneration.status` (pipeline-owned) | `pending` (`storybookV2/pages/route.ts:140,220`), `running` (`story-exemplar-generation-flow.ts:476`), `ready` (`:360,464,553`), `error` | — | Uses `running` whereas every entity-level status uses `generating` (`types.ts:475`). |

---

## 4. Terminology

| Term | Meaning in code | Synonyms / overlapping uses (where) |
|---|---|---|
| **child** | `ChildProfile` doc; protagonist when equal to `session.childId` | "main child" (`story-image-flow.ts:437`, `ActorInfo.isMainChild` `story-context-builder.ts:299`), "hero" (prompts: `build-story-system-message.ts:42`, `story-text-compile-flow.ts:177`), "CHILD PROFILE (Main Subject of Story)" (`story-context-builder.ts:254`), `actorType:'child'` |
| **sibling** | another `children` doc of the same parent in the cast | `ActorInfo.type:'sibling'` (`story-context-builder.ts:294`), `ActorData.type` (`story-image-flow.ts:344`), `FriendsCharacterOption.type` (`types.ts:2177`); in the DB it is just a child |
| **character** | `Character` doc | "supporting character" (`supportingCharacterIds`, context header `story-context-builder.ts:260`), "friend" (product name "Fun with my friends"; also `type:'Friend'`; `friendsSelectedCharacterIds` includes children), "main character" (`mainCharacterId`, deprecated), "new character" / "introduced character" (`introducesCharacter`, `newlyIntroducedCharacters`) |
| **actor** | any child or character ID appearing in a story | `entity` (`entityIds`, `entityId`, `EntityMap`, `EntityEditor`, `entityType` in flows), `cast` (prompts/comments only: `story-actor-avatar-flow.ts:191`, `friends-flow.ts:416`), `presentActors`/`presentActorIds`, `actorType` |
| **avatar** | entity `avatarUrl` (cartoon head, or raw photo, or picsum placeholder) | "actor avatar" = story-level group image (`actorAvatarUrl`), "cast avatar" (`story-browser.tsx` comments), "dancing avatar"/"animation" |
| **exemplar** | per-actor character reference sheet in a book's art style | "reference sheet", "character sheet"; also **scene exemplars** for image styles (`style-scene-exemplar-flow.ts`, unrelated); `exemplars` collection vs `actorExemplarUrls` map |
| **canonical** | `canonicalImageUrl` naturalistic portrait | Also used for unrelated "canonical" location descriptions (`locationRegistry`, `types.ts:412`) and "canonical implementation" comments |
| **imageDescription** | entity physical-appearance text | Same field name on **pages** meaning the scene description (`types.ts:716`, `story-page-flow.ts:41,173`) |
| **description** | parent-entered free text on entity | — |
| **traits** | write-only `characters.traits` (§1.2) | replaced by `likes` in the type (`types.ts:1371`); "preferences" = likes/dislikes summary (`src/lib/child-preferences.ts:17-60`) |
| **placeholder** | (a) `$$id$$` token; (b) "placeholder child" legacy profile; (c) picsum placeholder avatar | three unrelated meanings |
| **type** | character kind (`Family`…) | also `ActorInfo.type` mixes `'child'|'sibling'` with character kinds (`story-context-builder.ts:294`) |

---

## 5. Collections touched

| Collection / store | Reads | Writes |
|---|---|---|
| `children` | **Admin SDK**: entity flows (description/canonical/avatar/animation), `buildStoryContext` (`story-context-builder.ts:177`), friends (`friends-flow.ts:409-412`), resolvers, image/exemplar/page/synopsis flows, `GET /api/children` and `/api/children/[childId]` (mobile, `mobile/src/contexts/ApiClientContext.tsx:77-81`), `route-auth.server.ts`. **Client SDK**: ~35 pages incl. `parent/children` (`page.tsx:560`), kids/*, story/*, `use-app-context.tsx`, `resolve-placeholders.ts` | **Client SDK**: `EntityEditor` (create/update/photos/avatar), `parent/children` (photos, set-avatar, voice, autoRead, soft delete `:648-666`), `speech-mode-toggle.tsx:43`, `story-browser.tsx:258` (`musicEnabled`), admin pages (`admin/children/page.tsx:79` re-parenting, `admin/create/page.tsx:36`). **Admin SDK**: photos route (status only), all entity flows |
| `characters` | Admin: same flows + `character-traits-flow.ts:48`, `story-page-flow.ts:535,565`, `story-synopsis-flow.ts:127`, cross-tenant displayName lookups (§6). Client: `parent/characters` (`page.tsx:73`), `admin/characters`, `view-as-parent`, `story-browser`, `storybook/[bookId]/page.tsx:197-229`, resolvers | Client: `EntityEditor`, `parent/characters` soft delete (`page.tsx:158-176`), session page `traits` (`story/session/[sessionId]/page.tsx:364-368,588-591`), `admin/characters/page.tsx:92` (sample data). Admin: `createStoryCharacterFlow`, `updateCharacterUsage` (`src/lib/character-usage.ts:28-34`), photos route, entity flows, help sample data |
| `storySessions` (cast fields only) | `buildStoryContext`, compile flows, friends | Admin: `create-story-character-flow.ts:108`, `friends-flow.ts:1142`, `story-beat-flow.ts:542`. Client: `story-browser.tsx:481` (`actors`), session page (`pendingCharacterTraits`) |
| `stories` (cast fields) | pipeline flows, `/api/stories*` | Admin: compile flows (`actors`), `storyActorAvatarFlow` (`actorAvatarUrl`, status) |
| `stories/{id}/storybooks` (cast fields) | image route | exemplar flow (`actorExemplarUrls`, `exemplarGeneration`) |
| `exemplars` | `actor-exemplar-flow.ts:289-295` only | `actor-exemplar-flow.ts:318-330,434,467` only → **dead** |
| Storage | — | `users/{uid}/children/{id}/photos|avatars|animations`, `users/{uid}/characters/{id}/photos`, `characters/{id}/animations` (not under `users/`), `canonicals/{uid}/{id}/portrait.*`, `exemplars/{uid}/{exemplarId}/image.*` (dead), `stories/{id}/exemplars/{actorId}.*`, `stories/{id}/actor-avatar-*.png`. Storage rules cover only `users/*/children/*/photos` and `stories/**` (`storage.rules:30,39`); all URLs are token URLs. `/api/admin/cleanup-exemplars` deletes only `stories/*/exemplars/` (`cleanup-exemplars/route.ts:21-24`) |

Security rules: parents CRUD own `children`/`characters`; `get`/`list` additionally require `notDeleted()` (`firestore.rules:34-36,53-55,66-67,141-147`). Parent pages also filter `!deletedAt` client-side (`parent/children/page.tsx:674`, `parent/characters/page.tsx:181,186`) on queries that do not constrain `deletedAt` — worth emulator-verifying that these list queries are not rejected once any doc is soft-deleted.

---

## 6. Live vs dead; bugs and inconsistencies

### 6.1 Live paths (evidence)
- Photo upload routes ← `useUploadFile` (`src/firebase/storage/use-upload-file.tsx`) ← `EntityEditor` and `ManagePhotos` (`parent/children/page.tsx:406`).
- `/api/generateAvatar` ← `EntityEditor.tsx:351` and `AvatarGenerator` (`parent/children/page.tsx:160`); `/api/generateCharacterAvatar` ← `EntityEditor`, `story-browser.tsx:852`, session page `:657`.
- `/api/generateAvatar/animation` ← `parent/children/page.tsx:205` only (no character UI).
- `/api/regenerate-image-description` ← `EntityEditor.tsx:321` only.
- `/api/characters/create`, `/api/characterTraits` ← see §1.2.
- `storyExemplarGenerationFlow`, `storyActorAvatarFlow` ← §1.3.

### 6.2 Dead / delete candidates
| Item | Evidence |
|---|---|
| `src/ai/flows/actor-exemplar-flow.ts` | No importer in `src/` (only `ai-model-usage-map.ts:14` lists it by name); last caller deleted in `69522a2`. |
| `exemplars` collection + `ActorExemplar` type + SCHEMA section (`docs/SCHEMA.md:819-840`) + Storage `exemplars/{uid}/…` | Written/read only by the dead flow. |
| `canonical-image-flow.ts`, `canonicalImageUrl`, `canonicalImageGeneration`, `canonicals/` Storage, regression checks `DATA_CHILDREN_CANONICAL` (`admin/regression/page.tsx:757-763,2237-2277`) | Produced on every upload, consumed only by the dead flow. (Either delete, or wire into the live exemplar flow — a redesign decision.) |
| `gemini4CreateCharacterFlow` alias and `action==='createCharacter'` branch in `/api/gemini4` (`create-story-character-flow.ts:137-138`, `src/app/api/gemini4/route.ts:55-85`) | No client sends `createCharacter`. |
| `StorySession.mainCharacterId` and its plumbing | Only the regression test writes it. |
| `Story.metadata.characterIds` | No reader/writer. |
| `characters.traits` / `traitsLastUpdatedAt` writes and the traits Q&A (`characterTraitsFlow`) | Write-only data (§1.2). |
| `StoryBookOutput.actorExemplars` | Marked `@deprecated` (`types.ts:522-524`). |
| `PreferenceInput` in `parent/children/page.tsx:67` | Defined, never rendered. |
| `'role' in` / `'favouriteGenres' in` checks in `resolve-placeholders.server.ts:103,219,239` | Fields no longer exist (see bugs). |
| Duplicate photo/avatar UI: `ManagePhotos` + `AvatarGenerator` vs `EntityEditor` for children | Two live UIs with different side-effects. |

### 6.3 Bugs and inconsistencies
1. **Picsum placeholder avatars are used as identity references.** Every new entity gets `avatarUrl = picsum.photos/...` (`EntityEditor.tsx:486,512`; `create-story-character-flow.ts:97`). Downstream code treats any `avatarUrl` as a real likeness: exemplar refs (`story-exemplar-generation-flow.ts:244`), page-image refs (`story-image-flow.ts:381-382,589-590,610`), group avatar (`story-context-builder.ts:661-662`), animation. A random stock photo is fed to the image model as "this is the character".
2. **Canonical/exemplar design not implemented** (§1.4): live exemplars ignore canonical; CLAUDE.md and `docs/SCHEMA.md` describe a pipeline that does not run.
3. **Cross-tenant displayName fallback with Admin SDK.** Unresolved placeholder IDs are looked up by `displayName` across *all* parents' `characters`/`children` with no `ownerParentUid` filter (`resolve-placeholders.server.ts:58-83`; `story-image-flow.ts:620-646`). In the image flow the matched entity's **photos** are added as references (`:640-646`) — another family's child photos can enter a prompt. The client resolver does the same query (`resolve-placeholders.ts:55,70`), which rules will reject for non-owned docs.
4. **`replaceNamesWithPlaceholders` emits single-dollar tokens.** `result.replace(regex, \`$$${actor.id}$$\`)` (`src/lib/replace-names-with-placeholders.ts:59`) — in a replacement string `$$` means a literal `$`, so `"Nymira"` becomes `$abc…$`, not `$$abc…$$` (verified with node). Works only because downstream accepts the ≥15-char single-dollar fallback; IDs shorter than 15 chars would be lost.
5. **Dead type guards in resolver**: `'role' in entity.document` (`resolve-placeholders.server.ts:103,239`) is never true (Character has `type`, not `role`), so `replacePlaceholdersWithDescriptions` never adds descriptions and `getEntitiesInText` always returns `[]`; `'favouriteGenres'` (`:219`) is a legacy field, so every entity with a `type` field is classed "character" (works by accident).
6. **Photo-upload race and fire-and-forget**: the route stores the file but does not add it to `photos`; the client does that after the response (`EntityEditor.tsx:292-298`). Both flows read `photos` immediately and rely on a 1 s retry (`image-description-flow.ts:95-104`, `canonical-image-flow.ts:161-168`); on a second upload they may describe the previous set. Flows are un-awaited promises in a request handler (`children/photos/route.ts:131-137`, also `avatar-flow.ts:254-261`, regen route `:59-61`) and can be cut off on serverless instance freeze.
7. **Inconsistent re-derivation on photo change**: EntityEditor removal re-runs description only (`EntityEditor.tsx:321`), not canonical; `ManagePhotos` removal re-runs nothing (`parent/children/page.tsx:464-481`); "Set as Avatar" with a raw photo doesn't trigger animation; avatar generation re-runs description although photos didn't change.
8. **Avatar "accept" step is cosmetic**: `avatarFlow`/`characterAvatarFlow` already persist `avatarUrl` (`avatar-flow.ts:246-251`), so the client "Accept" (`EntityEditor.tsx:377-393`; `parent/children/page.tsx:184-189`) only re-writes the same value; rejecting a generated avatar is impossible.
9. **Character scope cannot be reverted to family-wide**: on edit, `childId` is only added when not family-wide (`EntityEditor.tsx:467-470`) and `updateDoc` leaves the old value (`:479-480`).
10. **Usage counts**: `updateCharacterUsage` batches `update()` for every non-main-child actor (`character-usage.ts:21-34`); a sibling ID (a `children` doc) makes the whole batch fail (NOT_FOUND) and the error is swallowed (`:38-41`) → no counts for stories with siblings. AI-created characters start at `usageCount: 1` (`create-story-character-flow.ts:100`) and are incremented again at compile → double count. Counts drive cast selection (`story-context-builder.ts:46-58`).
11. **Cast lists disagree**: `supportingCharacterIds` (context) vs `session.actors` (compile) vs `friendsSelectedCharacterIds`; AI-created characters in story-beat mode land in `supportingCharacterIds` only and reach `story.actors` only if the AI writes their `$$id$$` into text. `session.actors` is derived on the client by scraping text (`story-browser.tsx:435-484`), against the server-first principle.
12. **Hard-coded models vs config map**: `image-description-flow.ts:177`, `character-traits-flow.ts:115`, `character-profile-generator.ts:71` hard-code Gemini models while `src/lib/ai-model-usage-map.ts:26-35` and `docs/SYSTEM_DESIGN.md:244` claim they follow `primaryTextModel` / `lightweightTextModel`; `canonical-image-flow.ts` is missing from the map.
13. **API leaks/inconsistencies**: `GET /api/children` returns soft-deleted children and internal fields (`imageDescription`, documented as "not exposed to parents", `types.ts:1208-1209`) (`src/app/api/children/route.ts:22-30`); no equivalent `GET /api/characters` for mobile. `/api/generateAvatar/animation` returns raw `debugInfo` and non-user-safe error text (`route.ts:27-31,43-46`); `/api/characters/create` echoes raw `e.message` (`route.ts:74-78`). `useUploadFile` reports every upload failure as a `FirestorePermissionError` (`use-upload-file.tsx:47-66`).
14. **Duplicate code**: the two photo routes are copy-paste (diff shows only names), the five image flows each re-implement `fetchImageAsDataUri`/`parseDataUrl`/upload helpers, avatar vs character-avatar flows are near-duplicates, and there are ≥5 placeholder-extraction regex copies (§2).
15. **Naming/storage inconsistency**: character animations stored at `characters/{id}/animations` (not under `users/{uid}`), AI-created characters lack the `id` field that parent-created ones have, `ActorExemplar.status` and `exemplarGeneration` use different vocabularies (`generating` vs `running`).

---

## Observations for the redesign

- Treat "actor" as a first-class concept (one `actors`/`cast` model or a typed ref `{kind:'child'|'character', id}`), so code stops probing two collections by bare ID and stops falling back to displayName.
- Make the derived-asset chain explicit and server-owned: a single "entity media changed" job that (re)derives description, reference portrait and avatar in a defined order, with one status vocabulary, idempotent, triggered by the server write of `photos` (not by the client after upload).
- Decide the reference-image contract (original photos / canonical / avatar / exemplar) and remove the picsum placeholder from `avatarUrl` (store "no avatar" as absent).
- Store one cast list per session and per story, with placeholders as structured refs rather than text tokens; keep a single extraction/resolution library scoped by owner.
- Delete the dead exemplar collection path and either wire canonical portraits in or remove them.
