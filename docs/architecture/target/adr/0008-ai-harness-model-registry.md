# ADR-0008: One AI harness and a model registry by purpose

**Status**: Accepted (owner, 2026-10-29)

## Context

Text flows hard-code their models, so `/admin/ai-models` text settings do nothing. Model choice
also lives in `storyTypes`, `promptConfigs` and `storyGenerators`. Retries, circuit breaking,
tracing and logging are wired per flow; the logging toggles have no effect.

## Decision

- `config/aiModels` maps **purposes** (`creation.text`, `story.finish`, `manuscript.text`, `likeness.describe`,
  `likeness.portrait`, `book.castSheet`, `book.pageArt`, `narration`) to models.
- A CreationMode may override `creation.text` only. Nothing else picks a model.
- Every AI call goes through one harness: resolve model by purpose, call, retry, trace, log
  (honouring the toggles).

## Consequences

- The admin page tells the truth; changing a model takes effect everywhere at once.
- Flow code shrinks to prompt building and output parsing.
