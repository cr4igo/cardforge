import assert from "node:assert/strict";
import {
  appendCardToDeck,
  appendRefsToDeck,
  computeTemplateSignature,
  createEmptyLibrary,
  createEmptyManifest,
  deleteRefAndCleanup,
  detectFieldExtensionCollisions,
  findMissingCardRefs,
  forkCardForRef,
  migrateLegacyCardsData,
  mergeMigratedDeckState,
  parseLibrary,
  parseManifest,
  resolveDeckCards,
  syncDeckFromResolvedCards,
} from "../src/sharedCards.ts";

const fields = [
  { id: "front-title", name: "#title", shapeName: "#title", type: "text" },
  { id: "front-art", name: "#art", shapeName: "#art", type: "image" },
];

assert.deepEqual(parseLibrary(""), createEmptyLibrary());
assert.deepEqual(parseManifest(""), createEmptyManifest("deck_test"));
assert.equal(computeTemplateSignature(fields), "front-title:#title:text|front-art:#art:image");

const duplicateIds = parseLibrary(JSON.stringify({
  version: 1,
  cardsById: {
    a: { id: "dup", fields: { "#title": "A" } },
    b: { id: "dup", fields: { "#title": "B" } },
  },
}));
assert.equal(Object.keys(duplicateIds.cardsById).length, 2);

const missingManifest = createEmptyManifest("deck_missing");
missingManifest.cardRefs.push({ refId: "missing_ref", cardId: "missing_card", fieldExtensions: [] });
assert.deepEqual(findMissingCardRefs(createEmptyLibrary(), missingManifest), [{ refId: "missing_ref", cardId: "missing_card" }]);

const migrated = migrateLegacyCardsData(
  JSON.stringify([{ "#title": "A" }, { "#title": "B" }]),
  "2026-06-13T10:00:00.000Z",
  () => "id_a",
);
assert.equal(Object.keys(migrated.library.cardsById).length, 2);
assert.deepEqual(resolveDeckCards(migrated.library, migrated.manifest).map((card) => card["#title"]), ["A", "B"]);

const doubleSerialized = migrateLegacyCardsData(
  JSON.stringify(JSON.stringify([{ "#title": "Double" }])),
  "2026-06-13T10:00:00.000Z",
  () => "double_id",
);
assert.deepEqual(resolveDeckCards(doubleSerialized.library, doubleSerialized.manifest).map((card) => card["#title"]), ["Double"]);

const deterministicMigrated = migrateLegacyCardsData(
  JSON.stringify([{ "#title": "Stable" }]),
  "2026-06-13T10:00:00.000Z",
  (() => {
    let id = 0;
    return () => `legacy_${id++}`;
  })(),
);
const mergedOnce = mergeMigratedDeckState(createEmptyLibrary(), deterministicMigrated.library, deterministicMigrated.manifest, () => "fallback");
const mergedTwice = mergeMigratedDeckState(mergedOnce.library, deterministicMigrated.library, deterministicMigrated.manifest, () => "fallback");
assert.equal(Object.keys(mergedTwice.library.cardsById).length, 1);
assert.equal(mergedTwice.manifest.cardRefs[0].cardId, mergedOnce.manifest.cardRefs[0].cardId);

let library = createEmptyLibrary();
let manifest = createEmptyManifest("deck_a");
({ library, manifest } = appendCardToDeck(
  library,
  manifest,
  { "#title": "Shared" },
  "2026-06-13T10:00:00.000Z",
  () => "card_1",
  () => "ref_1",
));
library.cardsById.card_1.fields["#art"] = "";

const copied = appendRefsToDeck(createEmptyManifest("deck_b"), manifest.cardRefs, () => "ref_copy");
assert.equal(copied.cardRefs[0].cardId, "card_1");
library.cardsById.card_1.fields["#title"] = "Changed";
assert.equal(resolveDeckCards(library, copied)[0]["#title"], "Changed");

