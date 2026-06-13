# Shared Cards Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement file-level shared cards and page-level deck manifests from `docs/superpowers/specs/2026-06-13-shared-cards-across-decks-design.md`.

**Architecture:** Add a focused `src/sharedCards.ts` domain module for library, manifest, migration, references, forks, imports, cleanup, template signatures, and resolved card data. Keep `src/plugin.ts` responsible for Penpot persistence and rendering orchestration. Keep `src/main.ts` mostly on the existing `cardsData` UI shape, with card identity metadata carried invisibly as `__cardRefId` and `__cardId`.

**Tech Stack:** TypeScript, Penpot plugin data API, existing Node `.mjs` assertion tests, existing Vite/TypeScript build.

---

### Task 1: Shared Cards Domain Module

**Files:**
- Create: `src/sharedCards.ts`
- Test: `tests/sharedCards.test.mjs`
- Modify: `src/model.ts`

- [ ] **Step 1: Write failing domain tests**

Create `tests/sharedCards.test.mjs` with assertions for:

```js
import assert from "node:assert/strict";
import {
  appendCardToDeck,
  appendRefsToDeck,
  computeTemplateSignature,
  createEmptyLibrary,
  createEmptyManifest,
  deleteRefAndCleanup,
  detectFieldExtensionCollisions,
  forkCardForRef,
  migrateLegacyCardsData,
  parseLibrary,
  parseManifest,
  resolveDeckCards,
} from "../src/sharedCards.ts";

const fields = [
  { id: "front-title", name: "#title", shapeName: "#title", type: "text" },
  { id: "front-art", name: "#art", shapeName: "#art", type: "image" },
];

assert.deepEqual(parseLibrary(""), createEmptyLibrary());
assert.deepEqual(parseManifest(""), createEmptyManifest("deck_test"));
assert.equal(computeTemplateSignature(fields), "front-title:#title:text|front-art:#art:image");

const migrated = migrateLegacyCardsData(JSON.stringify([{ "#title": "A" }, { "#title": "B" }]), "2026-06-13T10:00:00.000Z", () => "id_a");
assert.equal(Object.keys(migrated.library.cardsById).length, 2);
assert.deepEqual(resolveDeckCards(migrated.library, migrated.manifest).map((card) => card["#title"]), ["A", "B"]);

let library = createEmptyLibrary();
let manifest = createEmptyManifest("deck_a");
({ library, manifest } = appendCardToDeck(library, manifest, { "#title": "Shared" }, "2026-06-13T10:00:00.000Z", () => "card_1", () => "ref_1"));
const copied = appendRefsToDeck(createEmptyManifest("deck_b"), manifest.cardRefs, () => "ref_copy");
assert.equal(copied.cardRefs[0].cardId, "card_1");
library.cardsById.card_1.fields["#title"] = "Changed";
assert.equal(resolveDeckCards(library, copied)[0]["#title"], "Changed");

manifest.cardRefs[0].fieldExtensions.push({ id: "ext_1", name: "#deckOnly", type: "text" });
const resolved = resolveDeckCards(library, manifest);
assert.equal(resolved[0].__cardId, "card_1");
assert.equal(resolved[0].__cardRefId, "ref_1");
assert.equal(resolved[0]["#deckOnly"], "");

assert.deepEqual(detectFieldExtensionCollisions(library, manifest), []);
manifest.cardRefs[0].fieldExtensions.push({ id: "ext_2", name: "#title", type: "text" });
assert.deepEqual(detectFieldExtensionCollisions(library, manifest), [{ refId: "ref_1", cardId: "card_1", fieldName: "#title" }]);
manifest.cardRefs[0].fieldExtensions.pop();

const forked = forkCardForRef(library, manifest, "ref_1", "2026-06-13T11:00:00.000Z", () => "card_2");
assert.equal(forked.manifest.cardRefs[0].cardId, "card_2");
assert.equal(forked.library.cardsById.card_2.forkedFromCardId, "card_1");

const cleaned = deleteRefAndCleanup(forked.library, forked.manifest, "ref_1", []);
assert.equal(cleaned.manifest.cardRefs.length, 0);
assert.equal(cleaned.library.cardsById.card_2, undefined);
assert.ok(cleaned.library.cardsById.card_1);

console.log("shared cards tests passed");
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\sharedCards.test.mjs`

Expected: FAIL because `src/sharedCards.ts` does not exist.

- [ ] **Step 3: Implement domain model**

Create `src/sharedCards.ts` with:

- constants `CARDS_LIBRARY_KEY = "cardsLibrary"` and `DECK_MANIFEST_KEY = "deckManifest"`
- `parseLibrary` and `parseManifest` with corrupted/empty JSON fallback
- `createEmptyLibrary`, `createEmptyManifest`
- `migrateLegacyCardsData`
- `appendCardToDeck`, `appendRefsToDeck`, `forkCardForRef`, `deleteRefAndCleanup`
- `resolveDeckCards`, including `__cardId` and `__cardRefId`
- `detectFieldExtensionCollisions`
- `computeTemplateSignature`

Extend `src/model.ts` with shared-card types and warning reasons.

- [ ] **Step 4: Run domain test**

Run: `node --test tests\sharedCards.test.mjs`

Expected: PASS.

### Task 2: Plugin Persistence Integration

**Files:**
- Modify: `src/plugin.ts`
- Test: `npm run build`

- [ ] **Step 1: Route card loading through file library and page manifest**

Replace direct `currentPage.getPluginData("cardsData")` reads with:

- load `currentFile.getPluginData(CARDS_LIBRARY_KEY)`
- load `currentPage.getPluginData(DECK_MANIFEST_KEY)`
- migrate legacy `cardsData` when manifest is empty and legacy data exists
- send resolved current-deck cards as existing `CARDS_DATA`

- [ ] **Step 2: Route saves through resolver helpers**

Replace direct `currentPage.setPluginData("cardsData")` with:

- parse UI cards array
- update existing shared card fields by `__cardId`
- create shared card + page ref for new UI card without IDs
- remove page refs no longer present in UI cards
- cleanup unreferenced library cards
- write file library and page manifest independently

- [ ] **Step 3: Route forge through persisted deck**

For `forge-cards`, ignore stale UI card payload for identity and resolve cards from current file/page data before rendering. Keep `type` and `cutMarks` from UI payload.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: PASS.

### Task 3: UI Identity Preservation

**Files:**
- Modify: `src/main.ts`
- Test: `npm run build`

- [ ] **Step 1: Preserve hidden IDs**

Keep `__cardId` and `__cardRefId` on `cardsData` objects but never render them as editable fields because the UI iterates over `cardFields`, not object keys.

- [ ] **Step 2: Make duplicate explicit fork request compatible**

Keep the existing `copyCard` behavior by cloning the visible card data and removing `__cardId` and `__cardRefId`, so backend creates a new shared record. This maps duplicate to explicit fork-like behavior without silently modifying the original shared card.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run all tests**

Run: `node --test tests\*.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Inspect git diff**

Run: `git diff -- src tests docs/superpowers/plans`

Expected: Changes are limited to shared-card model, tests, plugin integration, UI identity preservation, and this plan.
