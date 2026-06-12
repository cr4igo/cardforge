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
    fit?: TextFitConfig;
}

export interface TextFitConfig {
    min: number;
    max: number;
}

export interface ForgeWarning {
    cardNum: number;
    fieldName: string;
    minFontSize: number;
}


export type PluginUIEvent = BaseEvent | DeckEvent;
