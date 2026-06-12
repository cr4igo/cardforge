import assert from "node:assert/strict";
import { fitTextToBox } from "../src/textFit.ts";

function createFakeText(measure) {
  return {
    width: 100,
    height: 40,
    fontSize: "10",
    growType: "auto-height",
    get textBounds() {
      const fontSize = Number(this.fontSize);
      return {
        x: 0,
        y: 0,
        ...measure(fontSize),
      };
    },
  };
}

const maxShape = createFakeText((fontSize) => ({
  width: fontSize * 4,
  height: fontSize * 1.5,
}));
assert.equal(fitTextToBox(maxShape, { min: 6, max: 20 }), true);
assert.equal(maxShape.growType, "fixed");
assert.equal(Number(maxShape.fontSize), 20);

const shrinkingShape = createFakeText((fontSize) => ({
  width: fontSize * 8,
  height: fontSize * 2,
}));
assert.equal(fitTextToBox(shrinkingShape, { min: 6, max: 20 }), true);
assert.ok(Number(shrinkingShape.fontSize) <= 12.5);
assert.ok(Number(shrinkingShape.fontSize) >= 12.4);

const overflowingShape = createFakeText((fontSize) => ({
  width: fontSize * 40,
  height: fontSize * 10,
}));
assert.equal(fitTextToBox(overflowingShape, { min: 6, max: 20 }), false);
assert.equal(Number(overflowingShape.fontSize), 6);

console.log("text fit tests passed");
