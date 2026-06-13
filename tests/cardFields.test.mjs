import assert from "node:assert/strict";
import {
  applyCardDataToTree,
  collectCardFields,
} from "../src/cardFields.ts";

const front = {
  name: "Front",
  children: [
    { name: "#title", type: "text", id: "front-title" },
    { name: "#art", type: "rectangle", fills: [{ fillImage: { id: "front-art" } }], id: "front-art-node" },
  ],
};

const back = {
  name: "Back",
  children: [
    { name: "#title", type: "text", id: "back-title" },
    { name: "#backNote", type: "text", id: "back-note" },
    { name: "#art", type: "rectangle", fills: [{ fillImage: { id: "back-art" } }], id: "back-art-node" },
  ],
};

assert.deepEqual(
  collectCardFields([front, back]).map((field) => ({ name: field.name, type: field.type, id: field.id })),
  [
    { name: "#title", type: "text", id: "front-title" },
    { name: "#art", type: "image", id: "front-art-node" },
    { name: "#backNote", type: "text", id: "back-note" },
  ],
);

assert.deepEqual(
  collectCardFields([front, back]).map((field) => ({ name: field.name, side: field.side })),
  [
    { name: "#title", side: "Front" },
    { name: "#art", side: "Front" },
    { name: "#backNote", side: "Back" },
  ],
);

const frontTarget = structuredClone(front);
const backTarget = structuredClone(back);
const textAssignments = [];
const imageAssignments = [];

applyCardDataToTree(frontTarget, {
  "#title": "Wie sieht ein guter Plan aus?",
  "#art": "front|image",
}, {
  assignTextField(field, value) {
    field.characters = value;
    textAssignments.push(["front", field.name, value]);
  },
  assignImageField(field, value) {
    field.applied = value;
    imageAssignments.push(["front", field.name, value]);
  },
});

applyCardDataToTree(backTarget, {
  "#title": "Wie sieht ein guter Plan aus?",
  "#art": "back|image",
}, {
  assignTextField(field, value) {
    field.characters = value;
    textAssignments.push(["back", field.name, value]);
  },
  assignImageField(field, value) {
    field.applied = value;
    imageAssignments.push(["back", field.name, value]);
  },
});

assert.deepEqual(textAssignments, [
  ["front", "#title", "Wie sieht ein guter Plan aus?"],
  ["back", "#title", "Wie sieht ein guter Plan aus?"],
]);
assert.deepEqual(imageAssignments, [
  ["front", "#art", "front|image"],
  ["back", "#art", "back|image"],
]);
assert.equal(frontTarget.children[0].characters, "Wie sieht ein guter Plan aus?");
assert.equal(backTarget.children[0].characters, "Wie sieht ein guter Plan aus?");

console.log("card field tests passed");
