
import type { Shape, Board, Text } from '@penpot/plugin-types';
import { parseFieldName } from './fieldMetadata';
import { collectCardFields, findByFieldName, applyCardDataToTree } from './cardFields';
import { fitTextToBoxWithDetails, type FittableText } from './textFit';
import { fitLongWordsToBox, type MeasureWordWidth, type WordFittableText } from './wordFit';
import {
    CARDS_LIBRARY_KEY,
    DECK_MANIFEST_KEY,
    LEGACY_CARDS_DATA_KEY,
    computeTemplateSignature,
    createEmptyManifest,
    detectFieldExtensionCollisions,
    appendRefsToDeck,
    findMissingCardRefs,
    migrateLegacyCardsData,
    mergeMigratedDeckState,
    parseLibrary,
    parseManifest,
    resolveDeckCards,
    syncDeckFromResolvedCards,
} from './sharedCards';
import type { PluginUIEvent, DeckEvent, ForgeWarning, CardField, DeckManifest, SharedCardLibrary } from './model';


export const cardSizes = [
    ["Dixit (80 x 120 mm)", 945, 1417],
    ["Tarot (70 x 120 mm)", 827, 1417],
    ["French tarot (61 x 112 mm)", 720, 1323],
    ["Wonder (65 x 100 mm)", 768, 1181],
    ["Volcano (70 x 110 mm)", 827, 1299],
    ["Euro (59 x 92 mm)", 697, 1086],
    ["Asia (57,5 x 89 mm)", 679, 1051],
    ["Standard (Poker) (63,5 x 88 mm)", 750, 1039],
    ["USA (56 x 87 mm)", 661, 1027],
    ["Square L (80x80 mm)", 945, 945],
    ["Desert (50 x 75 mm)", 590, 886],
    ["Square S (70 x 70 mm)", 827, 827],
    ["Mini EURO (45 x 68 mm)", 531, 803],
    ["Mini Asia (43 x 65 mm)", 508, 768],
    ["Mini USA (41 x 63 mm)", 484, 744]];


let front: Board;
let back: Board;

penpot.ui.open("CardForge", "", {
    width: 1200,
    height: 650,
});


function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso() {
    return new Date().toISOString();
}

function createId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function currentDeckId() {
    return penpot.currentPage ? `deck_${penpot.currentPage.id}` : "deck_unknown";
}

function getCurrentCardFields(): CardField[] {
    const root = penpot.currentPage?.getShapeById("00000000-0000-0000-0000-000000000000") as Board | null | undefined;
    if (!root) {
        return [];
    }

    const frontBoard = findByName(root, "Front") as Board | undefined;
    const backBoard = findByName(root, "Back") as Board | undefined;
    return collectCardFields([frontBoard, backBoard].filter(Boolean) as Board[]);
}

function readSharedLibrary() {
    return parseLibrary(penpot.currentFile?.getPluginData(CARDS_LIBRARY_KEY));
}

function readDeckManifest(page = penpot.currentPage): DeckManifest {
    return parseManifest(page?.getPluginData(DECK_MANIFEST_KEY), page ? `deck_${page.id}` : currentDeckId());
}

function writeDeckState(library: SharedCardLibrary, manifest: DeckManifest) {
    penpot.currentFile?.setPluginData(CARDS_LIBRARY_KEY, JSON.stringify(library));
    penpot.currentPage?.setPluginData(DECK_MANIFEST_KEY, JSON.stringify(manifest));
}

function readOtherManifests(): DeckManifest[] {
    const currentPageId = penpot.currentPage?.id;
    return penpot.currentFile?.pages
        .filter((page) => page.id !== currentPageId)
        .map((page) => readDeckManifest(page))
        .filter((manifest) => manifest.cardRefs.length > 0) ?? [];
}

function loadDeckState(cardFields: CardField[]): { library: SharedCardLibrary; manifest: DeckManifest } {
    let library = readSharedLibrary();
    let manifest = readDeckManifest();
    const signature = computeTemplateSignature(cardFields);
    let shouldWrite = !penpot.currentPage?.getPluginData(DECK_MANIFEST_KEY);
    const legacyCardsData = penpot.currentPage?.getPluginData(LEGACY_CARDS_DATA_KEY);

    if (manifest.cardRefs.length === 0 && legacyCardsData) {
        let legacyId = 0;
        const migrated = migrateLegacyCardsData(
            legacyCardsData,
            nowIso(),
            () => `legacy_${penpot.currentPage?.id ?? "page"}_${legacyId++}`,
        );
        const merged = mergeMigratedDeckState(library, migrated.library, {
            ...migrated.manifest,
            deckId: currentDeckId(),
            templateSignature: signature,
        }, () => createId("legacy"));
        library = merged.library;
        manifest = merged.manifest;
        shouldWrite = true;
    } else if (!manifest.templateSignature) {
        manifest = { ...manifest, templateSignature: signature };
        shouldWrite = true;
    }

    if (shouldWrite) {
        writeDeckState(library, manifest);
    }

    return { library, manifest };
}

