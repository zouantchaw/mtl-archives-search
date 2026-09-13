import test from "node:test";
import assert from "node:assert/strict";
import { reviewState } from "./review-state.mjs";
test("legacy choices survive without fabricated new judgments", () => {
  const r = reviewState(
    { A01: "ground level", "A01-caption": "Supported overall" },
    {},
    ["A01"],
    ["accuracy", "coverage", "retrieval"],
  );
  assert.equal(r.answers["A01-caption"], "Supported overall");
  assert.deepEqual(r.missing_fields, [
    "A01-accuracy",
    "A01-coverage",
    "A01-retrieval",
  ]);
  assert.equal(r.complete, false);
});
test("partial save retains existing notes and explicit cleared answers", () => {
  const r = reviewState(
    {
      A01: "ground level",
      "A01-notes": "my note",
      "A01-accuracy": "supported",
    },
    { "A01-accuracy": "" },
    ["A01"],
    ["accuracy"],
  );
  assert.equal(r.answers["A01-notes"], "my note");
  assert.equal(r.complete, false);
});
test("completion requires all dimensions, including an explicit unsure answer", () => {
  const r = reviewState(
    {},
    {
      A01: "ground level",
      "A01-accuracy": "uncertain",
      "A01-coverage": "adequate",
      "A01-retrieval": "generic",
    },
    ["A01"],
    ["accuracy", "coverage", "retrieval"],
  );
  assert.equal(r.complete, true);
});
