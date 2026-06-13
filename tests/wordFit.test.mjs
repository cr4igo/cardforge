import assert from "node:assert/strict";
import {
  collectWordRanges,
  fitLongWordsToBox,
} from "../src/wordFit.ts";

const ranges = collectWordRanges("Bitte, Herausforderungen!\nPlan");
assert.deepEqual(ranges, [
  { word: "Bitte,", start: 0, end: 6 },
  { word: "Herausforderungen!", start: 7, end: 25 },
  { word: "Plan", start: 26, end: 30 },
]);

function createFakeText(characters, width, fontSize = 20) {
  const appliedRanges = [];
  return {
    text: {
      width,
      fontSize: String(fontSize),
      characters,
      getRange(start, end) {
        const range = { start, end, fontSize: String(fontSize) };
        appliedRanges.push(range);
        return range;
      },
    },
    appliedRanges,
  };
}

const measureByHalfEm = (word, fontSize) => ({
  width: word.length * fontSize * 0.5,
  mode: "test",
});

const unchanged = createFakeText("Kurzer Text", 200, 20);
const unchangedResult = fitLongWordsToBox(unchanged.text, { min: 8, max: 20 }, measureByHalfEm);
assert.equal(unchangedResult.warnings.length, 0);
assert.equal(unchanged.appliedRanges.length, 0);
assert.equal(unchangedResult.words.length, 0);

const shrinkable = createFakeText("Herausforderungen", 150, 20);
const shrinkResult = fitLongWordsToBox(shrinkable.text, { min: 8, max: 20 }, measureByHalfEm);
assert.equal(shrinkResult.warnings.length, 0);
assert.equal(shrinkable.appliedRanges.length, 1);
assert.equal(shrinkable.appliedRanges[0].start, 0);
assert.equal(shrinkable.appliedRanges[0].end, "Herausforderungen".length);
assert.ok(Number(shrinkable.appliedRanges[0].fontSize) < 20);
assert.ok(Number(shrinkable.appliedRanges[0].fontSize) >= 17.6);
assert.ok(Number(shrinkable.appliedRanges[0].fontSize) <= 17.7);
assert.equal(shrinkResult.words[0].word, "Herausforderungen");
assert.equal(shrinkResult.words[0].warning, false);

const overflowing = createFakeText("Superkalifragilistischexpialigetisch", 80, 20);
const overflowResult = fitLongWordsToBox(overflowing.text, { min: 8, max: 20 }, measureByHalfEm);
assert.equal(overflowing.appliedRanges.length, 1);
assert.equal(Number(overflowing.appliedRanges[0].fontSize), 8);
assert.equal(overflowResult.warnings.length, 1);
assert.equal(overflowResult.warnings[0].word, "Superkalifragilistischexpialigetisch");
assert.equal(overflowResult.warnings[0].minFontSize, 8);
assert.equal(overflowResult.words[0].warning, true);

console.log("word fit tests passed");
