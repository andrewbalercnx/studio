# Glossary (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Each concept, every name it goes by today, and where. The
> target names are decided in Phase 2; this file only records the current spread.
> Sources: the six area maps in `areas/`.

## Core concepts

| Concept | Names in use | Where |
|---------|--------------|-------|
| **Creation session** (an in-progress conversation with the child) | session, `storySessions`, `StorySession`; "story" | Types, collections. The `/stories` page lists sessions; the `[storyId]` segment in `/story/[storyId]/[sessionId]` actually holds a **generator** id |
| **Creation mode** (wizard, free play, guided, friends, beat) | generator (`storyGenerators`, `generatorId`), `storyMode` (session/story), flow (`flowType` on mobile, `/api/kids-flows`), "kids flow" (`systemConfig/kidsFlows`, key `chat` ≈ generator `beat`), mode (compile flow), `currentPhase` (reused as a mode marker), `storyTypeId` (analytics) | creation-modes §1, §4; config-admin §5 |
| **Narrative template** | storyType (`storyTypes`, `arcTemplate.steps`, ArcStep); storyPhase (`storyPhases`, written, never read); basicPlot (arc flow) | Beat/ending/compile only |
| **One turn of creation** | beat; question; step (`arcStepIndex`, `currentStepIndex`); exchange (gemini3 prompt); phase (friends) | Per mode |
| **Finished story text** | Story, `stories`, `storyText`; finalStory, `gemini3FinalStory`/`gemini4FinalStory`; "compiled story" | `storyId == sessionId` everywhere |
| **Output format** (picture book, poem…) | storyOutputType, `storyOutputTypeId`; "What kind of book?" in the UI; one toast calls it "Story Type" | Not the storybook itself |
| **Storybook** (one rendered edition: pages, art, audio) | `StoryBookOutput`, `stories/{id}/storybooks/{sb}`, storybookV2 (API), `StoryBook` (deprecated alias = `LegacyStoryWithOutput`), `storyBook` (legacy routes), output / `outputs/storybook` (legacy), `StoryOutput` (response shape), book / `bookId` | `bookId` means a **storyId** in `/api/storyBook/[bookId]` and a **storybookId** in `/storybook/[bookId]?storyId=` |
| **Page** | `StoryOutputPage`, `StoryBookPage`, `FlowPage`, `PageWithId`, `StoryBookFinalizedPage` (unused), `PrintStoryBookPage` | |
| **Print edition** (a storybook laid out for print) | printStoryBook (`printStoryBooks`); "printable" (`finalization.printable*` on the storybook); `outputId` on orders (holds a printStoryBook, storybook *or* story id) | Two parallel models, see print-orders §1 |
| **Order** | `printOrders`, `PrintOrder`; status as `fulfillmentStatus` (typed `MixamOrderStatus`) and `mixamStatus` (raw) | |
| **Product / price** | print product (`printProducts`, what Mixam makes); catalog product (`products`, what we sell); price: `pricingTiers.basePrice` (our Mixam **cost**, shown to parents as the price), `estimatedCost`, `prices.amountMinor` (retail, unused) | |
| **Owner** | `parentUid` (sessions, stories, orders), `ownerParentUid` (children, characters), `ownerUserId` (print storybooks, legacy orders) | Three field names for one idea |

## People and things in stories

| Concept | Names in use | Where |
|---------|--------------|-------|
| **Child** | child, `children`, `ChildProfile`; main child, hero, protagonist (`isMainChild`, prompts); sibling (another child in the cast); persona (cookie) | |
| **Character** | character, `characters`; supporting character (`supportingCharacterIds`); friend (friends mode, `type: 'Friend'`); main character (`mainCharacterId`, deprecated); new/introduced character | |
| **Anyone in a story** | actor, entity (`entityIds`, `EntityMap`, `EntityEditor`), cast (comments and prompts only), `presentActors` / `presentActorIds` | |
| **Reference to a cast member in text** | `$$id$$` placeholder; also `$id$` (single-dollar, accepted for 15+ char IDs, and emitted by mistake by `replaceNamesWithPlaceholders`); `$$Name$$` (legacy displayName form) | characters-actors §2 |
| **Avatar** | `avatarUrl` (per child/character, sometimes a random picsum image); actor avatar / cast avatar (one group image per story); dancing avatar / animation | |

## Overloaded terms (one word, several meanings)

| Word | Meanings |
|------|----------|
| **exemplar** | (1) per-storybook character reference sheets (`actorExemplarUrls`, live); (2) `actorExemplars` (deprecated field); (3) `exemplars` collection / `ActorExemplar` (dead flow); (4) image-style scene exemplars (`imageStyles.sceneExemplars`) |
| **placeholder** | (1) the `$$id$$` token; (2) the legacy "My First Child" profile; (3) the picsum stand-in avatar |
| **phase** | `currentPhase` (session progress *and* mode marker), `storyPhases` collection, friends `friendsPhase`, phases in promptConfigs and gemini4 prompts |
| **prompt config** | `promptConfigs` collection (level-band prompts); `StoryTypePromptConfig` (per story type); `StoryGeneratorPromptConfig` (model/temperature, not prompt text); `systemConfig/prompts` (global prefix) |
| **imageDescription** | an entity's appearance description from photos; also a page-level scene description |
| **diagnostics** | `systemConfig/diagnostics` is really the general settings / kill-switch document |
| **bookId** | storyId or storybookId depending on the route |
| **status "in flight"** | spelled `running`, `generating` and `in_progress` in different fields (see `status-audit.md`) |