manifest.cardRefs[0].fieldExtensions.push({ id: "ext_1", name: "#deckOnly", type: "text", value: "Local" });
const resolved = resolveDeckCards(library, manifest);
assert.equal(resolved[0].__cardId, "card_1");
assert.equal(resolved[0].__cardRefId, "ref_1");
assert.equal(resolved[0]["#deckOnly"], "Local");

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

const ids = ["card_10", "ref_10", "ext_10"];
const synced = syncDeckFromResolvedCards(
  library,
  manifest,
  [
    { __cardId: "card_1", __cardRefId: "ref_1", "#title": "Edited", "#deckOnly": "Deck" },
    { "#title": "New", "#art": "asset|id" },
  ],
  [...fields, { id: "deck-only", name: "#deckOnly", shapeName: "#deckOnly", type: "text" }],
  "2026-06-13T12:00:00.000Z",
  () => ids.shift() ?? "fallback",
);
assert.equal(synced.library.cardsById.card_1.fields["#title"], "Edited");
assert.equal(synced.manifest.cardRefs[0].fieldExtensions[0].value, "Deck");
assert.equal(synced.manifest.cardRefs[1].cardId, "card_10");
assert.deepEqual(synced.library.cardsById.card_10.fields, { "#title": "New", "#art": "asset|id" });
assert.deepEqual(synced.manifest.cardRefs[1].fieldExtensions.map((field) => [field.name, field.value]), [["#deckOnly", ""]]);

const sharedCleanup = syncDeckFromResolvedCards(
  library,
  manifest,
  [],
  fields,
  "2026-06-13T13:00:00.000Z",
  () => "unused",
  [copied],
);
assert.equal(sharedCleanup.manifest.cardRefs.length, 0);
assert.ok(sharedCleanup.library.cardsById.card_1);

const unreferencedCleanup = syncDeckFromResolvedCards(
  library,
  manifest,
  [],
  fields,
  "2026-06-13T13:00:00.000Z",
  () => "unused",
);
assert.equal(unreferencedCleanup.manifest.cardRefs.length, 0);
assert.equal(unreferencedCleanup.library.cardsById.card_1, undefined);

const emptyNewCard = syncDeckFromResolvedCards(
  createEmptyLibrary(),
  createEmptyManifest("deck_empty"),
  [{}],
  fields,
  "2026-06-13T14:00:00.000Z",
  () => "empty_id",
);
assert.deepEqual(Object.values(emptyNewCard.library.cardsById)[0].fields, { "#title": "", "#art": "" });

const forkFromClone = syncDeckFromResolvedCards(
  library,
  manifest,
  [{ __forkedFromCardId: "card_1", "#title": "Forked", "#art": "" }],
  fields,
  "2026-06-13T15:00:00.000Z",
  () => "fork_clone",
);
assert.equal(forkFromClone.library.cardsById.fork_clone.forkedFromCardId, "card_1");

const importedManifest = createEmptyManifest("deck_imported");
importedManifest.cardRefs.push({ refId: "import_ref", cardId: "card_1", fieldExtensions: [] });
const importedWithLocalField = syncDeckFromResolvedCards(
  library,
  importedManifest,
  [
    { __cardId: "card_1", __cardRefId: "import_ref", "#title": "Imported", "#deckOnly": "Existing local" },
    { "#title": "Added", "#deckOnly": "New local" },
  ],
  [...fields, { id: "deck-only", name: "#deckOnly", shapeName: "#deckOnly", type: "text" }],
  "2026-06-13T16:00:00.000Z",
  () => "import_id",
);
assert.equal(importedWithLocalField.library.cardsById.import_id.fields["#deckOnly"], undefined);
assert.deepEqual(importedWithLocalField.manifest.cardRefs[1].fieldExtensions.map((field) => [field.name, field.value]), [["#deckOnly", "New local"]]);

console.log("shared cards tests passed");
