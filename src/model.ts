export interface BaseEvent {
    type: string;
    data: any;
}


export interface DeckEvent extends BaseEvent {
    name: string;
    size: string;
    orientation: string;
}

export interface CardField {
    id: string;
    name: string;
    shapeName: string;
    type: string;
    side?: string;
    fit?: TextFitConfig;
}

export interface CardFieldExtension {
    id: string;
    name: string;
    type: string;
    shapeName?: string;
    value?: any;
    fit?: TextFitConfig;
}

export interface SharedCardRecord {
    id: string;
    name: string;
    fields: Record<string, any>;
    forkedFromCardId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SharedCardLibrary {
    version: 1;
    cardsById: Record<string, SharedCardRecord>;
}

export interface DeckCardRef {
    refId: string;
    cardId: string;
    fieldExtensions: CardFieldExtension[];
}

export interface DeckManifest {
    version: 1;
    deckId: string;
    templateSignature: string;
    cardRefs: DeckCardRef[];
}

export interface ResolvedCardData extends Record<string, any> {
    __cardId: string;
    __cardRefId: string;
}

export interface FieldExtensionCollision {
    refId: string;
    cardId: string;
    fieldName: string;
}

export interface TextFitConfig {
    min: number;
    max: number;
}

export interface ForgeWarning {
    cardNum: number;
    fieldName: string;
    minFontSize: number;
    reason?: "box-overflow" | "long-word-overflow" | "missing-card" | "field-collision" | "template-mismatch";
    word?: string;
    wordFontSize?: number;
}


export type PluginUIEvent = BaseEvent | DeckEvent;