function parseCardsPayload(payload: unknown): Record<string, any>[] {
    let value = payload;
    try {
        for (let i = 0; i < 2 && typeof value === "string"; i++) {
            value = JSON.parse(value);
        }
    } catch {
        return [];
    }

    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isRecord);
}

function sendCardSaveError(message: string, data: any) {
    penpot.ui.sendMessage({ "type": "CARD_SAVE_ERROR", "data": { message, ...data } });
}

function sendCardsData(library: SharedCardLibrary, manifest: DeckManifest) {
    const cardsData = resolveDeckCards(library, manifest);
    console.log("loaded cards data:", cardsData);
    penpot.ui.sendMessage({ "type": "CARDS_DATA", "data": JSON.stringify(cardsData) });
}

function sendTemplateWarningIfNeeded(manifest: DeckManifest, cardFields: CardField[]) {
    const signature = computeTemplateSignature(cardFields);
    if (manifest.templateSignature && signature && manifest.templateSignature !== signature) {
        penpot.ui.sendMessage({
            "type": "DECK_WARNING",
            "data": { message: "Deck template changed. Review the cards before forging." },
        });
    } else {
        penpot.ui.sendMessage({ "type": "DECK_WARNING", "data": { message: "" } });
    }
}

function sendMissingCardWarningIfNeeded(library: SharedCardLibrary, manifest: DeckManifest) {
    const missing = findMissingCardRefs(library, manifest);
    if (missing.length > 0) {
        penpot.ui.sendMessage({
            "type": "DECK_WARNING",
            "data": { message: `${missing.length} deck card reference could not be found in the shared library.` },
        });
    }
}

function sendDeckSources() {
    const currentPageId = penpot.currentPage?.id;
    const sources = penpot.currentFile?.pages
        .filter((page) => page.id !== currentPageId)
        .map((page) => {
            const manifest = readDeckManifest(page);
            return { pageId: page.id, name: page.name, cardCount: manifest.cardRefs.length };
        })
        .filter((source) => source.cardCount > 0) ?? [];

    penpot.ui.sendMessage({ "type": "DECK_SOURCES", "data": sources });
}

function persistCardsData(payload: unknown): { library: SharedCardLibrary; manifest: DeckManifest } | null {
    const cardFields = getCurrentCardFields();
    const { library, manifest } = loadDeckState(cardFields);
    const synced = syncDeckFromResolvedCards(
        library,
        manifest,
        parseCardsPayload(payload),
        cardFields,
        nowIso(),
        () => createId("id"),
        readOtherManifests(),
    );
    synced.manifest.templateSignature = computeTemplateSignature(cardFields);

    const collisions = detectFieldExtensionCollisions(synced.library, synced.manifest);
    if (collisions.length > 0) {
        sendCardSaveError("Field extension collides with shared card field.", { collisions });
        return null;
    }

    writeDeckState(synced.library, synced.manifest);
    return synced;
}

function loadCardsData() {
    const cardFields = getCurrentCardFields();
    const { library, manifest } = loadDeckState(cardFields);
    sendTemplateWarningIfNeeded(manifest, cardFields);
    sendMissingCardWarningIfNeeded(library, manifest);
    sendCardsData(library, manifest);
}


function loadCardFields() {
    const fields = getCurrentCardFields();

    const assetsUrl = "https://design.penpot.app/assets/by-file-media-id/";
    penpot.ui.sendMessage({ "type": "CARD_FIELDS", "data": { fields: fields, assetsUrl: assetsUrl } });
    sendDeckSources();
}

