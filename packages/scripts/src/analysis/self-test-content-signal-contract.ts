import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import AjvImport from "ajv";
import addFormatsImport from "ajv-formats";
import {
  CONTENT_SIGNAL_SCHEMA,
  assertProductSignalsWithinDateRange,
  identityLookupKey,
  projectAggregateEnvelope,
  validateIdentityMap,
  validateProductSignals,
} from "./content-signal-contract.js";

const identityInput = {
  platform: "instagram",
  platform_post_id: "ig-1",
  canonical_record_id: "mtl_archives_metadata_1.json",
  visual_family_id: "family-1",
  package_id:
    "2026-01-01::theme::mtl_archives_metadata_1.json::mtl_archives_image_1.jpg",
  source_asset: "mtl_archives_image_1.jpg",
  audience: "public",
  format: "carousel",
  theme: "civic memory",
  hook: "What changed?",
  caption_version: "caption-v1",
  pipeline_version: "pipeline-v1",
  model_version: "model-v1",
  prompt_version: null,
  renderer_version: "renderer-v1",
  publish_status: "published",
  platform_permalink: "https://example.test/p/ig-1",
};

const { byPost } = validateIdentityMap(
  [identityInput],
  [
    {
      metadata_filename: "mtl_archives_metadata_1.json",
      image_filename: "mtl_archives_image_1.jpg",
    },
  ],
);
const byContent = new Map(
  [...byPost.values()].map((identity) => [
    identityLookupKey(identity),
    identity,
  ]),
);

const validSignal = {
  schema_version: CONTENT_SIGNAL_SCHEMA,
  event_id: "event-1",
  signal_class: "product_behavior",
  source_type: "product_analytics",
  event_name: "search_result_clicked",
  captured_at: "2026-01-02T15:00:00Z",
  capture_time_basis: "source_event",
  timezone: "America/Toronto",
  canonical_record_id: identityInput.canonical_record_id,
  visual_family_id: identityInput.visual_family_id,
  package_id: identityInput.package_id,
  source_asset: identityInput.source_asset,
  platform: "web",
  surface: "search",
  metric_name: "click",
  metric_value: 1,
  metric_definition: "one committed result click",
  observation_window: {
    start: "2026-01-02T15:00:00Z",
    end: "2026-01-02T15:00:00Z",
  },
  source: "vercel_analytics_export",
  query: "old montreal",
  position: 0,
  candidate_set: ["mtl_archives_metadata_1.json"],
  ranking_version: "search-v1",
  model_version: "model-v1",
  index_version: "index-v1",
  experiment_assignment: null,
  propensity: null,
  safety_budget_id: null,
  privacy_consent: "pseudonymous_consent",
  evidence_kind: "synthetic_fixture",
  ground_truth_boundary: "reward_not_fact",
  identity_basis: "declared_identity",
  package_family_verification: "not_independently_verified",
};

