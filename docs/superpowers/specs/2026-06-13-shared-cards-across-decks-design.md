# Shared Cards Across Penpot Decks

## Status
Draft

## Context
CardForge currently stores `cardsData` on the active Penpot page. That means one page equals one isolated deck, and cards cannot be shared cleanly between two pages in the same file.

The requested behavior is:

- Two Penpot pages should be able to use the same logical cards.
- A deck should be able to inherit cards from another deck and then add more cards.
- Shared cards should stay identical across decks unless the user explicitly forks them.
- A deck may add page-local fields to a referenced card without changing the shared library.

## Decision
Use a two-level model:

- file-level shared card library
- page-level deck manifest with card references

Cards are stored once per Penpot file. Each deck page stores ordered card reference objects. A reference points to a shared card and may carry page-local field extensions. If a user needs a shared card definition change, they must fork the card into a new record.

This is the recommended design because it preserves a single source of truth for cards while keeping deck composition page-local.

## Goals

- Allow multiple pages in the same Penpot file to reference the same card records.
- Keep card content synchronized across all decks that use the same card ID.
- Let one deck be copied or taken over from another deck without duplicating card definitions.
- Allow a deck to be extended after takeover by appending additional cards.
- Allow a deck to add page-local fields to a referenced card.
- Preserve the current front/back rendering pipeline and export modes.
- Migrate existing single-page `cardsData` automatically.

## Non-goals

- Cross-file card sharing.
- A full global asset library outside the current Penpot file.
- Complex per-field merge tooling.
- Automatic reconciliation of incompatible card templates beyond clear validation and warnings.

## Current State

Today the plugin stores card values in page plugin data through `cardsData`:

- `src/plugin.ts` reads and writes `penpot.currentPage.getPluginData("cardsData")`
- `src/main.ts` keeps the UI state in a single `cardsData: any[]`
- `forge-cards` resolves values directly from that page-local array

That model works for one deck per page, but it cannot express shared cards across pages.

## Proposed Architecture

### 1. Shared Card Library

Store the canonical card records in `penpot.currentFile`.

Responsibilities:

- hold all card definitions for the file
- assign stable card IDs
- keep card field values independent from any specific deck
- track optional ancestry for explicit forks

Suggested shape:

```json
{
  "version": 1,
  "cardsById": {
    "card_123": {
      "id": "card_123",
      "name": "Goblin",
      "fields": {
        "#name": "Goblin",
        "#power": "2"
      },
      "forkedFromCardId": null,
      "createdAt": "2026-06-13T10:00:00.000Z",
      "updatedAt": "2026-06-13T10:00:00.000Z"
    }
  }
}
```

### 2. Deck Manifest Per Page

Store the deck composition in `penpot.currentPage`.

Responsibilities:

- identify the deck
- preserve the deck-specific card order
- reference shared cards by ID through reference objects
- store page-local field extensions on the reference object
- record the deck template signature used for compatibility checks

Suggested shape:

```json
{
  "version": 1,
  "deckId": "deck_a",
  "templateSignature": "front:name,text|front:power,text|back:name,text|front:#deckOnly,text",
  "cardRefs": [
    {
      "refId": "ref_1",
      "cardId": "card_123",
      "fieldExtensions": [
        {
          "id": "page_extra_1",
          "name": "#deckOnly",
          "type": "text"
        }
      ]
    },
    {
      "refId": "ref_2",
      "cardId": "card_456",
      "fieldExtensions": []
    }
  ]
}
```

### 3. Resolver Layer

Introduce a small resolver layer in the plugin logic:

- load file library
- load current page manifest
- resolve `cardRefs` into actual card records
- validate that the current page template matches the stored signature

This layer stays separate from rendering so the data model can evolve without rewriting the export pipeline.

## Data Model Rules

- `cardId` is stable and never reused for a different logical card.
- Cards are shared by reference, not copied into each deck.
- Deck ordering lives only in the page manifest.
- Page-local field extensions live on the reference object, not in the file library.
- A card may be referenced by more than one deck.
- Deleting a card from a deck removes only that deck reference.
- A card is removed from the file library only when no deck references it anymore.

## Template Compatibility

Shared cards only make sense when decks use a compatible card template.

Compatibility is defined by the card field schema collected from the front and back boards:

- field name
- field type
- field order
- board side

The exact geometry of the template does not matter for the shared-data model. What matters is that the renderer can still map the card values to matching fields.

Template compatibility is computed from the merged schema:

- shared base card fields from the file library
- page-local field extensions from the reference object

The plugin must:

- compute a template signature from the current page template
- store that signature in the deck manifest
- compare the stored signature with the current template on load and forge
- warn or block if the template no longer matches

If a user wants to reuse card content in a different template, that is a separate explicit fork or remap action.

## User Flows

### Create a New Deck

1. Create the page boards as today.
2. Initialize a new deck manifest for the page.
3. Do not create any card records until the user adds the first card.

### Add a Card

1. Create a new card record in the file library.
2. Assign a stable card ID.
3. Append a new card reference object to the current page manifest.
4. Render the card in the current deck.

