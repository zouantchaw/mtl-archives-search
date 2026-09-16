import { test } from "node:test";
import assert from "node:assert/strict";
import { dateMatches, recordId, mergeSearchConstraints } from "./schema";
test("date constraints never invent a date for an undated photo", () => {
  assert.equal(dateMatches(null, null, null), true);
  assert.equal(dateMatches(null, null, 1950), false);
  assert.equal(dateMatches("S/O", 1900, null), false);
});
test("the whole documented interval must fit the requested period", () => {
  assert.equal(dateMatches("1932-1938", 1930, 1940), true);
  assert.equal(dateMatches("1932-1938", 1935, 1940), false);
  assert.equal(dateMatches("1930s", 1930, 1935), false);
  assert.equal(dateMatches("1930s", 1930, 1939), true);
  assert.equal(dateMatches("1950-01-02", 1950, 1950), true);
});
test("only canonical record identifiers can reach archive/image lookups", () => {
  for (const id of [
    "../../secret",
    "https://example.com/x",
    "mtl_archives_metadata_1?q=x",
  ])
    assert.equal(recordId.safeParse(id).success, false);
  assert.equal(
    recordId.safeParse("mtl_archives_metadata_17933.json").success,
    true,
  );
});
import { collectionSummary } from "./summary";
import { CURATE_QUERY, curateSearchQuery, isCuratorialIntent } from "./curate";
import type { ArchiveCollection } from "./schema";
test("result summaries cite only actual matches and never claim failed inspections succeeded", () => {
  const collection = {
    query: "women beside helicopters",
    criteria: "women beside helicopters",
    checked: 3,
    searched: 36,
    excluded: 1,
    photos: [
      { visualCheck: { status: "uncertain" } },
      { visualCheck: { status: "match" } },
    ],
  } as ArchiveCollection;
  const summary = collectionSummary(collection, "en");
  assert.match(summary, /1 appear to match.*\[2\]/);
  assert.doesNotMatch(summary, /\[1\]/);
  assert.match(summary, /1 displayed photo needs/);
  assert.match(
    collectionSummary({ ...collection, checked: 0 }, "en"),
    /No visual checks could be completed/,
  );
  const failed = collectionSummary(
    {
      ...collection,
      checked: 2,
      degraded: false,
      photos: [
        { visualCheck: { status: "failed" } },
        { visualCheck: { status: "match" } },
      ],
    } as ArchiveCollection,
    "en",
  );
  assert.match(failed, /1 appear to match.*\[2\]/);
  assert.doesNotMatch(failed, /\[1\]/);
  assert.match(failed, /failed technically/);
  assert.match(
    collectionSummary(
      { ...collection, checked: 0, degraded: true, photos: [{ visualCheck: { status: "failed" } }] } as ArchiveCollection,
      "en",
    ),
    /No visual checks could be completed/,
  );
});

import { hasRequestedDates } from "./schema";
test("follow-ups keep prior subjects unless the new query already contains them", () => {
  const merged = mergeSearchConstraints(
    "women beside helicopters",
    "only the ones standing outside",
    "women beside helicopters",
    "people standing outside",
  );
  assert.match(merged.query, /women beside helicopters/i);
  assert.match(merged.query, /standing outside/i);
  assert.match(merged.visualCriteria || "", /helicopter/i);
  const replaced = mergeSearchConstraints(
    "women beside helicopters",
    "women beside helicopters standing outside",
    "women beside helicopters",
    "women beside helicopters standing outside",
  );
  assert.equal(
    replaced.query,
    "women beside helicopters standing outside",
  );
});
test("curate summaries do not claim a hotel hanging or a visual object match", () => {
  const text = collectionSummary(
    {
      query: CURATE_QUERY,
      criteria: null,
      intent: "curate",
      checked: 0,
      searched: 36,
      excluded: 0,
      photos: [{}, {}, {}],
    } as ArchiveCollection,
    "en",
  );
  assert.match(text, /could work as prints/);
  assert.doesNotMatch(text, /appear to match/);
  assert.equal(
    curateSearchQuery("Montreal hotel lobby", "hang on the wall in a hotel"),
    CURATE_QUERY,
  );
  assert.equal(isCuratorialIntent("women beside helicopters"), false);
});
test("unrequested dates and record IDs cannot activate date filtering", () => {
  assert.equal(hasRequestedDates("women beside helicopters"), false);
  assert.equal(hasRequestedDates("mtl_archives_metadata_18557.json"), false);
  assert.equal(hasRequestedDates("before 1900"), true);
  assert.equal(hasRequestedDates("dans les années 1930"), true);
  assert.equal(hasRequestedDates("nineteenth century"), true);
});