assert.equal(validateProductSignals([validSignal], byContent).length, 1);
const schemaPath = path.resolve(
  new URL("../../../..", import.meta.url).pathname,
  "docs/dataset-factory/content-signal-schema.v1.json",
);
const identitySchemaPath = path.resolve(
  new URL("../../../..", import.meta.url).pathname,
  "docs/dataset-factory/content-identity-map-v1.json",
);
const aggregateSchemaPath = path.resolve(
  new URL("../../../..", import.meta.url).pathname,
  "docs/dataset-factory/content-aggregate-schema.v1.json",
);
const Ajv = AjvImport as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => { compile: (schema: unknown) => (value: unknown) => boolean };
const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const schemaCheck = ajv.compile(
  JSON.parse(fs.readFileSync(schemaPath, "utf8")),
);
const identitySchemaCheck = ajv.compile(
  JSON.parse(fs.readFileSync(identitySchemaPath, "utf8")),
);
const aggregateSchemaCheck = ajv.compile(
  JSON.parse(fs.readFileSync(aggregateSchemaPath, "utf8")),
);
assert.equal(identitySchemaCheck(identityInput), true);
assert.equal(
  schemaCheck(validateProductSignals([validSignal], byContent)[0]),
  true,
);
assert.equal(
  schemaCheck({
    ...validSignal,
    event_name: "photo_viewed",
    query: null,
    position: null,
    candidate_set: null,
    privacy_consent: "no_personal_data",
  }),
  true,
);
assert.equal(
  schemaCheck({ ...validSignal, privacy_consent: "no_personal_data" }),
  false,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-private-data",
          privacy_consent: "no_personal_data",
        },
      ],
      byContent,
    ),
  /no_personal_data signals must not contain raw query or candidate_set/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-invalid-provenance",
          evidence_kind: "production_export",
        },
      ],
      byContent,
    ),
  /evidence_kind is unsupported/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-invalid-capture-basis",
          capture_time_basis: "report_generation",
        },
      ],
      byContent,
    ),
  /source_event capture_time_basis/,
);
assert.equal(
  aggregateSchemaCheck({
    schema_version: CONTENT_SIGNAL_SCHEMA,
    captured_at: "2026-01-02T12:00:00Z",
    capture_time_basis: "report_generation",
    timezone: "America/Toronto",
    platform: "combined",
    observation_window: {
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-02T23:59:59Z",
    },
    signal_class: "social_behavior",
    source_type: "social_platform",
    ground_truth_boundary: "reward_not_fact",
    evidence_kind: "synthetic_fixture",
  }),
  true,
);
const emittedAggregate = {
  schema_version: CONTENT_SIGNAL_SCHEMA,
  captured_at: "2026-01-02T12:00:00Z",
  capture_time_basis: "report_generation",
  timezone: "America/Toronto",
  platform: "combined",
  observation_window: {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-02T23:59:59Z",
  },
  signal_class: "social_behavior",
  source_type: "social_platform",
  ground_truth_boundary: "reward_not_fact",
  evidence_kind: "synthetic_fixture",
  monthly_posts: 1,
  monthly_views: 10,
};
assert.equal(aggregateSchemaCheck(emittedAggregate), false);
assert.equal(
  aggregateSchemaCheck(projectAggregateEnvelope(emittedAggregate)),
  true,
);
assert.equal(
  aggregateSchemaCheck(
    projectAggregateEnvelope({
      ...emittedAggregate,
      ground_truth_boundary: "factual_label",
    }),
  ),
  false,
);
assert.throws(
  () =>
    validateIdentityMap(
      [identityInput, identityInput],
      [
        {
          metadata_filename: "mtl_archives_metadata_1.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
      ],
    ),
  /duplicate identity join/,
);
assert.throws(
  () =>
    validateIdentityMap(
      [{ ...identityInput, platform_permalink: null }],
      [
        {
          metadata_filename: "mtl_archives_metadata_1.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
      ],
    ),
  /published identity requires platform_permalink/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-2", experiment_assignment: "arm-a" }],
      byContent,
    ),
  /requires propensity/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-3", source_asset: "other.jpg" }],
      byContent,
    ),
  /identity join failed/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-4",
          ground_truth_boundary: "factual_label",
        },
      ],
      byContent,
    ),
  /reward_not_fact/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-5",
          observation_window: {
            start: "2026-01-03T00:00:00Z",
            end: "2026-01-02T00:00:00Z",
          },
        },
      ],
      byContent,
    ),
  /must not be after/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-window",
          captured_at: "2026-01-02T16:00:00Z",
        },
      ],
      byContent,
    ),
  /captured_at must fall within observation_window/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-6",
          candidate_set: [
            "mtl_archives_metadata_1.json",
            "mtl_archives_metadata_1.json",
          ],
        },
      ],
      byContent,
    ),
  /unique IDs/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-7",
          candidate_set: ["mtl_archives_metadata_2.json"],
        },
      ],
      byContent,
    ),
  /clicked canonical record must be a candidate/,
);
assert.throws(
  () =>
    validateIdentityMap(
      [
        identityInput,
        {
          ...identityInput,
          platform: "facebook",
          platform_post_id: "fb-1",
          canonical_record_id: "mtl_archives_metadata_2.json",
          platform_permalink: "https://example.test/p/fb-1",
        },
      ],
      [
        {
          metadata_filename: "mtl_archives_metadata_1.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
        {
          metadata_filename: "mtl_archives_metadata_2.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
      ],
    ),
  /conflicting content join/,
);
assert.throws(
  () =>
    validateIdentityMap(
      [
        {
          ...identityInput,
          platform_post_id: "ig-2",
          platform_permalink: "https://example.test/p/ig-2",
        },
        identityInput,
      ],
      [
        {
          metadata_filename: "mtl_archives_metadata_1.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
      ],
    ),
  /ambiguous platform-package join/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-8", surface: "photo" }],
      byContent,
    ),
  /requires search surface/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-9", position: 4 }],
      byContent,
    ),
  /clicked position/,
);
const toTorontoDate = (timestamp: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
assert.throws(
  () =>
    assertProductSignalsWithinDateRange(
      [
        {
          ...validateProductSignals([validSignal], byContent)[0],
          event_id: "event-10",
          captured_at: "2026-01-03T15:00:00Z",
        },
      ],
      "2026-01-02",
      "2026-01-02",
      toTorontoDate,
    ),
  /outside requested window.*policy=reject/,
);
assert.throws(
  () =>
    validateProductSignals(
      [
        {
          ...validSignal,
          event_id: "event-11",
          captured_at: "2026-02-31T12:00:00Z",
        },
      ],
      byContent,
    ),
  /ISO timestamp/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-12", unexpected: true }],
      byContent,
    ),
  /not allowed/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-negative", metric_value: -1 }],
      byContent,
    ),
  /finite non-negative/,
);
assert.throws(
  () =>
    validateProductSignals(
      [{ ...validSignal, event_id: "event-propensity", propensity: 0.5 }],
      byContent,
    ),
  /experiment assignment requires/,
);
assert.throws(() => {
  const { query: _query, ...missingQuery } = validSignal;
  validateProductSignals(
    [{ ...missingQuery, event_id: "event-missing-query" }],
    byContent,
  );
}, /product signal.query is required/);
assert.throws(
  () =>
    validateIdentityMap(
      [{ ...identityInput, package_id: "file:///private/package.json" }],
      [
        {
          metadata_filename: "mtl_archives_metadata_1.json",
          image_filename: "mtl_archives_image_1.jpg",
        },
      ],
    ),
  /absolute\/private filesystem path/,
);
console.log(
  JSON.stringify({
    status: "content_signal_contract_self_test_passed",
    cases: 23,
  }),
);
