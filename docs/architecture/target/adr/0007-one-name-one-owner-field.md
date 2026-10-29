# ADR-0007: One name per concept; one owner field

**Status**: Proposed

## Context

"Storybook" has eight names in code; `bookId` means a story id on some routes and a storybook id
on others; "exemplar" has four meanings; ownership is `parentUid`, `ownerParentUid` or
`ownerUserId` depending on the collection.

## Decision

- The names in `../domain-model.md` are the only names, in types, collections, routes and UI.
  Retired: storybook, output, printable, exemplar, session, generator, outputType.
- Every user-data document has `ownerUid`.
- Route parameters are named for the entity they hold (`storyId`, `manuscriptId`, `bookId`).

## Consequences

- A lint rule and a glossary check in review keep retired names out of new code.
- Renaming happens as each slice is rebuilt, not as a big-bang rename of old code.
