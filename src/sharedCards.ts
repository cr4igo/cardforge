import type {
    CardField,
    CardFieldExtension,
    DeckCardRef,
    DeckManifest,
    FieldExtensionCollision,
    ResolvedCardData,
    SharedCardLibrary,
    SharedCardRecord,
} from "./model";

export const CARDS_LIBRARY_KEY = "cardsLibrary";
export const DECK_MANIFEST_KEY = "deckManifest";
export const LEGACY_CARDS_DATA_KEY = "cardsData";
export const CARD_ID_FIELD = "__cardId";
export const CARD_REF_ID_FIELD = "__cardRefId";
export const CARD_FORKED_FROM_FIELD = "__forkedFromCardId";

type IdFactory = () => string;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneFields(fields: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (key === CARD_ID_FIELD || key === CARD_REF_ID_FIELD || key === CARD_FORKED_FROM_FIELD) {
            continue;
        }
        result[key] = value;
    }
    return result;
}

function cloneLibrary(library: SharedCardLibrary): SharedCardLibrary {
    const cardsById: Record<string, SharedCardRecord> = {};
    for (const [cardId, card] of Object.entries(library.cardsById)) {
        cardsById[cardId] = {
            ...card,
            fields: { ...card.fields },
        };
    }
    return { version: 1, cardsById };
}

function cloneManifest(manifest: DeckManifest): DeckManifest {
    return {
        ...manifest,
        cardRefs: manifest.cardRefs.map((ref) => ({
            ...ref,
            fieldExtensions: ref.fieldExtensions.map((field) => ({ ...field })),
        })),
    };
}

