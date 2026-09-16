import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCollection,
  encodeCollection,
  photoCanonicalId,
} from "./collection-url";

test("collection URLs round-trip canonical record ids", () => {
  assert.equal(
    encodeCollection([
      "mtl_archives_metadata_18557.json",
      "mtl_archives_metadata_1.json",
    ]),
    "18557,1",
  );
  assert.deepEqual(decodeCollection("18557,1"), [
    "mtl_archives_metadata_18557.json",
    "mtl_archives_metadata_1.json",
  ]);
  assert.equal(photoCanonicalId("../secret"), null);
});
