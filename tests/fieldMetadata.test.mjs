import assert from "node:assert/strict";
import { parseFieldName } from "../src/fieldMetadata.ts";

assert.deepEqual(parseFieldName("#title"), {
  name: "#title",
  shapeName: "#title",
});

assert.deepEqual(parseFieldName("#title{fit:12-48}"), {
  name: "#title",
  shapeName: "#title{fit:12-48}",
  fit: { min: 12, max: 48 },
});

assert.deepEqual(parseFieldName("#description {fit:8.5-24}"), {
  name: "#description",
  shapeName: "#description {fit:8.5-24}",
  fit: { min: 8.5, max: 24 },
});

assert.deepEqual(parseFieldName("#broken{fit:48-12}"), {
  name: "#broken{fit:48-12}",
  shapeName: "#broken{fit:48-12}",
});

assert.deepEqual(parseFieldName("#broken{fit:nope}"), {
  name: "#broken{fit:nope}",
  shapeName: "#broken{fit:nope}",
});

console.log("field metadata tests passed");
