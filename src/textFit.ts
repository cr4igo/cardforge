import type { TextFitConfig } from "./model";

export interface FittableText {
    width: number;
    height: number;
    fontSize: string;
    growType: "fixed" | "auto-width" | "auto-height";
    characters?: string;
    lineHeight?: string;
    textBounds: { width: number; height: number };
}

const FIT_TOLERANCE = 0.01;
const STALE_BOUNDS_TOLERANCE = 0.1;
const SEARCH_STEPS = 12;

interface Bounds {
    width: number;
    height: number;
}

export interface TextFitStep {
    fontSize: number;
    measuredBounds: Bounds;
    estimatedBounds?: Bounds;
    fits: boolean;
}

export interface TextFitResult {
    fits: boolean;
    fontSize: number;
    reason: "max-fits" | "min-overflows" | "binary-search";
    usedEstimate: boolean;
    staleTextBounds: boolean;
    steps: TextFitStep[];
}

function setFontSize(text: FittableText, fontSize: number) {
    text.fontSize = String(Number(fontSize.toFixed(2)));
}

function getBounds(text: FittableText): Bounds {
    return {
        width: text.textBounds.width,
        height: text.textBounds.height,
    };
}

function fitsBounds(bounds: Bounds, box: Bounds) {
    return (
        bounds.width <= box.width + FIT_TOLERANCE &&
        bounds.height <= box.height + FIT_TOLERANCE
    );
}

function boundsAreStable(first: Bounds, second: Bounds) {
    return (
        Math.abs(first.width - second.width) <= STALE_BOUNDS_TOLERANCE &&
        Math.abs(first.height - second.height) <= STALE_BOUNDS_TOLERANCE
    );
}

function parseLineHeight(lineHeight: string | undefined, fontSize: number) {
    if (!lineHeight) {
        return fontSize * 1.2;
    }

    const value = lineHeight.trim();
    if (value.endsWith("%")) {
        const percent = Number(value.slice(0, -1));
        return Number.isFinite(percent) && percent > 0 ? fontSize * (percent / 100) : fontSize * 1.2;
    }

    const numeric = Number(value.replace("px", ""));
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fontSize * 1.2;
    }

    return numeric <= 4 ? fontSize * numeric : numeric;
}

function estimateTextBounds(text: FittableText, fontSize: number): Bounds | undefined {
    if (!text.characters) {
        return undefined;
    }

    const maxWidth = Math.max(text.width, 1);
    const averageCharWidth = fontSize * 0.58;
    const spaceWidth = fontSize * 0.35;
    const lineHeight = parseLineHeight(text.lineHeight, fontSize);
    let lines = 0;
    let widestLine = 0;

    for (const paragraph of text.characters.split(/\r?\n/)) {
        if (paragraph.trim().length === 0) {
            lines++;
            continue;
        }

        let lineWidth = 0;
        for (const word of paragraph.trim().split(/\s+/)) {
            const wordWidth = word.length * averageCharWidth;

            if (wordWidth > maxWidth) {
                if (lineWidth > 0) {
                    widestLine = Math.max(widestLine, lineWidth);
                    lines++;
                    lineWidth = 0;
                }
                const splitLines = Math.ceil(wordWidth / maxWidth);
                lines += splitLines;
                widestLine = maxWidth;
                continue;
            }

            const nextWidth = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
            if (nextWidth <= maxWidth) {
                lineWidth = nextWidth;
            } else {
                widestLine = Math.max(widestLine, lineWidth);
                lines++;
                lineWidth = wordWidth;
            }
        }

        widestLine = Math.max(widestLine, lineWidth);
        lines++;
    }

    return {
        width: widestLine,
        height: lines * lineHeight,
    };
}

function createStep(text: FittableText, fontSize: number, box: Bounds, useEstimate: boolean): TextFitStep {
    setFontSize(text, fontSize);
    const measuredBounds = getBounds(text);
    const estimatedBounds = useEstimate ? estimateTextBounds(text, fontSize) : undefined;
    return {
        fontSize: Number(text.fontSize),
        measuredBounds,
        estimatedBounds,
        fits: fitsBounds(measuredBounds, box) && (!estimatedBounds || fitsBounds(estimatedBounds, box)),
    };
}

export function fitTextToBoxWithDetails(text: FittableText, fit: TextFitConfig): TextFitResult {
    text.growType = "fixed";
    const box = { width: text.width, height: text.height };
    const steps: TextFitStep[] = [];

    const minMeasuredStep = createStep(text, fit.min, box, false);
    const maxMeasuredStep = createStep(text, fit.max, box, false);
    const staleTextBounds = Boolean(text.characters) && boundsAreStable(minMeasuredStep.measuredBounds, maxMeasuredStep.measuredBounds);
    const useEstimate = staleTextBounds;

    const minStep = createStep(text, fit.min, box, useEstimate);
    steps.push(minStep);
    if (!minStep.fits) {
        return {
            fits: false,
            fontSize: minStep.fontSize,
            reason: "min-overflows",
            usedEstimate: useEstimate,
            staleTextBounds,
            steps,
        };
    }

    const maxStep = createStep(text, fit.max, box, useEstimate);
    steps.push(maxStep);
    if (maxStep.fits) {
        return {
            fits: true,
            fontSize: maxStep.fontSize,
            reason: "max-fits",
            usedEstimate: useEstimate,
            staleTextBounds,
            steps,
        };
    }

    let low = fit.min;
    let high = fit.max;
    for (let i = 0; i < SEARCH_STEPS; i++) {
        const mid = (low + high) / 2;
        const step = createStep(text, mid, box, useEstimate);
        steps.push(step);
        if (step.fits) {
            low = mid;
        } else {
            high = mid;
        }
    }

    setFontSize(text, low);
    return {
        fits: true,
        fontSize: Number(text.fontSize),
        reason: "binary-search",
        usedEstimate: useEstimate,
        staleTextBounds,
        steps,
    };
}

export function fitTextToBox(text: FittableText, fit: TextFitConfig): boolean {
    return fitTextToBoxWithDetails(text, fit).fits;
}
