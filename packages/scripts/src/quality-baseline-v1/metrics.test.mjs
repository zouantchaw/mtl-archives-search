import test from "node:test";
import assert from "node:assert/strict";
import { scorePool, percentile, leakageComponents } from "./metrics.mjs";
test("unjudged results cannot become negatives or inflate precision denominator", () => {
  const x = scorePool(["unknown", "bad", "good"], ["good"], ["bad", "good"]);
  assert.equal(x.judged_precision, 0.5);
  assert.equal(x.judgment_coverage, 2 / 3);
  assert.equal(x.known_positive_recall, 1);
});
test("no known positives is unknown recall, not perfect empty-target success", () => {
  assert.equal(scorePool(["a"], [], ["a"]).known_positive_recall, null);
  assert.equal(scorePool([], ["a"], ["a"]).judged_precision, null);
});
test("duplicate returned positives cannot inflate recall", () =>
  assert.equal(
    scorePool(["a", "a"], ["a", "b"], ["a", "b"]).known_positive_recall,
    0.5,
  ));
test("nearest-rank percentile is explicit for a small sample", () => {
  assert.equal(percentile([1, 3, 2, 4], 0.95), 4);
  assert.equal(percentile([], 0.95), null);
});
test("family crossings and missing membership are not ignored", () => {
  assert.deepEqual(
    leakageComponents([
      { component_id: "f", split: "train" },
      { component_id: "f", split: "test" },
    ]),
    ["f"],
  );
  assert.throws(() => leakageComponents([{ split: "test" }]));
});
