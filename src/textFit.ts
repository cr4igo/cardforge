import type { TextFitConfig } from "./model";

export interface FittableText {
    width: number;
    height: number;
    fontSize: string;
    growType: "fixed" | "auto-width" | "auto-height";
    textBounds: { width: number; height: number };
}

const FIT_TOLERANCE = 0.01;
const SEARCH_STEPS = 12;

function setFontSize(text: FittableText, fontSize: number) {
    text.fontSize = String(Number(fontSize.toFixed(2)));
}

function fitsBounds(text: FittableText) {
    return (
        text.textBounds.width <= text.width + FIT_TOLERANCE &&
        text.textBounds.height <= text.height + FIT_TOLERANCE
    );
}

export function fitTextToBox(text: FittableText, fit: TextFitConfig): boolean {
    text.growType = "fixed";

    setFontSize(text, fit.min);
    if (!fitsBounds(text)) {
        return false;
    }

    setFontSize(text, fit.max);
    if (fitsBounds(text)) {
        return true;
    }

    let low = fit.min;
    let high = fit.max;
    for (let i = 0; i < SEARCH_STEPS; i++) {
        const mid = (low + high) / 2;
        setFontSize(text, mid);
        if (fitsBounds(text)) {
            low = mid;
        } else {
            high = mid;
        }
    }

    setFontSize(text, low);
    return true;
}