function importDeckRefs(sourcePageId: string) {
    const sourcePage = penpot.currentFile?.pages.find((page) => page.id === sourcePageId);
    if (!sourcePage) {
        sendCardSaveError("Deck source page not found.", { sourcePageId });
        return;
    }

    const cardFields = getCurrentCardFields();
    const { library, manifest } = loadDeckState(cardFields);
    const sourceManifest = readDeckManifest(sourcePage);
    const nextManifest = appendRefsToDeck(manifest, sourceManifest.cardRefs, () => createId("ref"));
    nextManifest.templateSignature = computeTemplateSignature(cardFields);

    const collisions = detectFieldExtensionCollisions(library, nextManifest);
    if (collisions.length > 0) {
        sendCardSaveError("Imported deck has field extension collisions.", { collisions });
        return;
    }

    writeDeckState(library, nextManifest);
    sendCardsData(library, nextManifest);
    sendDeckSources();
}


// see findShapes
function findByName(parent: Board, name: string): Shape | undefined {
    for (let i = 0; i < parent.children.length; i++) {
        let child = parent.children[i];
        if ((child.hasOwnProperty("name")) && (child["name"] === name)) {
            return child;
        } if ((child as Board).children?.length > 0) {
            let inner = findByName((child as Board), name);
            if (inner) {
                return inner;
            }
        }
    }
    return undefined;
}

type TextMeasurementStyleKey =
    "fontId" |
    "fontFamily" |
    "fontVariantId" |
    "fontWeight" |
    "fontStyle" |
    "lineHeight" |
    "letterSpacing" |
    "textTransform" |
    "textDecoration" |
    "direction";

const textMeasurementStyleKeys: TextMeasurementStyleKey[] = [
    "fontId",
    "fontFamily",
    "fontVariantId",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textDecoration",
    "direction",
];

function copyTextMeasurementStyle(target: Text, source: Text, fontSize: number) {
    const targetRecord = target as unknown as Record<TextMeasurementStyleKey, unknown>;
    for (const key of textMeasurementStyleKeys) {
        const value = source[key];
        if (value !== "mixed" && value !== null && value !== undefined) {
            targetRecord[key] = value;
        }
    }

    target.growType = "auto-width";
    target.fontSize = String(Number(fontSize.toFixed(2)));
}

function createWordWidthMeasurer(source: Text, measurementBoard: Board): MeasureWordWidth {
    const cache = new Map<string, number>();

    return (word: string, fontSize: number) => {
        const cacheKey = `${word}\0${fontSize.toFixed(2)}`;
        const cached = cache.get(cacheKey);
        if (cached !== undefined) {
            return { width: cached, mode: "penpot-cache" };
        }

        const measurementText = penpot.createText(word);
        if (!measurementText) {
            return undefined;
        }

        measurementText.name = "_CardForge word measurement text";
        copyTextMeasurementStyle(measurementText, source, fontSize);
        measurementBoard.appendChild(measurementText);

        const width = (measurementText as unknown as FittableText).textBounds.width;
        measurementText.remove();

        if (!Number.isFinite(width) || width <= 0) {
            return undefined;
        }

        cache.set(cacheKey, width);
        return { width, mode: "penpot" };
    };
}



function createDeck(message: DeckEvent) {
    if (penpot.currentPage) {
        penpot.currentPage.name = message.name;

        const images = penpot.createBoard();
        images.name = "_Images";
        images.y = - 1000;
        images.hidden = true;


        front = penpot.createBoard();
        front.name = "Front";

        const inside = penpot.createBoard();
        inside.name = "inside";
        inside.borderRadius = 50;

        inside.strokes = [
            {
                strokeColor: '#000000',
                strokeStyle: 'solid',
                strokeWidth: 12,
                strokeAlignment: 'inner',
            },
        ];

        let size = parseInt(message.size)
        let width: string | number = cardSizes[size][1];
        let height: string | number = cardSizes[size][2];

        if (message.orientation == "landscape") {
            width = cardSizes[size][2];
            height = cardSizes[size][1];
        }

        front.resize((width as number), (height as number));
        inside.resize((width as number) - 48, (height as number) - 48);
        inside.x = 24;
        inside.y = 24;

        front.appendChild(inside);

        back = (front.clone() as Board);
        back.name = "Back";
        back.x += front.width + 100;

        writeDeckState(readSharedLibrary(), createEmptyManifest(currentDeckId()));
        penpot.closePlugin();
    }
}


function handleCreateDeck(message: DeckEvent) {
    const root: Board = (penpot.currentPage?.getShapeById("00000000-0000-0000-0000-000000000000") as Board);
    if (root.children.length == 0) {
        createDeck(message);
    } else {
        penpot.ui.sendMessage({ "type": "ERROR_DECK_CREATE_PAGE_NOT_EMPTY" });
    }
}

