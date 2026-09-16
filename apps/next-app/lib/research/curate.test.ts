import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURATE_QUERY,
  curateRecords,
  curateSearchQuery,
  isCuratorialIntent,
  shouldInspectVisualCriteria,
} from "./curate";
import type { PhotoRecord } from "../types";

test("hotel-wall taste questions are curatorial and do not inspect objects", () => {
  const asked =
    "photographs that would be good to hang on the wall in high end montreal hotel";
  assert.equal(isCuratorialIntent(asked), true);
  assert.equal(
    curateSearchQuery("Montreal hotel lobby", asked),
    CURATE_QUERY,
  );
  assert.equal(
    shouldInspectVisualCriteria("hotel lobby interior", asked, "Montreal hotel lobby"),
    false,
  );
  assert.equal(
    isCuratorialIntent("photos accrocher au mur d'un hôtel à Montréal"),
    true,
  );
});

test("visible-object searches still inspect", () => {
  assert.equal(isCuratorialIntent("women beside helicopters"), false);
  assert.equal(
    shouldInspectVisualCriteria(
      "women beside helicopters",
      "Find women beside helicopters",
      "women beside helicopters",
    ),
    true,
  );
});

test("photos of hotel lobbies as the subject still inspect when not a hang-on-the-wall request", () => {
  assert.equal(isCuratorialIntent("hotel lobby interiors downtown"), false);
  assert.equal(
    shouldInspectVisualCriteria(
      "hotel lobby",
      "show hotel lobby interiors",
      "hotel lobby interiors downtown",
    ),
    true,
  );
});

test("curate drops maps and damaged scans, keeps ordinary photographs", () => {
  const photo = {
    metadataFilename: "mtl_archives_metadata_1.json",
    searchMetadata: { primaryCategory: "photograph", themes: [], searchFacets: [], excludeFromDefaultVisualSearch: false, qualityAction: null },
  } as PhotoRecord;
  const map = {
    metadataFilename: "mtl_archives_metadata_2.json",
    searchMetadata: { primaryCategory: "map", themes: [], searchFacets: [], excludeFromDefaultVisualSearch: false, qualityAction: null },
  } as PhotoRecord;
  const excluded = {
    metadataFilename: "mtl_archives_metadata_3.json",
    searchMetadata: { primaryCategory: "photograph", themes: [], searchFacets: [], excludeFromDefaultVisualSearch: true, qualityAction: null },
  } as PhotoRecord;
  const picked = curateRecords([map, excluded, photo], 12);
  assert.deepEqual(
    picked.map((p) => p.metadataFilename),
    ["mtl_archives_metadata_1.json"],
  );
});