### Add a Page-Local Field to a Card Reference

1. Read the selected reference object from the current page manifest.
2. Append the new field definition to that reference's `fieldExtensions`.
3. Recompute the page template signature from the merged schema.
4. Save only the page manifest.

### Copy or Take Over a Deck

1. Read the source page manifest.
2. Create a new page manifest with the same ordered list of `cardRefs`.
3. Keep the existing file-level card records unchanged.
4. Preserve each reference object's local field extensions.
5. Let the user append additional cards afterward.

This is the main path for "deck takeover".

### Import Cards From Another Deck

If the user wants to extend an existing deck from another deck, the plugin can append the source page's `cardRefs` to the current page manifest.

This should preserve the source order and reference the same shared cards.
If the source references contain page-local field extensions, append those too.

### Fork a Card

1. Duplicate the shared card data into a new card record.
2. Assign a new `cardId`.
3. Set `forkedFromCardId` to the original card.
4. Replace the selected deck reference with the new card ID.

Forking must be explicit. The plugin must not silently branch shared cards.

### Remove a Card From a Deck

1. Remove the card reference object from the current page manifest.
2. Recompute whether any page still references the card.
3. Delete the library record only if it has no remaining references.

## Runtime Flow

### On Page Open

1. Read file-level library data.
2. Read current page deck manifest.
3. If legacy `cardsData` exists, migrate it.
4. Merge shared card fields with page-local field extensions.
5. Validate template compatibility against the merged schema.
6. Load the current deck view in the UI.

### On Forge

1. Resolve the current page `cardRefs` through the file library.
2. Merge shared card fields with each reference's local field extensions.
3. Apply the resolved card data to the `Front` and `Back` trees.
4. Emit warnings for missing card IDs, field collisions, or template mismatches.
5. Render/export using the existing print and tabletop pipelines.

### On Save

1. Serialize the file library back to `currentFile`.
2. Serialize the page manifest back to `currentPage`.
3. Keep the two writes independent so a failed deck save does not corrupt the shared library.

## UI Behavior

The current "Cards" tab should continue to show the cards for the active deck page, not the entire file library.

Recommended additions:

- show a shared badge or usage count for cards that are referenced by more than one deck
- show local-extension markers on references that carry page-specific fields
- provide an explicit "Fork as Variant" action for selected cards
- provide an explicit "Import from Deck" or "Copy Deck" action for deck takeover workflows
- keep the existing add, duplicate, and delete workflows mapped to the new storage model

In this design:

- "Add" creates a brand-new shared-library card and references it from the current deck
- "Duplicate" forks the selected card into a new shared-library record with copied values
- "Delete" removes the current deck reference and removes the library record only if it is no longer referenced anywhere
- "Add field" appends a page-local field extension to the selected reference object

## Migration Plan

The migration must be automatic and idempotent.

Legacy input:

- page-local `cardsData` JSON

Migration steps:

1. Read the legacy `cardsData` from the current page.
2. Create a file-level card library if none exists.
3. Create card records for each legacy card object.
4. Create a page manifest that references the new card IDs in the same order.
5. Write the new file-level and page-level data.
6. Only remove or ignore the legacy key after the new model is fully written.

If migration fails halfway through, the next open should retry instead of losing data.

## Error Handling

- Missing card reference in a manifest: show a warning and skip that card during forge.
- Field name collision between shared card fields and page-local field extensions: block the save until the field is renamed or forked.
- Missing library data: initialize an empty library.
- Template mismatch: show a clear deck-level warning and do not pretend the card values are safe to render.
- Corrupted JSON: preserve the legacy data if possible and surface a recoverable error.
- Duplicate IDs: generate a fresh ID before writing; never reuse an existing ID for a different card.

## Testing Strategy

Add tests for:

- serialization and deserialization of the file library
- serialization and deserialization of the page manifest
- migration from legacy `cardsData`
- deck copy/takeover behavior
- append/import behavior
- fork behavior
- page-local field extension merge behavior
- field collision detection between shared and page-local fields
- reference counting and cleanup of unreferenced cards
- template signature comparison and mismatch handling
- forge resolution with shared cards

The current `cardFields` and text-fitting tests should continue to pass unchanged, because the rendering primitives are not being replaced.

## Acceptance Criteria

- Two pages in the same Penpot file can reference the same cards.
- Editing a shared card updates every deck that uses it.
- A deck can be copied from another deck without duplicating card definitions.
- A deck can be extended after takeover by adding more cards.
- A deck can add page-local fields to a referenced card without affecting other decks.
- Shared cards are only forked when the user explicitly asks for a variant.
- Existing files with legacy `cardsData` still open and migrate successfully.
- Forge output remains functionally equivalent for existing single-deck files.

## Implementation Notes

Expected code touch points:

- `src/plugin.ts`
- `src/main.ts`
- `src/model.ts`
- any shared state helpers introduced for the file library and page manifest

The key design constraint is to keep the rendering pipeline stable while moving persistence from "one page owns all card data" to "file owns cards, page owns membership".