function handleIsPageEmpty() {
    const root: Board = (penpot.currentPage?.getShapeById("00000000-0000-0000-0000-000000000000") as Board);
    penpot.ui.sendMessage({ "type": "PAGE_EMPTY", "data": (root.children.length == 0) });
}



function createImage(data: Uint8Array, mimeType: string, num: number, name: string) {
    penpot
        .uploadMediaData('image', data, mimeType)
        .then((data) => {
            const shape = penpot.createRectangle();
            shape.resize(data.width, data.height);
            shape.fills = [{ fillOpacity: 1, fillImage: data }];
            shape.x = 0;
            shape.y = 0;

            const images = (penpot.currentPage?.findShapes({ name: "_Images" })[0] as Board);
            images.appendChild(shape);
            penpot.ui.sendMessage({ "type": "IMAGE_CREATED", "data": { "num": num, "name": name, "id": shape.fills[0].fillImage?.id, "imageId": shape.id } });
        })
        .catch((err) => console.error(err));
}


function cloneCard(card: Shape, cardData: Record<string, any>, cardNum: string): Board {
    const card2 = card.clone() as Board;
    card2.name = "card" + cardNum.padStart(2, '0');

    applyCardDataToTree(card2, cardData, {
        assignTextField(field, value) {
            const textField = field as unknown as Text;
            textField.characters = value;
        },
        assignImageField(field, value) {
            const imageId = value.split("|")[0];
            const image = penpot.currentPage?.getShapeById(imageId);
            if (image) {
                const imageShape = field as unknown as Shape;
                imageShape.fills = image.fills as any;
            }
        },
    });

    return card2;
}

function fitCardText(card: Board, cardData: Record<string, any>, cardNum: string, warnings: ForgeWarning[]) {
    for (const prop in cardData) {
        if (!Object.prototype.hasOwnProperty.call(cardData, prop)) {
            continue;
        }

        const field = findByFieldName(card, prop);
        if (!field || field.type !== "text") {
            continue;
        }

        const textField = field as Text;
        const metadata = parseFieldName(textField.name);
        if (!metadata.fit) {
            continue;
        }

        const result = fitTextToBoxWithDetails((textField as unknown as FittableText), metadata.fit);
        console.log("[CardForge fit]", {
            cardNum: Number(cardNum),
            fieldName: metadata.name,
            shapeName: metadata.shapeName,
            characters: textField.characters,
            box: { width: textField.width, height: textField.height },
            fit: metadata.fit,
            result: {
                fits: result.fits,
                fontSize: result.fontSize,
                reason: result.reason,
                usedEstimate: result.usedEstimate,
                staleTextBounds: result.staleTextBounds,
            },
            steps: result.steps,
        });

        if (!result.fits) {
            warnings.push({
                cardNum: Number(cardNum),
                fieldName: metadata.name,
                minFontSize: metadata.fit.min,
                reason: "box-overflow",
            });
        }

        let measurementBoard: Board | null = null;
        try {
            measurementBoard = penpot.createBoard();
            measurementBoard.name = "_CardForge word measurement";
            measurementBoard.x = -100000;
            measurementBoard.y = -100000;
            measurementBoard.resize(Math.max(textField.width * 4, 1000), Math.max(textField.height, 100));

            const baseFontSize = textField.fontSize;
            const wordFitResult = fitLongWordsToBox(
                (textField as unknown as WordFittableText),
                metadata.fit,
                createWordWidthMeasurer(textField, measurementBoard),
            );

            console.log("[CardForge word-fit]", {
                cardNum: Number(cardNum),
                fieldName: metadata.name,
                shapeName: metadata.shapeName,
                characters: textField.characters,
                boxWidth: textField.width,
                baseFontSize,
                adjustedWords: wordFitResult.words.length,
                warnings: wordFitResult.warnings.length,
                words: wordFitResult.words,
            });

            for (const warning of wordFitResult.warnings) {
                warnings.push({
                    cardNum: Number(cardNum),
                    fieldName: metadata.name,
                    minFontSize: warning.minFontSize,
                    reason: "long-word-overflow",
                    word: warning.word,
                    wordFontSize: warning.wordFontSize,
                });
            }
        } finally {
            measurementBoard?.remove();
        }
    }
}


function addCard(output: Board, card: Board, x: number, y: number) {
    card.x = x;
    card.y = y;

    output.appendChild(card);

    x += card.width;
    if ((x + card.width) > output.width) {
        x = output.x;
        y += card.height;
    }
    return [x, y];
}

