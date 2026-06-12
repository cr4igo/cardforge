import type { TextFitConfig } from "./model";

export interface FieldMetadata {
    name: string;
    shapeName: string;
    fit?: TextFitConfig;
}

const fitPattern = /^(#[^{]+?)\s*\{fit:([0-9]+(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)?)\}$/;

export function parseFieldName(shapeName: string): FieldMetadata {
    const match = shapeName.match(fitPattern);
    if (!match) {
        return { name: shapeName, shapeName };
    }

    const min = Number(match[2]);
    const max = Number(match[3]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) {
        return { name: shapeName, shapeName };
    }

    return {
        name: match[1].trim(),
        shapeName,
        fit: { min, max },
    };
}
