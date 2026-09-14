import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectEscalationReasons,
  inspectFlagReasons,
  resolveInspectResult,
  shouldEscalateInspect,
  type InspectResult,
} from "./inspect-fallback";

const match: InspectResult = {
  verdict: "match",
  observation: "A woman stands beside a helicopter on a paved apron.",
  checked: true,
};
const noMatch: InspectResult = {
  verdict: "no_match",
  observation: "The photograph shows a street of storefronts and no aircraft.",
  checked: true,
};
const uncertain: InspectResult = {
  verdict: "uncertain",
  observation: "The scene is too small to confirm whether people stand beside aircraft.",
  checked: true,
};
const failed: InspectResult = {
  verdict: "uncertain",
  observation: "The image could not be checked reliably. Open the original to inspect it.",
  checked: false,
};

test("confident no_match on an ordinary photograph does not escalate", () => {
  assert.deepEqual(
    inspectEscalationReasons(noMatch, "mtl_archives_metadata_18557.json"),
    [],
  );
  assert.equal(
    shouldEscalateInspect(match, "mtl_archives_metadata_0.json"),
    false,
  );
});

test("cheap failures and uncertain checks escalate", () => {
  assert.deepEqual(inspectEscalationReasons(failed, "mtl_archives_metadata_1.json"), [
    "cheap_failed",
  ]);
  assert.deepEqual(
    inspectEscalationReasons(uncertain, "mtl_archives_metadata_1.json"),
    ["cheap_uncertain"],
  );
});

test("reviewed sideways A44 and document F12 escalate even after a confident cheap verdict", () => {
  assert.deepEqual(
    inspectFlagReasons("mtl_archives_metadata_12519"),
    ["reviewed_sideways"],
  );
  assert.equal(
    shouldEscalateInspect(noMatch, "mtl_archives_metadata_12519.json"),
    true,
  );
  assert.deepEqual(inspectFlagReasons("mtl_archives_metadata_15507.json"), [
    "kind_document",
  ]);
  assert.equal(
    shouldEscalateInspect(match, "mtl_archives_metadata_15507.json"),
    true,
  );
});

test("A25 is not a reviewed inspect flag and missing EXIF is not a reason", () => {
  assert.deepEqual(inspectFlagReasons("mtl_archives_metadata_0.json"), []);
  assert.equal(
    shouldEscalateInspect(match, "mtl_archives_metadata_0.json"),
    false,
  );
});

test("fallback output wins only when the stronger check completed", () => {
  const recovered = resolveInspectResult(failed, match);
  assert.equal(recovered.checked, true);
  assert.equal(recovered.verdict, "match");
  assert.equal(resolveInspectResult(noMatch, failed).verdict, "no_match");
  assert.equal(resolveInspectResult(failed, null).checked, false);
});