function createCardPairSheet(frontCard: Board, backCard: Board, backOnTop: boolean, cutMarks: boolean) {
    let sheet = penpot.createBoard();
    sheet.name = frontCard.name;
    sheet.resize(frontCard.width, frontCard.height * 2);

    if (backOnTop) {
        backCard.rotate(180);
        sheet.appendChild(backCard);
        backCard.x = 0;
        backCard.y = 0;

        sheet.appendChild(frontCard);
        frontCard.x = 0;
        frontCard.y = frontCard.height;
    } else {
        sheet.appendChild(frontCard);
        frontCard.x = 0;
        frontCard.y = 0;

        sheet.appendChild(backCard);
        backCard.x = 0;
        backCard.y = frontCard.height;
    }

    if (cutMarks) {
        sheet = addCutMarks(sheet, false);
    }

    return sheet;
}


function addCutMarks(board: Board, clone = true) {
    let cutMBoard = penpot.createBoard();
    cutMBoard.name = "cutMBoard";
    cutMBoard.resize(board.width + 200, board.height + 200);

    let rect = penpot.createRectangle();
    rect.resize(200, 2);
    rect.x = 0;
    rect.y = 98;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(200, 2);
    rect.x = cutMBoard.width - 200;
    rect.y = 98;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(200, 2);
    rect.x = 0;
    rect.y = cutMBoard.height - 100;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(200, 2);
    rect.x = cutMBoard.width - 200;
    rect.y = cutMBoard.height - 100;
    cutMBoard.appendChild(rect);


    rect = penpot.createRectangle();
    rect.resize(2, 200);
    rect.x = 98;
    rect.y = 0;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(2, 200);
    rect.x = cutMBoard.width - 100;
    rect.y = 0;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(2, 200);
    rect.x = 98;
    rect.y = cutMBoard.height - 200;
    cutMBoard.appendChild(rect);

    rect = penpot.createRectangle();
    rect.resize(2, 200);
    rect.x = cutMBoard.width - 100;
    rect.y = cutMBoard.height - 200;
    cutMBoard.appendChild(rect);

    if (clone) {
        board = (board.clone() as Board);
    }
    board.x = 100;
    board.y = 100;
    cutMBoard.appendChild(board);

    return cutMBoard;
}

function countRectsFit(rectA: { width: number, height: number }, rectB: { width: number, height: number }): number {
    const countWidth = Math.floor(rectA.width / rectB.width);
    const countHeight = Math.floor(rectA.height / rectB.height);
    return countWidth * countHeight;
}