function nextUniqueId(idFactory: IdFactory, used: Set<string>, fallbackPrefix: string): string {
    const base = idFactory() || `${fallbackPrefix}_${used.size + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix++;
    }
    used.add(candidate);
    return candidate;
}

function cardNameFromFields(fields: Record<string, any>): string {
    const name = fields["#name"] ?? fields["#title"] ?? fields["#Name"] ?? fields["#Title"];
    return typeof name === "string" ? name : "";
}

function createCardRecord(
    id: string,
    fields: Record<string, any>,
    now: string,
    forkedFromCardId: string | null,
): SharedCardRecord {
    return {
        id,
        name: cardNameFromFields(fields),
        fields: cloneFields(fields),
        forkedFromCardId,
        createdAt: now,
        updatedAt: now,
    };
}

function normalizeFieldExtension(value: unknown, fallbackId: string): CardFieldExtension | null {
    if (!isRecord(value) || typeof value.name !== "string") {
        return null;
    }

    const extension: CardFieldExtension = {
        id: typeof value.id === "string" ? value.id : fallbackId,
        name: value.name,
        type: typeof value.type === "string" ? value.type : "text",
    };

    if (typeof value.shapeName === "string") {
        extension.shapeName = value.shapeName;
    }
    if ("value" in value) {
        extension.value = value.value;
    }
    if (isRecord(value.fit) && typeof value.fit.min === "number" && typeof value.fit.max === "number") {
        extension.fit = { min: value.fit.min, max: value.fit.max };
    }

    return extension;
}

function normalizeCardRecord(value: unknown, fallbackId: string): SharedCardRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const fields = isRecord(value.fields) ? cloneFields(value.fields) : {};
    const id = typeof value.id === "string" ? value.id : fallbackId;
    return {
        id,
        name: typeof value.name === "string" ? value.name : cardNameFromFields(fields),
        fields,
        forkedFromCardId: typeof value.forkedFromCardId === "string" ? value.forkedFromCardId : null,
        createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
}

export function createEmptyLibrary(): SharedCardLibrary {
    return { version: 1, cardsById: {} };
}

export function createEmptyManifest(deckId = "deck_test"): DeckManifest {
    return { version: 1, deckId, templateSignature: "", cardRefs: [] };
}

export function parseLibrary(serialized: string | null | undefined): SharedCardLibrary {
    if (!serialized) {
        return createEmptyLibrary();
    }

    try {
        const parsed: unknown = JSON.parse(serialized);
        if (!isRecord(parsed) || !isRecord(parsed.cardsById)) {
            return createEmptyLibrary();
        }

        const cardsById: Record<string, SharedCardRecord> = {};
        const usedCardIds = new Set<string>();
        for (const [cardId, card] of Object.entries(parsed.cardsById)) {
            const normalized = normalizeCardRecord(card, cardId);
            if (normalized) {
                const uniqueId = nextUniqueId(() => normalized.id, usedCardIds, "card");
                cardsById[uniqueId] = { ...normalized, id: uniqueId };
            }
        }

        return { version: 1, cardsById };
    } catch {
        return createEmptyLibrary();
    }
}

export function parseManifest(serialized: string | null | undefined, deckId = "deck_test"): DeckManifest {
    if (!serialized) {
        return createEmptyManifest(deckId);
    }

    try {
        const parsed: unknown = JSON.parse(serialized);
        if (!isRecord(parsed)) {
            return createEmptyManifest(deckId);
        }

        const cardRefs: DeckCardRef[] = [];
        if (Array.isArray(parsed.cardRefs)) {
            for (let i = 0; i < parsed.cardRefs.length; i++) {
                const rawRef = parsed.cardRefs[i];
                if (!isRecord(rawRef) || typeof rawRef.cardId !== "string") {
                    continue;
                }

                const fieldExtensions: CardFieldExtension[] = [];
                if (Array.isArray(rawRef.fieldExtensions)) {
                    for (let j = 0; j < rawRef.fieldExtensions.length; j++) {
                        const extension = normalizeFieldExtension(rawRef.fieldExtensions[j], `field_${i + 1}_${j + 1}`);
                        if (extension) {
                            fieldExtensions.push(extension);
                        }
                    }
                }

                cardRefs.push({
                    refId: typeof rawRef.refId === "string" ? rawRef.refId : `ref_${i + 1}`,
                    cardId: rawRef.cardId,
                    fieldExtensions,
                });
            }
        }

        return {
            version: 1,
            deckId: typeof parsed.deckId === "string" ? parsed.deckId : deckId,
            templateSignature: typeof parsed.templateSignature === "string" ? parsed.templateSignature : "",
            cardRefs,
        };
    } catch {
        return createEmptyManifest(deckId);
    }
}

export function computeTemplateSignature(fields: CardField[]): string {
    return fields
        .map((field, index) => `${field.side ?? field.id ?? index}:${field.name}:${field.type}`)
        .join("|");
}

export function migrateLegacyCardsData(
    legacyCardsData: string | null | undefined,
    now: string,
    idFactory: IdFactory,
): { library: SharedCardLibrary; manifest: DeckManifest } {
    const library = createEmptyLibrary();
    const manifest = createEmptyManifest();
    if (!legacyCardsData) {
        return { library, manifest };
    }

    let cards: unknown = legacyCardsData;
    try {
        for (let i = 0; i < 2 && typeof cards === "string"; i++) {
            cards = JSON.parse(cards);
        }
    } catch {
        return { library, manifest };
    }

    if (!Array.isArray(cards)) {
        return { library, manifest };
    }

    const usedCardIds = new Set<string>();
    const usedRefIds = new Set<string>();
    for (const card of cards) {
        if (!isRecord(card)) {
            continue;
        }

        const cardId = nextUniqueId(idFactory, usedCardIds, "card");
        const refId = nextUniqueId(idFactory, usedRefIds, "ref");
        library.cardsById[cardId] = createCardRecord(cardId, card, now, null);
        manifest.cardRefs.push({ refId, cardId, fieldExtensions: [] });
    }

    return { library, manifest };
}

function fieldsEqual(left: Record<string, any>, right: Record<string, any>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

export function mergeMigratedDeckState(
    existingLibrary: SharedCardLibrary,
    migratedLibrary: SharedCardLibrary,
    migratedManifest: DeckManifest,
    idFactory: IdFactory,
): { library: SharedCardLibrary; manifest: DeckManifest } {
    const library = cloneLibrary(existingLibrary);
    const manifest = cloneManifest(migratedManifest);
    const usedCardIds = new Set(Object.keys(library.cardsById));

    for (const [cardId, card] of Object.entries(migratedLibrary.cardsById)) {
        let targetCardId = cardId;
        const existing = library.cardsById[targetCardId];

        if (existing && fieldsEqual(existing.fields, card.fields)) {
            targetCardId = existing.id;
        } else {
            if (existing) {
                targetCardId = nextUniqueId(idFactory, usedCardIds, "card");
            } else {
                usedCardIds.add(targetCardId);
            }

            library.cardsById[targetCardId] = {
                ...card,
                id: targetCardId,
                fields: { ...card.fields },
            };
        }

        for (const ref of manifest.cardRefs) {
            if (ref.cardId === cardId) {
                ref.cardId = targetCardId;
            }
        }
    }

    return { library, manifest };
}

export function resolveDeckCards(library: SharedCardLibrary, manifest: DeckManifest): ResolvedCardData[] {
    const resolved: ResolvedCardData[] = [];

    for (const ref of manifest.cardRefs) {
        const card = library.cardsById[ref.cardId];
        if (!card) {
            continue;
        }

        const data: ResolvedCardData = {
            ...card.fields,
            [CARD_ID_FIELD]: card.id,
            [CARD_REF_ID_FIELD]: ref.refId,
        } as ResolvedCardData;

        for (const extension of ref.fieldExtensions) {
            if (!Object.prototype.hasOwnProperty.call(card.fields, extension.name)) {
                data[extension.name] = extension.value ?? "";
            }
        }

        resolved.push(data);
    }

    return resolved;
}

export function detectFieldExtensionCollisions(
    library: SharedCardLibrary,
    manifest: DeckManifest,
): FieldExtensionCollision[] {
    const collisions: FieldExtensionCollision[] = [];

    for (const ref of manifest.cardRefs) {
        const card = library.cardsById[ref.cardId];
        if (!card) {
            continue;
        }

        for (const extension of ref.fieldExtensions) {
            if (Object.prototype.hasOwnProperty.call(card.fields, extension.name)) {
                collisions.push({ refId: ref.refId, cardId: ref.cardId, fieldName: extension.name });
            }
        }
    }

    return collisions;
}

export function findMissingCardRefs(
    library: SharedCardLibrary,
    manifest: DeckManifest,
): { refId: string; cardId: string }[] {
    return manifest.cardRefs
        .filter((ref) => !library.cardsById[ref.cardId])
        .map((ref) => ({ refId: ref.refId, cardId: ref.cardId }));
}

export function appendCardToDeck(
    library: SharedCardLibrary,
    manifest: DeckManifest,
    fields: Record<string, any>,
    now: string,
    cardIdFactory: IdFactory,
    refIdFactory: IdFactory,
): { library: SharedCardLibrary; manifest: DeckManifest } {
    const nextLibrary = cloneLibrary(library);
    const nextManifest = cloneManifest(manifest);
    const usedCardIds = new Set(Object.keys(nextLibrary.cardsById));
    const usedRefIds = new Set(nextManifest.cardRefs.map((ref) => ref.refId));
    const cardId = nextUniqueId(cardIdFactory, usedCardIds, "card");
    const refId = nextUniqueId(refIdFactory, usedRefIds, "ref");

    nextLibrary.cardsById[cardId] = createCardRecord(cardId, fields, now, null);
    nextManifest.cardRefs.push({ refId, cardId, fieldExtensions: [] });

    return { library: nextLibrary, manifest: nextManifest };
}

export function appendRefsToDeck(
    targetManifest: DeckManifest,
    refs: DeckCardRef[],
    refIdFactory: IdFactory,
): DeckManifest {
    const nextManifest = cloneManifest(targetManifest);
    const usedRefIds = new Set(nextManifest.cardRefs.map((ref) => ref.refId));

    for (const ref of refs) {
        nextManifest.cardRefs.push({
            refId: nextUniqueId(refIdFactory, usedRefIds, "ref"),
            cardId: ref.cardId,
            fieldExtensions: ref.fieldExtensions.map((field) => ({ ...field })),
        });
    }

    return nextManifest;
}

export function forkCardForRef(
    library: SharedCardLibrary,
    manifest: DeckManifest,
    refId: string,
    now: string,
    cardIdFactory: IdFactory,
): { library: SharedCardLibrary; manifest: DeckManifest } {
    const nextLibrary = cloneLibrary(library);
    const nextManifest = cloneManifest(manifest);
    const ref = nextManifest.cardRefs.find((cardRef) => cardRef.refId === refId);
    if (!ref) {
        return { library: nextLibrary, manifest: nextManifest };
    }

    const original = nextLibrary.cardsById[ref.cardId];
    if (!original) {
        return { library: nextLibrary, manifest: nextManifest };
    }

    const usedCardIds = new Set(Object.keys(nextLibrary.cardsById));
    const cardId = nextUniqueId(cardIdFactory, usedCardIds, "card");
    nextLibrary.cardsById[cardId] = createCardRecord(cardId, original.fields, now, original.id);
    ref.cardId = cardId;

    return { library: nextLibrary, manifest: nextManifest };
}

function referencedCardIds(manifests: DeckManifest[]): Set<string> {
    const ids = new Set<string>();
    for (const manifest of manifests) {
        for (const ref of manifest.cardRefs) {
            ids.add(ref.cardId);
        }
    }
    return ids;
}

export function deleteRefAndCleanup(
    library: SharedCardLibrary,
    manifest: DeckManifest,
    refId: string,
    otherManifests: DeckManifest[],
): { library: SharedCardLibrary; manifest: DeckManifest } {
    const nextLibrary = cloneLibrary(library);
    const nextManifest = cloneManifest(manifest);
    const removedRef = nextManifest.cardRefs.find((ref) => ref.refId === refId);
    if (!removedRef) {
        return { library: nextLibrary, manifest: nextManifest };
    }

    nextManifest.cardRefs = nextManifest.cardRefs.filter((ref) => ref.refId !== refId);
    const stillReferenced = referencedCardIds([nextManifest, ...otherManifests]);
    if (!stillReferenced.has(removedRef.cardId)) {
        delete nextLibrary.cardsById[removedRef.cardId];
    }

    return { library: nextLibrary, manifest: nextManifest };
}

function visibleFieldNames(cardFields: CardField[]): Set<string> {
    return new Set(cardFields.map((field) => field.name));
}

function fieldForName(cardFields: CardField[], name: string): CardField | undefined {
    return cardFields.find((field) => field.name === name);
}

function upsertFieldExtension(
    ref: DeckCardRef,
    field: CardField,
    value: any,
    idFactory: IdFactory,
    usedExtensionIds: Set<string>,
) {
    const existing = ref.fieldExtensions.find((extension) => extension.name === field.name);
    if (existing) {
        existing.value = value;
        existing.type = field.type;
        existing.shapeName = field.shapeName;
        existing.fit = field.fit;
        return;
    }

    ref.fieldExtensions.push({
        id: nextUniqueId(idFactory, usedExtensionIds, "field"),
        name: field.name,
        type: field.type,
        shapeName: field.shapeName,
        value,
        fit: field.fit,
    });
}

export function syncDeckFromResolvedCards(
    library: SharedCardLibrary,
    manifest: DeckManifest,
    cardsData: Record<string, any>[],
    cardFields: CardField[],
    now: string,
    idFactory: IdFactory,
    otherManifests: DeckManifest[] = [],
): { library: SharedCardLibrary; manifest: DeckManifest } {
    let nextLibrary = cloneLibrary(library);
    const nextManifest = cloneManifest(manifest);
    const visibleNames = visibleFieldNames(cardFields);
    const usedCardIds = new Set(Object.keys(nextLibrary.cardsById));
    const usedRefIds = new Set(nextManifest.cardRefs.map((ref) => ref.refId));
    const usedExtensionIds = new Set(
        nextManifest.cardRefs.flatMap((ref) => ref.fieldExtensions.map((extension) => extension.id)),
    );
    const localFieldNames = new Set(
        nextManifest.cardRefs.flatMap((ref) => ref.fieldExtensions.map((extension) => extension.name)),
    );
    for (const field of cardFields) {
        for (const ref of nextManifest.cardRefs) {
            const card = nextLibrary.cardsById[ref.cardId];
            if (card && !Object.prototype.hasOwnProperty.call(card.fields, field.name)) {
                localFieldNames.add(field.name);
            }
        }
    }

    const orderedRefs: DeckCardRef[] = [];
    for (const cardData of cardsData) {
        const cardId = typeof cardData[CARD_ID_FIELD] === "string" ? cardData[CARD_ID_FIELD] : "";
        const refId = typeof cardData[CARD_REF_ID_FIELD] === "string" ? cardData[CARD_REF_ID_FIELD] : "";
        let ref = nextManifest.cardRefs.find((candidate) => candidate.refId === refId && candidate.cardId === cardId);

        if (!ref || !nextLibrary.cardsById[cardId]) {
            const newCardFields: Record<string, any> = {};
            for (const field of cardFields) {
                if (localFieldNames.has(field.name)) {
                    continue;
                }
                newCardFields[field.name] = Object.prototype.hasOwnProperty.call(cardData, field.name)
                    ? cardData[field.name]
                    : "";
            }

            const newCardId = nextUniqueId(idFactory, usedCardIds, "card");
            const newRefId = nextUniqueId(idFactory, usedRefIds, "ref");
            const forkedFromCardId = typeof cardData[CARD_FORKED_FROM_FIELD] === "string"
                ? cardData[CARD_FORKED_FROM_FIELD]
                : null;
            nextLibrary.cardsById[newCardId] = createCardRecord(newCardId, newCardFields, now, forkedFromCardId);
            ref = { refId: newRefId, cardId: newCardId, fieldExtensions: [] };
            for (const field of cardFields) {
                if (!localFieldNames.has(field.name)) {
                    continue;
                }
                upsertFieldExtension(
                    ref,
                    field,
                    Object.prototype.hasOwnProperty.call(cardData, field.name) ? cardData[field.name] : "",
                    idFactory,
                    usedExtensionIds,
                );
            }
            orderedRefs.push(ref);
            continue;
        }

        const card = nextLibrary.cardsById[cardId];
        for (const [name, value] of Object.entries(cardData)) {
            if (name === CARD_ID_FIELD || name === CARD_REF_ID_FIELD || !visibleNames.has(name)) {
                continue;
            }

            if (Object.prototype.hasOwnProperty.call(card.fields, name)) {
                card.fields[name] = value;
                card.name = cardNameFromFields(card.fields);
                card.updatedAt = now;
            } else {
                const field = fieldForName(cardFields, name);
                if (field) {
                    upsertFieldExtension(ref, field, value, idFactory, usedExtensionIds);
                }
            }
        }

        orderedRefs.push(ref);
    }

    const keptRefIds = new Set(orderedRefs.map((ref) => ref.refId));
    const removedRefs = nextManifest.cardRefs.filter((ref) => !keptRefIds.has(ref.refId));
    const stillReferenced = referencedCardIds([{ ...nextManifest, cardRefs: orderedRefs }, ...otherManifests]);

    for (const removedRef of removedRefs) {
        if (!stillReferenced.has(removedRef.cardId)) {
            delete nextLibrary.cardsById[removedRef.cardId];
        }
    }

    nextManifest.cardRefs = orderedRefs;
    return { library: nextLibrary, manifest: nextManifest };
}
