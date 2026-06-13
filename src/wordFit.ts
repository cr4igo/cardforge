import type { TextFitConfig } from "./model";

const FIT_TOLERANCE = 0.01;
const SEARCH_STEPS = 12;

export interface WordRange {
    word: string;
    start: number;
    end: number;
}

export interface WordMeasurement {
    width: number;
    mode: string;
}

interface TextRangeFontSize {
    fontSize: string | "mixed";
}

export interface WordFittableText {
    width: number;
    fontSize: string | "mixed";
    characters?: string;
    getRange(start: number, end: number): TextRangeFontSize;
}

export type MeasureWordWidth = (
    word: string,
    fontSize: number,
    text: WordFittableText,
) => WordMeasurement | undefined;

export interface LongWordFitWordResult {
    word: string;
    start: number;
    end: number;
    boxWidth: number;
    baseFontSize: number;
    targetFontSize: number;
    measuredWidth: number;
    minMeasuredWidth: number;
    measurementMode: string;
    warning: boolean;
}

export interface LongWordFitWarning {
    word: string;
    minFontSize: number;
    wordFontSize: number;
}

export interface LongWordFitResult {
    words: LongWordFitWordResult[];
    warnings: LongWordFitWarning[];
}

export function collectWordRanges(text: string): WordRange[] {
    const ranges: WordRange[] = [];
    const wordPattern = /\S+/g;
    let match: RegExpExecArray | null;

    while ((match = wordPattern.exec(text)) !== null) {
        ranges.push({
            word: match[0],
            start: match.index,
            end: match.index + match[0].length,
        });
    }

    return ranges;
}

function setRangeFontSize(text: WordFittableText, range: WordRange, fontSize: number) {
    text.getRange(range.start, range.end).fontSize = String(Number(fontSize.toFixed(2)));
}

function parseFontSize(fontSize: string | "mixed", fallback: number) {
    const parsed = Number(fontSize);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fitsWidth(width: number, boxWidth: number) {
    return width <= boxWidth + FIT_TOLERANCE;
}

function estimateWordWidth(word: string, fontSize: number): WordMeasurement {
    return {
        width: word.length * fontSize * 0.58,
        mode: "estimate",
    };
}

function isValidMeasurement(measurement: WordMeasurement | undefined): measurement is WordMeasurement {
    return Boolean(
        measurement &&
        Number.isFinite(measurement.width) &&
        measurement.width >= 0 &&
        measurement.mode,
    );
}

function measureWord(
    text: WordFittableText,
    range: WordRange,
    fontSize: number,
    measureWordWidth?: MeasureWordWidth,
): WordMeasurement {
    const measured = measureWordWidth?.(range.word, fontSize, text);
    return isValidMeasurement(measured) ? measured : estimateWordWidth(range.word, fontSize);
}

export function fitLongWordsToBox(
    text: WordFittableText,
    fit: TextFitConfig,
    measureWordWidth?: MeasureWordWidth,
): LongWordFitResult {
    const boxWidth = Number(text.width);
    const baseFontSize = parseFontSize(text.fontSize, fit.max);
    const result: LongWordFitResult = { words: [], warnings: [] };

    if (!text.characters || !Number.isFinite(boxWidth) || boxWidth <= 0 || baseFontSize <= 0) {
        return result;
    }

    for (const range of collectWordRanges(text.characters)) {
        const baseMeasurement = measureWord(text, range, baseFontSize, measureWordWidth);
        if (fitsWidth(baseMeasurement.width, boxWidth)) {
            continue;
        }

        const minMeasurement = measureWord(text, range, fit.min, measureWordWidth);
        if (!fitsWidth(minMeasurement.width, boxWidth)) {
            setRangeFontSize(text, range, fit.min);
            result.words.push({
                ...range,
                boxWidth,
                baseFontSize,
                targetFontSize: fit.min,
                measuredWidth: baseMeasurement.width,
                minMeasuredWidth: minMeasurement.width,
                measurementMode: minMeasurement.mode,
                warning: true,
            });
            result.warnings.push({
                word: range.word,
                minFontSize: fit.min,
                wordFontSize: fit.min,
            });
            continue;
        }

        let low = fit.min;
        let high = baseFontSize;
        for (let i = 0; i < SEARCH_STEPS; i++) {
            const mid = (low + high) / 2;
            const midMeasurement = measureWord(text, range, mid, measureWordWidth);
            if (fitsWidth(midMeasurement.width, boxWidth)) {
                low = mid;
            } else {
                high = mid;
            }
        }

        setRangeFontSize(text, range, low);
        result.words.push({
            ...range,
            boxWidth,
            baseFontSize,
            targetFontSize: Number(low.toFixed(2)),
            measuredWidth: baseMeasurement.width,
            minMeasuredWidth: minMeasurement.width,
            measurementMode: minMeasurement.mode,
            warning: false,
        });
    }

    return result;
}