function forgeCards(cardsData: Record<string, any>[], type: string, cutMarks: boolean) {
    console.log("start forgecards", type, cutMarks);
    const warnings: ForgeWarning[] = [];
    let shapes = penpot.currentPage?.findShapes({ name: "Output" })
    if (shapes && (shapes.length > 0)) {
        shapes[0].remove();
    }


    let baseFront = (penpot.currentPage?.findShapes({ name: "Front" })[0] as Board);
    let baseBack = (penpot.currentPage?.findShapes({ name: "Back" })[0] as Board);

    let card: Board;
    let output: Board;
    let tmpFront: Board | null = null;
    let tmpBack: Board | null = null;

    let x = baseFront.x;
    let y = baseFront.y + baseFront.height + 400;

    output = penpot.createBoard();
    output.name = "Output";
    output.x = x;
    output.y = y;

    if (type == "standard") {

        if (cutMarks) {
            tmpFront = addCutMarks(baseFront);
            tmpBack = addCutMarks(baseBack);

            baseFront = tmpFront;
            baseBack = tmpBack;
        }

        output.resize(baseFront.width * Math.max(cardsData.length, 1), baseFront.height * 2);
    } else if (type == "tabletop") {
        output.resize(baseFront.width * 10, baseFront.height * 14);
    }

    if ((type == "tabletop") || (type == "standard")) {
        for (let i = 0; i < cardsData.length; i++) {
            const cardNum = String(i + 1);
            const frontCard = cloneCard(baseFront, cardsData[i], cardNum);
            fitCardText(frontCard, cardsData[i], cardNum, warnings);

            const backCard = cloneCard(baseBack, cardsData[i], cardNum);
            fitCardText(backCard, cardsData[i], cardNum, warnings);

            const cardPair = createCardPairSheet(frontCard, backCard, false, false);
            [x, y] = addCard(output, cardPair, x, y);
        }
    } else if (type == "printplay") {
        const frontSource = baseFront;
        const backSource = baseBack;

        tmpFront = penpot.createBoard();
        tmpFront.name = "tmpFront";
        tmpFront.resize(baseFront.width, baseFront.height * 2);
        const templateBack = baseBack.clone() as Board;
        templateBack.rotate(180);
        tmpFront.appendChild(templateBack);
        templateBack.x = 0;
        templateBack.y = 0;
        const templateFront = baseFront.clone() as Board;
        tmpFront.appendChild(templateFront);
        templateFront.x = 0;
        templateFront.y = templateFront.height;
        if (cutMarks) {
            tmpFront = addCutMarks(tmpFront, false);
        }
        baseFront = tmpFront;


        // A4


        let page: Board;
        let cardsPerPage: number;
        let width: number;
        let height: number;
        let fitPortrait = countRectsFit({ width: 2480, height: 3508 }, { width: baseFront.width, height: baseFront.height });
        let fitLandscape = countRectsFit({ width: 3508, height: 2480 }, { width: baseFront.width, height: baseFront.height });

        console.log("fitPortrait ", fitPortrait);
        console.log("fitLandscape ", fitLandscape);

        if (fitPortrait >= fitLandscape) {
            width = 2480;
            height = 3508;
            cardsPerPage = fitPortrait;
        } else {
            width = 3508;
            height = 2480;
            cardsPerPage = fitLandscape;
        }

        let numPages = Math.ceil(cardsData.length / cardsPerPage);
        let numCard = 0;

        output.resize(width, (height + 100) * numPages);


        let cardsPerLine = Math.floor(width / baseFront.width);
        let linesPerPage = Math.floor(height / baseFront.height);
        let gapH = Math.floor((width - cardsPerLine * baseFront.width) / (cardsPerLine + 1));
        let gapV = Math.floor((height - linesPerPage * baseFront.height) / (linesPerPage + 1));

        for (let i = 0; i < numPages; i++) {
            page = penpot.createBoard();
            page.name = "Page " + String(i + 1).padStart(2, '0');
            page.resize(width, height);
            page.x = output.x;
            page.y = output.y + i * (height + 100);

            x = page.x + gapH;
            y = page.y;

            for (let j = 0; j < cardsPerPage; j++) {
                if (j % cardsPerLine == 0) {
                    y += gapV;
                }

                const cardNum = String(numCard + 1);
                const frontCard = cloneCard(frontSource, cardsData[numCard], cardNum);
                const backCard = cloneCard(backSource, cardsData[numCard], cardNum);
                fitCardText(frontCard, cardsData[numCard], cardNum, warnings);
                fitCardText(backCard, cardsData[numCard], cardNum, warnings);
                card = createCardPairSheet(frontCard, backCard, true, cutMarks);
                [x, y] = addCard(page, card, x, y);
                x += gapH;
                numCard++;
                if (numCard >= cardsData.length) {
                    break;
                }
            }
            output.appendChild(page);

            console.log("page y " + page.y);
        }

    }

    tmpFront?.remove();
    tmpBack?.remove();

    if (warnings.length > 0) {
        penpot.ui.sendMessage({ "type": "FORGE_WARNINGS", "data": warnings });
    } else {
        penpot.closePlugin();
    }
}


penpot.ui.onMessage((message: PluginUIEvent) => {
    console.log("[plugin] message: ");
    console.log(message);

    if (message.type === "create-deck") {
        handleCreateDeck((message as DeckEvent));
    } else if (message.type === "save-cards-data") {
        persistCardsData(message.data);
    } else if (message.type === "load-cards-data") {
        loadCardsData();
    } else if (message.type === "load-card-fields") {
        loadCardFields();
    } else if (message.type === "import-deck-refs") {
        importDeckRefs(String(message.data?.sourcePageId ?? ""));
    } else if (message.type === "create-image-data") {
        const { data, mimeType, num, name } = message.data as {
            data: Uint8Array;
            mimeType: string;
            num: number;
            name: string;
        };
        createImage(data, mimeType, num, name);
    } else if (message.type === "forge-cards") {
        const synced = persistCardsData(message.data.cardsData);
        if (synced) {
            sendMissingCardWarningIfNeeded(synced.library, synced.manifest);
            forgeCards(resolveDeckCards(synced.library, synced.manifest), message.data.type, (message.data.cutMarks == "true"));
        }
    } else if (message.type === "is-page-empty") {
        handleIsPageEmpty();
    }


});
