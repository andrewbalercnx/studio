# Config Inventory (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Which data is curated product content that must survive a
> reset of trial data, and how to export it. Details and citations: `areas/config-admin.md`.

**KEEP** = hand-curated, export before any reset. **DERIV** = can be regenerated.
**OPS** = operational state. **USER** = trial user data, wiped. **DEAD** = no runtime reader.

## Keep (exported by `scripts/export-config.mjs`)

| Path | Holds | Seeded by | Storage files it points at |
|------|-------|-----------|----------------------------|
| `promptConfigs` | Warmup/beat prompts by level band, model temperature/tokens | None (manual JSON upload at `/admin/upload`) | – |
| `storyTypes` | Genre/arc templates (arc steps embedded), per-type prompt and model | None | `story-types/{id}/background-music.mp3` |
| `storyGenerators` | Creation modes: prompts, models, styling, `enabledForKids` | `/api/admin/story-generators/seed` (**overwrites prompts**) | `story-generators/{id}/background-music.mp3` |
| `storyOutputTypes` | Output formats, per-type pagination prompt, card image | None | `storyOutputTypes/{id}/…` |
| `imageStyles` | Style prompts, `exampleImages[]`, `sceneExemplars{}` (map field) | `/api/imageStyles/seed` (duplicates styles on every run) | `imageStyles/{id}/examples/` (**hand-uploaded, cannot be regenerated**), `imageStyles/{id}/sample_*`, `sceneExemplars/{style}/{tag}/` |
| `answerAnimations` | CSS keyframes and sound effects | `/api/soundEffects/seed` (upsert) | `animations/{id}/sound-effect.mp3` |
| `helpWizards` | Guided tours | Client batch from `src/data/help-wizards.json` (overwrites) | – |
| `printLayouts` | Print page geometry | Client JSON seed | – |
| `printProducts` | Mixam product specs and pricing tiers | `/api/admin/print-products/seed` | – |
| `products`, `prices` | Commercial catalogue | None | – |
| `storyPhases` | Phase definitions (no runtime reader) | None | – |
| `emailTemplates` | Email templates (if present) | None | – |
| `systemConfig/{prompts, compilePrompt, paginationPrompt, imagePrompt}` | Global prompt fragments | None | – |
| `systemConfig/{email, addresses, voice, mixam, diagnostics}` | Email settings, business addresses, voice-clone script, Mixam payment mode, settings toggles | `diagnostics` only (`/api/admin/system-config/seed`) | – |
| `systemConfig/aiModels` | Model IDs (keep); `availabilityCheck` (OPS, harmless to export) | Auto-seeded on GET | – |
| `systemConfig/{orderTransparency, sceneExemplars, featureFlags}` | Edited in the Firebase console only | None | – |
| `systemConfig/opsHealth` | Thresholds (keep) plus alert/run state (OPS) | None | – |

The script exports the whole `systemConfig` collection except `circuitBreakers` (pure runtime
state). `systemConfig/kidsFlows` is DEAD but exported; it is small and harmless.

## Not exported

| Path | Class |
|------|-------|
| `systemConfig/circuitBreakers` | OPS |
| `aiFlowLogs`, `aiRunTraces`, `devTodos` | OPS (dev todos live in production and are not reset) |
| `tickets`, `feedback`, `users` (+ `voices`, `addresses`), `children`, `characters`, `exemplars`, `storySessions`, `stories` (all subcollections), `storyBooks`, `printStoryBooks`, `printOrders`, `shareLinks`, `entitlementLedgers` | USER |
| `help-*` documents in user collections | Re-created by `/api/admin/help-sample-data` |

There is no curated voices collection: preset voices are hard-coded in `src/lib/tts-config.ts`.

## Storage warning

Exporting documents alone is not enough. Config documents hold download URLs for files in
Firebase Storage (style examples, background music, sound effects, card images). If Storage is
reset, those URLs dangle. The startup scene-exemplar backfill regenerates only entries that are
missing or not `ready`, so a dangling URL marked `ready` is never repaired.

Run the export with `--storage-dir` to download every referenced file; `storage-refs.json` lists
each URL with the document and field it came from.

## Secrets

The script replaces string fields whose names look secret (`apiKey`, `secret`, `password`,
`token`, `privateKey`, `webhookUrl`…) with `"[REDACTED]"` and lists them in `_manifest.json`.
Re-enter those values by hand after a re-seed. Check the output before committing it anyway.
