import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

type J = any;
type Pin = { path: string; sha256: string; bytes: number };
type TrackedAuthorityReader = {
  readonly readWorking: (relativePath: string) => Buffer | null;
  readonly readCommitted: (relativePath: string) => Buffer | null;
};
const INTERNAL_AUTHORIZATION_CAPABILITY = Symbol(
  "reviewed-metrics-internal-authorization-capability",
);
type InternalAuthorizationCapability = {
  readonly [INTERNAL_AUTHORIZATION_CAPABILITY]: true;
  readonly pin: J;
  readonly reader: TrackedAuthorityReader;
};
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const REL = "docs/dataset-factory/fixtures/reviewed-metrics-v1";
const FIXTURE = path.join(ROOT, REL);
const SCHEMAS = path.join(
  ROOT,
  "docs/dataset-factory/schemas/reviewed-metrics-v1",
);
const REGISTRY = path.join(
  ROOT,
  "docs/dataset-factory/artifact-registry.v0.jsonl",
);
const PRODUCTION_AUTHORIZATION_PIN_REL =
  "docs/dataset-factory/authorities/reviewed-metrics-v1/production-authorization-pin-v1.json";
const PRODUCTION_AUTHORIZATION_PIN = path.join(
  ROOT,
  PRODUCTION_AUTHORIZATION_PIN_REL,
);
const PRODUCTION_REVIEWER_AUTHORIZATION_REL =
  "docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json";
const PRODUCTION_OUTPUT = "/tmp/issue92-gate-h-publication-v1";
const ID = "dfv0_reviewed_metrics_v1_candidate_20260714";
const CREATED = "2026-07-14T00:00:00.000Z";
const AUTHOR = {
  identity: "codex-sol-medium-gate-h-implementation",
  session_id: "issue92-gate-h-implementation-20260714",
  role: "candidate_metrics_and_task_author",
};
const G = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/verified-dossiers-publication-v1",
);
const PHASE_D = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/phase-d-scale-v1/candidate-selection-evidence-v1.json",
);
const GATE_F_REVIEW = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/review-ledger-v1.json",
);
const GATE_E_PROMOTION = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/promotion-ledger-v1.json",
);
const FALSE_CASES = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/ground-originals-v1/research-candidates-v1.json",
);
const TRANSCRIPTIONS = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/ground-originals-v1/reviewed-visual-transcriptions-v1.json",
);
const GROUND_REVIEW_INPUT = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/ground-originals-v1/independent-review-input-v1.json",
);
const CLAIM_REVIEW = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/ground-claim-adjudication-v1/independent-adjudication-v1.json",
);
const PILOT_PROMOTION = path.join(
  ROOT,
  "docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-visual-promotion-v1.json",
);
const Ajv2020 = Ajv2020Import as unknown as new (options: J) => J;
const addFormats = addFormatsImport as unknown as (ajv: J) => void;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function hash(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function canon(value: J): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
    .join(",")}}`;
}
function pretty(value: J): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function load(file: string): J {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file: string, value: J): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty(value));
}
function pin(
  file: string,
  relative = path.relative(ROOT, file).split(path.sep).join("/"),
): Pin {
  const bytes = fs.readFileSync(file);
  return { path: relative, sha256: hash(bytes), bytes: bytes.length };
}
function files(root: string, current = root): string[] {
  return fs
    .readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), `symlink refused: ${absolute}`);
      if (entry.isDirectory()) return files(root, absolute);
      return entry.isFile()
        ? [path.relative(root, absolute).split(path.sep).join("/")]
        : [];
    })
    .sort();
}
function tree(root: string, members = files(root)): J {
  const pins = members.map((member) => pin(path.join(root, member), member));
  return {
    members: pins,
    sha256: hash(
      `${pins.map((member) => `${member.path}\t${member.sha256}\t${member.bytes}`).join("\n")}\n`,
    ),
    bytes: pins.reduce((sum, member) => sum + member.bytes, 0),
  };
}
function same(actual: J, expected: J, label: string): void {
  assert(
    canon(actual) === canon(expected),
    `${label} differs from deterministic derivation`,
  );
}
function schema(name: string, value: J): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const gateGSchemas = path.join(
    ROOT,
    "docs/dataset-factory/schemas/verified-dossiers-v1",
  );
  for (const member of [
    "candidate-packets.schema.v1.json",
    "completed-independent-review.schema.v1.json",
  ])
    ajv.addSchema(load(path.join(gateGSchemas, member)), member);
  for (const member of fs
    .readdirSync(SCHEMAS)
    .filter((file) => file.endsWith(".json")))
    ajv.addSchema(load(path.join(SCHEMAS, member)), member);
  const validate = ajv.getSchema(name);
  assert(
    validate && validate(value),
    `${name}: ${JSON.stringify(validate?.errors)}`,
  );
}
function strictTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function predecessorPins(): J {
  return {
    phase_d: pin(PHASE_D),
    gate_e_promotion: pin(GATE_E_PROMOTION),
    gate_e_review_receipt: pin(
      path.join(
        ROOT,
        "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
      ),
    ),
    gate_f_review: pin(GATE_F_REVIEW),
    gate_f_review_receipt: pin(
      path.join(
        ROOT,
        "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/independent-source-authority-receipt-v1.json",
      ),
    ),
    gate_g_descriptor: pin(path.join(G, "publication-descriptor-v1.json")),
    gate_g_receipt: pin(path.join(G, "independent-dossier-review-v1.json")),
    gate_g_authorization: pin(path.join(G, "reviewer-authorization-v1.json")),
    gate_g_status: pin(path.join(G, "publication-status-v1.json")),
    false_precision_candidates: pin(FALSE_CASES),
    reviewed_transcriptions: pin(TRANSCRIPTIONS),
    claim_adjudication: pin(CLAIM_REVIEW),
    pilot_promotion: pin(PILOT_PROMOTION),
  };
}
function acceptedDossiers(): J[] {
  const publication = load(path.join(G, "published-dossiers-v1.json"));
  return publication.dossiers.filter(
    (dossier: J) => dossier.fully_verified === true,
  );
}
function taskFor(dossier: J): J {
  assert(
    dossier.independent_review.disposition === "accepted",
    "task dossier not accepted",
  );
  assert(
    dossier.visual_claims.length === 1 &&
      dossier.visual_claims[0].predicate === "image_mode",
    "task claim is not exact image mode",
  );
  const claim = dossier.visual_claims[0];
  const aerial = dossier.record.stratum === "aerial";
  const sourceFamily = aerial ? dossier.rights.evidence.source_family : null;
  return {
    schema_version: "reviewed_metrics_candidate_task_v1.0.0",
    task_id: `gate-h:image-mode:${dossier.record.numeric_id}`,
    task_type: "image_mode_classification",
    record: dossier.record,
    component_id: dossier.record.component_id,
    split: dossier.record.split,
    input: {
      kind: "review_pixels",
      path: `docs/dataset-factory/fixtures/verified-dossiers-publication-v1/${dossier.review_pixels.path}`,
      sha256: dossier.review_pixels.sha256,
      bytes: dossier.review_pixels.bytes,
      width: dossier.review_pixels.width,
      height: dossier.review_pixels.height,
      evidence_declaration: dossier.review_pixels.evidence_declaration,
    },
    expected: { target: "image_mode", class: claim.value },
    claim,
    claim_sha256: hash(canon(claim)),
    dossier: {
      dossier_id: dossier.dossier_id,
      disposition: dossier.independent_review.disposition,
      fully_verified: dossier.fully_verified,
      dossier_sha256: hash(canon(dossier)),
      review_receipt: pin(path.join(G, "independent-dossier-review-v1.json")),
      reviewer: dossier.independent_review.reviewer,
    },
    source_record: {
      record_url: dossier.archive_metadata.source_urls[0] ?? null,
      authority_url:
        sourceFamily?.requested_url ??
        dossier.rights.evidence.evidence?.dataset_page?.requested_url ??
        null,
      body_locator:
        sourceFamily?.private_body?.path ??
        dossier.rights.evidence.evidence?.dataset_page?.snapshot?.path ??
        null,
      body_sha256:
        sourceFamily?.private_body?.sha256 ??
        dossier.rights.evidence.evidence?.dataset_page?.snapshot?.sha256 ??
        null,
      availability: aerial
        ? "private_source_body_hash_bound"
        : "tracked_official_dataset_snapshot",
    },
    rights: dossier.rights,
    evidence_boundary: claim.boundary,
    predecessors: {
      ...dossier.predecessors,
      gate_g_publication: predecessorPins().gate_g_descriptor,
    },
    task_review: {
      required: true,
      status: "pending_external_review",
      disposition: null,
    },
  };
}
function candidateTasks(): J {
  const tasks = acceptedDossiers()
    .map(taskFor)
    .sort((a, b) => a.record.numeric_id - b.record.numeric_id);
  return {
    schema_version: "reviewed_metrics_candidate_tasks_v1.0.0",
    artifact_id: ID,
    author: AUTHOR,
    task_count: tasks.length,
    task_types: { image_mode_classification: tasks.length, other: 0 },
    excluded: {
      held_gate_g_dossiers: [8132, 8134, 8139, 8143],
      unmatched_gate_e_claims: ["c0-rpcq"],
      forbidden_task_types: [
        "ocr",
        "entity",
        "place",
        "geolocation",
        "measurement",
        "land_use",
        "search_semantic",
      ],
    },
    tasks,
  };
}
function subset(
  id: string,
  predicate: string,
  authorityFiles: string[],
  universe: string[],
  included: string[],
  denominator: string[],
  numerator: string[],
  excluded: Array<{ member_id: string; reason: string }>,
): J {
  const sorted = (values: string[]) => [...values].sort();
  const value = {
    id,
    member_id_kind: "stable_evidence_member_id",
    selection_predicate: predicate,
    authority_files: authorityFiles.map((file) => pin(file)),
    universe_member_ids: sorted(universe),
    included_member_ids: sorted(included),
    denominator_member_ids: sorted(denominator),
    numerator_member_ids: sorted(numerator),
    excluded_members: [...excluded].sort((a, b) =>
      a.member_id.localeCompare(b.member_id),
    ),
  };
  const universeSet = new Set(value.universe_member_ids);
  const includedSet = new Set(value.included_member_ids);
  assert(
    value.included_member_ids.every((member) => universeSet.has(member)) &&
      value.denominator_member_ids.every((member) => includedSet.has(member)) &&
      value.numerator_member_ids.every((member) =>
        new Set(value.denominator_member_ids).has(member),
      ) &&
      value.excluded_members.every((member) =>
        universeSet.has(member.member_id),
      ),
    `metric subset membership invalid: ${id}`,
  );
  return { ...value, subset_sha256: hash(canon(value)) };
}
function metric(
  id: string,
  status: "available" | "unavailable",
  value: number | null,
  unit: string,
  sourceSubset: J,
  reason: string,
): J {
  const denominator = sourceSubset.denominator_member_ids.length;
  const numerator =
    status === "available" ? sourceSubset.numerator_member_ids.length : null;
  return {
    metric_id: id,
    status,
    numerator,
    denominator,
    value,
    unit,
    source_subset: sourceSubset,
    exclusions: sourceSubset.excluded_members.map(
      (member: J) => `${member.member_id}: ${member.reason}`,
    ),
    zero_denominator_policy:
      denominator === 0
        ? "status_unavailable_value_null_never_coerce_to_zero"
        : "ordinary_ratio_or_count",
    reason,
  };
}
function reviewedMetrics(): J {
  const accepted = acceptedDossiers();
  const acceptedIds = accepted.map((row: J) => row.dossier_id);
  const allDossiers = load(path.join(G, "published-dossiers-v1.json")).dossiers;
  const allDossierIds = allDossiers.map((row: J) => row.dossier_id);
  const held = allDossiers.filter((row: J) => !row.fully_verified);
  const gateGFiles = [
    path.join(G, "published-dossiers-v1.json"),
    path.join(G, "independent-dossier-review-v1.json"),
  ];
  const gateFFiles = [GATE_F_REVIEW];
  const support: Record<string, number> = {
    ground_street: 0,
    aerial_vertical: 0,
    aerial_oblique: 0,
    document_map: 0,
    low_information: 0,
  };
  for (const dossier of accepted) support[dossier.visual_claims[0].value]++;
  const metrics: J[] = [];
  const reviewedCrops = load(TRANSCRIPTIONS).rows;
  const reviewInputs = load(GROUND_REVIEW_INPUT).crops;
  const cropIds = reviewedCrops.map((row: J) => row.neutral_crop_id);
  const unpairedCrops = reviewInputs
    .filter((row: J) => row.machine_ocr_proposal.text === null)
    .map((row: J) => row.neutral_crop_id);
  const cropExclusions = unpairedCrops.map((member_id: string) => ({
    member_id,
    reason:
      "reviewed reference crop has no intersecting machine OCR prediction",
  }));
  for (const id of ["ocr_normalized_exact_match", "ocr_cer", "ocr_wer"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        id === "ocr_normalized_exact_match" ? "ratio" : "error_rate",
        subset(
          "paired_ocr_prediction_reference_crops",
          "reviewed crop decision exists AND intersecting machine_ocr_proposal.text is non-null",
          [TRANSCRIPTIONS, GROUND_REVIEW_INPUT],
          cropIds,
          cropIds,
          [],
          [],
          cropExclusions,
        ),
        "Two reviewed reference crops exist, but neither has a paired machine prediction.",
      ),
    );
  const noEntity = acceptedIds.map((member_id: string) => ({
    member_id,
    reason:
      "accepted dossier retains explicit entity abstention and has no reviewed prediction/gold pair",
  }));
  for (const id of ["entity_precision", "entity_recall", "false_identity_rate"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        "ratio",
        subset(
          "reviewed_entity_prediction_gold",
          "Gate G dossier is fully_verified AND contains a reviewed entity prediction paired to entity gold",
          gateGFiles,
          acceptedIds,
          [],
          [],
          [],
          noEntity,
        ),
        "No accepted dossier contains a reviewed entity prediction/gold pair.",
      ),
    );
  metrics.push(
    metric(
      "place_link_precision",
      "unavailable",
      null,
      "ratio",
      subset(
        "accepted_dossier_place_links",
        "Gate G dossier is fully_verified AND contains an accepted dossier-level place link",
        gateGFiles,
        acceptedIds,
        [],
        [],
        [],
        acceptedIds.map((member_id: string) => ({
          member_id,
          reason: "accepted dossier has no accepted dossier-level place link",
        })),
      ),
      "No accepted place-link denominator exists.",
    ),
  );
  for (const name of Object.keys(support)) {
    const classIds = accepted
      .filter((row: J) => row.visual_claims[0].value === name)
      .map((row: J) => row.dossier_id);
    metrics.push(
      metric(
        `image_mode_support_${name}`,
        "available",
        classIds.length,
        "records",
        subset(
          `gate_g_accepted_image_mode_support_${name}`,
          `Gate G dossier is fully_verified AND accepted image_mode value equals ${name}`,
          gateGFiles,
          acceptedIds,
          acceptedIds,
          acceptedIds,
          classIds,
          [],
        ),
        "Support count from accepted Gate G labels; not model performance.",
      ),
    );
    const unpaired = classIds.map((member_id: string) => ({
      member_id,
      reason: "accepted image-mode label has no paired model prediction",
    }));
    for (const kind of ["precision", "recall"])
      metrics.push(
        metric(
          `image_mode_${name}_${kind}`,
          "unavailable",
          null,
          "ratio",
          subset(
            `paired_image_mode_predictions_gold_${name}`,
            `accepted image_mode gold equals ${name} AND paired model prediction exists`,
            gateGFiles,
            classIds,
            classIds,
            [],
            [],
            unpaired,
          ),
          "Per-class model performance is unavailable without paired predictions.",
        ),
      );
  }
  metrics.push(
    metric(
      "image_mode_macro_f1",
      "unavailable",
      null,
      "ratio",
      subset(
        "paired_image_mode_predictions_gold_macro",
        "class has at least one independently paired prediction/gold precision and recall result",
        gateGFiles,
        Object.keys(support),
        Object.keys(support),
        [],
        [],
        Object.keys(support).map((member_id) => ({
          member_id,
          reason: "class has no paired model prediction/gold metric",
        })),
      ),
      "Macro-F1 is unavailable.",
    ),
  );
  metrics.push(
    metric(
      "gate_g_reviewer_agreement",
      "available",
      1,
      "ratio",
      subset(
        "gate_g_independently_accepted_dossiers",
        "Gate G independent dossier disposition is accepted and fully_verified is true",
        gateGFiles,
        allDossierIds,
        acceptedIds,
        acceptedIds,
        acceptedIds,
        held.map((row: J) => ({
          member_id: row.dossier_id,
          reason: `independent dossier disposition is ${row.independent_review.disposition}`,
        })),
      ),
      "All 32 included labels received positive independent dossier review; this is not model performance.",
    ),
  );
  const gateFRows = load(GATE_F_REVIEW).dispositions;
  const gateFIds = gateFRows.map((row: J) => String(row.numeric_id));
  const noMask = gateFIds.map((member_id: string) => ({
    member_id,
    reason: "Gate F row has no reviewed region mask",
  }));
  for (const id of ["aerial_region_label_agreement", "aerial_mask_iou"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        "ratio",
        subset(
          "reviewed_aerial_masks",
          "Gate F row contains a reviewed region mask",
          gateFFiles,
          gateFIds,
          [],
          [],
          [],
          noMask,
        ),
        "No reviewed mask denominator exists.",
      ),
    );
  const noCoordinates = gateFIds.map((member_id: string) => ({
    member_id,
    reason: "Gate F row has no accepted verified coordinate",
  }));
  for (const id of ["geolocation_median_distance", "geolocation_p90_distance"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        "distance",
        subset(
          "accepted_verified_coordinates",
          "Gate F row has an accepted verified coordinate and paired prediction",
          gateFFiles,
          gateFIds,
          [],
          [],
          [],
          noCoordinates,
        ),
        "No verified coordinate/error sample exists.",
      ),
    );
  for (const target of [
    "location",
    "georef",
    "scale",
    "land_use",
    "measurement",
  ]) {
    const abstained = gateFRows
      .filter((row: J) => row[target] === "abstained")
      .map((row: J) => String(row.numeric_id));
    const nonAbstained = gateFIds.filter(
      (id: string) => !abstained.includes(id),
    );
    metrics.push(
      metric(
        `${target}_coverage`,
        "available",
        nonAbstained.length / gateFIds.length,
        "ratio",
        subset(
          `gate_f_${target}_coverage`,
          `Gate F ${target} disposition is not abstained`,
          gateFFiles,
          gateFIds,
          gateFIds,
          gateFIds,
          nonAbstained,
          [],
        ),
        "Coverage of accepted semantic authority in the Gate F target universe.",
      ),
    );
    metrics.push(
      metric(
        `${target}_abstention_rate`,
        "available",
        abstained.length / gateFIds.length,
        "ratio",
        subset(
          `gate_f_${target}_abstention`,
          `Gate F ${target} disposition equals abstained`,
          gateFFiles,
          gateFIds,
          gateFIds,
          gateFIds,
          abstained,
          [],
        ),
        "Explicit abstention rate in the Gate F target universe.",
      ),
    );
    metrics.push(
      metric(
        `${target}_error_among_non_abstentions`,
        "unavailable",
        null,
        "error_rate",
        subset(
          `gate_f_${target}_non_abstention_errors`,
          `Gate F ${target} disposition is not abstained AND reviewed error judgment exists`,
          gateFFiles,
          gateFIds,
          nonAbstained,
          nonAbstained,
          [],
          abstained.map((member_id: string) => ({
            member_id,
            reason: `${target} disposition is abstained`,
          })),
        ),
        "Error among non-abstentions is unavailable because the denominator is zero.",
      ),
    );
  }
  const stages = ["phase_d", "gate_e", "gate_f", "gate_g", "gate_h_candidate"];
  const unavailableStages = stages.map((member_id) => ({
    member_id,
    reason: "no tracked duration or billing evidence",
  }));
  for (const id of [
    "stage_wall_time_median",
    "stage_wall_time_p90",
    "actual_cost_per_stage",
    "actual_cost_per_record",
  ])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        id.includes("cost") ? "currency" : "duration",
        subset(
          "tracked_stage_runtime_and_billing",
          "stage has tracked actual elapsed-time or billing evidence",
          [
            PHASE_D,
            GATE_E_PROMOTION,
            GATE_F_REVIEW,
            path.join(G, "publication-descriptor-v1.json"),
          ],
          stages,
          [],
          [],
          [],
          unavailableStages,
        ),
        "Values are unavailable and are not estimated.",
      ),
    );
  return {
    schema_version: "reviewed_metrics_v1.0.0",
    artifact_id: ID,
    metrics,
    metric_count: metrics.length,
    class_support: support,
    warnings: [
      "Class support and dossier reviewer agreement are not model performance.",
      "Unavailable values are null, never false zeroes.",
    ],
  };
}
function falsePrecisionCases(): J {
  const candidates = load(FALSE_CASES).rows;
  const castrol = candidates
    .find((row: J) => row.numeric_id === 105)
    .rejected_hypotheses.find((row: J) => row.literal === "CASTROL");
  const transcriptions = load(TRANSCRIPTIONS).rows.filter(
    (row: J) => row.source_region.numeric_id === 105,
  );
  const adjudications = load(CLAIM_REVIEW).rows;
  const c105 = adjudications.find((row: J) => row.claim_id === "c105-tilden");
  const c0 = adjudications.find((row: J) => row.claim_id === "c0-lovell");
  return {
    schema_version: "reviewed_metrics_false_precision_cases_v1.0.0",
    artifact_id: ID,
    population_rate_claimed: false,
    cases: [
      {
        case_id: "castrol-catelli",
        kind: "rejected_false_precision",
        record_id: 105,
        proposed: "CASTROL",
        reviewed_result: transcriptions.find(
          (row: J) => row.source_region.region_id === "catelli-egg-noodles",
        ).literal_text,
        disposition: castrol.status,
        boundary: castrol.reason,
        evidence: [pin(FALSE_CASES), pin(TRANSCRIPTIONS)],
      },
      {
        case_id: "c105-unsupported-join",
        kind: "unsupported_entity_address_operator_join",
        record_id: 105,
        proposed: "Tilden/HERTZ address and operator join",
        reviewed_result: c105.disposition,
        disposition: "abstained",
        boundary: c105.limitations,
        evidence: [pin(CLAIM_REVIEW), pin(TRANSCRIPTIONS)],
      },
      {
        case_id: "magic-not-pixel-confirmed",
        kind: "metadata_only_identity_control",
        record_id: 0,
        proposed: "Magic Baking Powder identity",
        reviewed_result: "not_pixel_confirmed",
        disposition: "abstained",
        boundary: c0.limitations,
        evidence: [pin(CLAIM_REVIEW), pin(PHASE_D)],
      },
      {
        case_id: "held-low-information-pilots",
        kind: "low_information_control",
        record_id: null,
        proposed: "Task emission from held detail-limited pilots",
        reviewed_result: "categorically held",
        disposition: "held",
        boundary: [
          "8132, 8134, 8139, and 8143 have no accepted Gate G visual claim and emit no task.",
        ],
        evidence: [
          pin(path.join(G, "independent-dossier-review-v1.json")),
          pin(PHASE_D),
        ],
      },
    ],
  };
}
function componentAudit(tasks: J): J {
  const phase = load(PHASE_D).records;
  const splitCounts = (rows: J[]) =>
    Object.fromEntries(
      ["train", "validation", "test"].map((split) => [
        split,
        rows.filter((row) => row.split === split).length,
      ]),
    );
  const components = phase.map((row: J) => row.component_id);
  const taskComponents = tasks.tasks.map((task: J) => task.component_id);
  const phaseById = new Map<number, J>(
    phase.map((row: J) => [row.numeric_id, row]),
  );
  const crossings = (rows: J[]) => {
    const splits = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!splits.has(row.component_id))
        splits.set(row.component_id, new Set());
      splits.get(row.component_id)?.add(row.split);
    }
    return [...splits.values()].filter((value) => value.size > 1).length;
  };
  const taskSplitsMatch = tasks.tasks.every((task: J) => {
    const phaseRow = phaseById.get(task.record.numeric_id);
    return (
      phaseRow?.split === task.split &&
      phaseRow?.component_id === task.component_id
    );
  });
  return {
    schema_version: "reviewed_metrics_component_split_audit_v1.0.0",
    artifact_id: ID,
    phase_d: {
      records: phase.length,
      unique_components: new Set(components).size,
      split_counts: splitCounts(phase),
      cross_split_component_crossings: crossings(phase),
    },
    candidate_tasks: {
      records: tasks.tasks.length,
      unique_components: new Set(taskComponents).size,
      split_counts: splitCounts(tasks.tasks),
      cross_split_component_crossings: crossings(tasks.tasks),
    },
    checks: {
      phase_d_component_distinct: new Set(components).size === phase.length,
      task_component_distinct:
        new Set(taskComponents).size === tasks.tasks.length,
      task_splits_match_phase_d: taskSplitsMatch,
    },
    source: pin(PHASE_D),
  };
}
function stageCostLedger(): J {
  return {
    schema_version: "reviewed_metrics_stage_cost_evidence_v1.0.0",
    artifact_id: ID,
    audit_timestamp: CREATED,
    audit_timestamp_is_elapsed_metric: false,
    stages: ["phase_d", "gate_e", "gate_f", "gate_g", "gate_h_candidate"].map(
      (stage) => ({
        stage,
        wall_time_median: null,
        wall_time_p90: null,
        actual_cost_total: null,
        actual_cost_per_record: null,
        status: "unavailable",
        reason:
          "No tracked deterministic duration or billing evidence; values are not estimated.",
      }),
    ),
  };
}
function criterionMatrix(): J {
  const rows = [
    ["92.metrics_denominators", "satisfied", "reviewed-metrics-v1.json"],
    ["92.false_precision", "satisfied", "false-precision-cases-v1.json"],
    ["92.cost_time", "satisfied_unavailable", "stage-cost-evidence-v1.json"],
    [
      "92.accepted_tasks",
      "pending_external_task_review",
      "independent-task-review.template-v1.json",
    ],
    ["92.component_leakage", "satisfied", "component-split-audit-v1.json"],
    ["92.criterion_mapping", "satisfied", "criterion-matrix-v1.json"],
    ["92.schemas_registry_replay", "candidate_ready", "descriptor-v1.json"],
    [
      "69.process_60_records",
      "satisfied_predecessor",
      "component-split-audit-v1.json",
    ],
    [
      "69.25_verified_dossiers",
      "satisfied_predecessor",
      "reviewed-metrics-v1.json",
    ],
    [
      "69.visual_claim_regions",
      "satisfied_predecessor",
      "candidate-benchmark-tasks-v1.json",
    ],
    [
      "69.external_claim_sources",
      "not_applicable_zero_task_claims",
      "reviewed-metrics-v1.json",
    ],
    [
      "69.unsupported_claims_held",
      "satisfied",
      "false-precision-cases-v1.json",
    ],
    [
      "69.reviewed_metrics",
      "satisfied_with_unavailable_denominators",
      "reviewed-metrics-v1.json",
    ],
    ["69.false_precision", "satisfied", "false-precision-cases-v1.json"],
    [
      "69.rights_complete",
      "satisfied_predecessor",
      "candidate-benchmark-tasks-v1.json",
    ],
    [
      "69.reviewed_tasks",
      "pending_external_task_review",
      "independent-task-review.template-v1.json",
    ],
    ["69.schemas_registry", "candidate_ready", "descriptor-v1.json"],
    [
      "69.separate_dossier_reviewer",
      "satisfied_predecessor",
      "candidate-benchmark-tasks-v1.json",
    ],
  ];
  return {
    schema_version: "reviewed_metrics_criterion_matrix_v1.0.0",
    artifact_id: ID,
    issue_complete: false,
    rows: rows.map(([criterion_id, status, artifact]) => ({
      criterion_id,
      status,
      artifact,
    })),
  };
}
function runReport(tasks: J, metrics: J): J {
  return {
    schema_version: "reviewed_metrics_run_report_v1.0.0",
    artifact_id: ID,
    state: "candidate_external_task_review_required",
    issue_complete: false,
    counts: {
      phase_d_records: 60,
      gate_g_accepted_dossiers: 32,
      candidate_tasks: tasks.task_count,
      reviewed_tasks: 0,
      available_metrics: metrics.metrics.filter(
        (row: J) => row.status === "available",
      ).length,
      unavailable_metrics: metrics.metrics.filter(
        (row: J) => row.status === "unavailable",
      ).length,
      benchmark_tasks_published: 0,
      search_tasks: 0,
    },
    production_mutation: false,
    network: false,
    paid_gpu: false,
  };
}
function statusReport(tasks: J): J {
  return {
    schema_version: "reviewed_metrics_status_v1.0.0",
    artifact_id: ID,
    state: "candidate_external_task_review_required",
    candidate_tasks: tasks.task_count,
    reviewed_tasks: 0,
    accepted_tasks: 0,
    issue_complete: false,
    production_mutation: false,
    search_index_mutation: false,
    paid_gpu: false,
  };
}
function manifest(root: string, members: string[]): J {
  return {
    schema_version: "reviewed_metrics_manifest_v1.0.0",
    artifact_id: ID,
    predecessors: predecessorPins(),
    members: tree(root, members),
  };
}
function descriptor(root: string): J {
  return {
    schema_version: "reviewed_metrics_descriptor_v1.0.0",
    artifact_id: ID,
    state: "candidate_external_task_review_required",
    author: AUTHOR,
    manifest: pin(path.join(root, "manifest-v1.json"), "manifest-v1.json"),
    candidate_tasks: pin(
      path.join(root, "candidate-benchmark-tasks-v1.json"),
      "candidate-benchmark-tasks-v1.json",
    ),
    counts: load(path.join(root, "run-report-v1.json")).counts,
    issue_complete: false,
    production_mutation: false,
  };
}
function forbiddenPrincipals(): J {
  const gateG = load(path.join(G, "independent-dossier-review-v1.json"));
  const gateE = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json",
    ),
  );
  const gateF = load(
    path.join(
      ROOT,
      "docs/dataset-factory/fixtures/aerial-source-evidence-authority-v1/independent-source-authority-receipt-v1.json",
    ),
  );
  return {
    identities: [
      AUTHOR.identity,
      gateE.reviewer.identity,
      gateF.reviewer.reviewer_id,
      gateG.reviewer.reviewer_id,
      "codex-sol-medium-gate-g-implementation",
    ].sort(),
    sessions: [
      AUTHOR.session_id,
      gateE.reviewer.review_session_id,
      gateF.reviewer.session_id,
      gateG.reviewer.session_id,
      "issue91-gate-g-implementation-20260714",
    ].sort(),
  };
}
function blankReview(root: string, tasks: J): J {
  return {
    schema_version: "reviewed_metrics_task_review_template_v1.0.0",
    status: "blank_external_review_required",
    artifact_id: ID,
    candidate_descriptor: pin(
      path.join(root, "descriptor-v1.json"),
      "descriptor-v1.json",
    ),
    candidate_tasks: pin(
      path.join(root, "candidate-benchmark-tasks-v1.json"),
      "candidate-benchmark-tasks-v1.json",
    ),
    forbidden_principals: forbiddenPrincipals(),
    reviewer: {
      identity: "",
      session_id: "",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      reviewed_at: "",
      attestations: {
        no_implementation_overlap: false,
        no_candidate_author_overlap: false,
        no_gate_e_source_reviewer_overlap: false,
        no_gate_f_source_reviewer_overlap: false,
        no_gate_g_reviewer_overlap: false,
      },
    },
    dispositions: tasks.tasks.map((task: J) => ({
      task_id: task.task_id,
      task_sha256: hash(canon(task)),
      disposition: null,
      approvals: {
        exact_task_binding: false,
        claim_and_dossier_authority: false,
        component_and_split: false,
        rights_and_pixels: false,
        evidence_boundary: false,
      },
      rationale: "",
    })),
    counts: { candidates: tasks.task_count, accepted: 0, held: 0, rejected: 0 },
  };
}
function blankAuthorization(root: string, output = PRODUCTION_OUTPUT): J {
  return {
    schema_version: "reviewed_metrics_reviewer_authorization_template_v1.0.0",
    status: "blank_coordinator_authorization_required",
    candidate_artifact_id: ID,
    candidate_descriptor: pin(
      path.join(root, "descriptor-v1.json"),
      "descriptor-v1.json",
    ),
    candidate_tasks: pin(
      path.join(root, "candidate-benchmark-tasks-v1.json"),
      "candidate-benchmark-tasks-v1.json",
    ),
    review_template: pin(
      path.join(root, "independent-task-review.template-v1.json"),
      "independent-task-review.template-v1.json",
    ),
    review_scope: {
      task_ids: candidateTasks().tasks.map((task: J) => task.task_id),
      required_disposition: "accepted",
      required_accepted_count: 32,
    },
    forbidden_principals: forbiddenPrincipals(),
    approved_reviewer: {
      reviewer_id: "",
      session_id: "",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    },
    authorizing_authority: {
      identity: "",
      session_id: "",
      role: "gate_h_task_review_authority",
    },
    authorized_at: "",
    permitted_output: {
      absolute_path: output,
      basename: path.basename(output),
    },
    scope_note:
      "Blank coordinator authorization template. It grants no review or publication authority.",
  };
}
async function build(output: string): Promise<J> {
  assert(output && !fs.existsSync(output), "new output path required");
  fs.mkdirSync(output, { recursive: true });
  const tasks = candidateTasks();
  const metrics = reviewedMetrics();
  const core: Record<string, J> = {
    "reviewed-metrics-v1.json": metrics,
    "false-precision-cases-v1.json": falsePrecisionCases(),
    "candidate-benchmark-tasks-v1.json": tasks,
    "component-split-audit-v1.json": componentAudit(tasks),
    "stage-cost-evidence-v1.json": stageCostLedger(),
    "criterion-matrix-v1.json": criterionMatrix(),
    "run-report-v1.json": runReport(tasks, metrics),
    "status-report-v1.json": statusReport(tasks),
  };
  for (const [member, value] of Object.entries(core))
    writeJson(path.join(output, member), value);
  writeJson(
    path.join(output, "manifest-v1.json"),
    manifest(output, Object.keys(core).sort()),
  );
  writeJson(path.join(output, "descriptor-v1.json"), descriptor(output));
  writeJson(
    path.join(output, "independent-task-review.template-v1.json"),
    blankReview(output, tasks),
  );
  writeJson(
    path.join(output, "reviewer-authorization.template-v1.json"),
    blankAuthorization(output),
  );
  return verifyCandidate(output, false);
}
function expectedFiles(): string[] {
  return [
    "candidate-benchmark-tasks-v1.json",
    "component-split-audit-v1.json",
    "criterion-matrix-v1.json",
    "descriptor-v1.json",
    "false-precision-cases-v1.json",
    "independent-task-review.template-v1.json",
    "manifest-v1.json",
    "reviewed-metrics-v1.json",
    "run-report-v1.json",
    "stage-cost-evidence-v1.json",
    "status-report-v1.json",
    "reviewer-authorization.template-v1.json",
  ].sort();
}
function verifyRegistry(root: string): void {
  const row = fs
    .readFileSync(REGISTRY, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((value: J) => value.stable_id === ID);
  assert(row, "Gate H candidate registry row missing");
  const facts = tree(root);
  assert(
    row.storage.locator === REL &&
      row.counts.file_count === facts.members.length &&
      row.counts.byte_count === facts.bytes &&
      row.content_digest.value === facts.sha256,
    "Gate H candidate registry drift",
  );
}
function verifyMetricSemantics(metrics: J): void {
  for (const row of metrics.metrics) {
    const source = row.source_subset;
    const { subset_sha256: claimed, ...digestInput } = source;
    assert(
      hash(canon(digestInput)) === claimed,
      `metric subset digest drift: ${row.metric_id}`,
    );
    for (const authority of source.authority_files) {
      const actual = pin(path.join(ROOT, authority.path));
      same(authority, actual, `metric authority pin ${row.metric_id}`);
    }
    assert(
      row.denominator === source.denominator_member_ids.length &&
        (row.status === "unavailable"
          ? row.numerator === null && row.value === null
          : row.numerator === source.numerator_member_ids.length),
      `metric arithmetic/member count drift: ${row.metric_id}`,
    );
    if (row.status === "available" && row.unit === "ratio")
      assert(
        row.denominator > 0 && row.value === row.numerator / row.denominator,
        `metric ratio drift: ${row.metric_id}`,
      );
    if (row.status === "available" && row.unit === "records")
      assert(
        row.value === row.numerator,
        `metric count drift: ${row.metric_id}`,
      );
  }
}
function verifyCandidate(
  root: string,
  registry = root === FIXTURE,
  embedded = false,
): J {
  if (embedded)
    assert(
      expectedFiles().every((member) => fs.existsSync(path.join(root, member))),
      "embedded candidate member absent",
    );
  else same(files(root), expectedFiles(), "candidate file set");
  const tasks = candidateTasks();
  const metrics = reviewedMetrics();
  verifyMetricSemantics(load(path.join(root, "reviewed-metrics-v1.json")));
  schema(
    "candidate-tasks.schema.v1.json",
    load(path.join(root, "candidate-benchmark-tasks-v1.json")),
  );
  schema(
    "reviewed-metrics.schema.v1.json",
    load(path.join(root, "reviewed-metrics-v1.json")),
  );
  schema(
    "task-review-template.schema.v1.json",
    load(path.join(root, "independent-task-review.template-v1.json")),
  );
  schema(
    "reviewer-authorization-template.schema.v1.json",
    load(path.join(root, "reviewer-authorization.template-v1.json")),
  );
  same(
    load(path.join(root, "candidate-benchmark-tasks-v1.json")),
    tasks,
    "candidate tasks",
  );
  same(
    load(path.join(root, "reviewed-metrics-v1.json")),
    metrics,
    "reviewed metrics",
  );
  same(
    load(path.join(root, "false-precision-cases-v1.json")),
    falsePrecisionCases(),
    "false precision cases",
  );
  same(
    load(path.join(root, "component-split-audit-v1.json")),
    componentAudit(tasks),
    "component audit",
  );
  same(
    load(path.join(root, "stage-cost-evidence-v1.json")),
    stageCostLedger(),
    "stage cost ledger",
  );
  same(
    load(path.join(root, "criterion-matrix-v1.json")),
    criterionMatrix(),
    "criterion matrix",
  );
  same(
    load(path.join(root, "run-report-v1.json")),
    runReport(tasks, metrics),
    "run report",
  );
  same(
    load(path.join(root, "status-report-v1.json")),
    statusReport(tasks),
    "status report",
  );
  const core = expectedFiles().filter(
    (member) =>
      ![
        "manifest-v1.json",
        "descriptor-v1.json",
        "independent-task-review.template-v1.json",
        "reviewer-authorization.template-v1.json",
      ].includes(member),
  );
  same(
    load(path.join(root, "manifest-v1.json")),
    manifest(root, core),
    "manifest",
  );
  same(
    load(path.join(root, "descriptor-v1.json")),
    descriptor(root),
    "descriptor",
  );
  same(
    load(path.join(root, "independent-task-review.template-v1.json")),
    blankReview(root, tasks),
    "review template",
  );
  same(
    load(path.join(root, "reviewer-authorization.template-v1.json")),
    blankAuthorization(root),
    "authorization template",
  );
  assert(
    tasks.task_count === 32 &&
      new Set(tasks.tasks.map((task: J) => task.component_id)).size === 32,
    "task count/component distinctness drift",
  );
  const audit = componentAudit(tasks);
  assert(
    audit.phase_d.cross_split_component_crossings === 0 &&
      audit.candidate_tasks.cross_split_component_crossings === 0 &&
      Object.values(audit.checks).every(Boolean),
    "component/split audit failed",
  );
  assert(
    tasks.tasks.every(
      (task: J) =>
        task.task_review.status === "pending_external_review" &&
        task.task_review.disposition === null,
    ),
    "candidate claims accepted task review",
  );
  if (registry) verifyRegistry(root);
  const facts = tree(root);
  return {
    status: "verified_candidate",
    files: facts.members.length,
    bytes: facts.bytes,
    tree_sha256: facts.sha256,
    candidate_tasks: 32,
    reviewed_tasks: 0,
    issue_complete: false,
    production_mutation: false,
    paid_gpu: false,
  };
}
async function verify(root: string): Promise<J> {
  const result = verifyCandidate(root);
  const replay = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h-replay-"));
  fs.rmSync(replay, { recursive: true });
  try {
    await build(replay);
    for (const member of files(root))
      assert(
        fs
          .readFileSync(path.join(root, member))
          .equals(fs.readFileSync(path.join(replay, member))),
        `offline replay drift: ${member}`,
      );
    return { ...result, deterministic_replay: true };
  } finally {
    fs.rmSync(replay, { recursive: true, force: true });
  }
}
function committedBytes(relativePath: string): Buffer | null {
  try {
    return execFileSync("git", ["show", `HEAD:${relativePath}`], {
      cwd: ROOT,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
const productionAuthorityReader: TrackedAuthorityReader = {
  readWorking: (relativePath) => {
    const absolute = path.join(ROOT, relativePath);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute) : null;
  },
  readCommitted: committedBytes,
};
function memoryAuthorityReader(bytes: Buffer): TrackedAuthorityReader {
  return {
    readWorking: (relativePath) =>
      relativePath === PRODUCTION_REVIEWER_AUTHORIZATION_REL ? bytes : null,
    readCommitted: (relativePath) =>
      relativePath === PRODUCTION_REVIEWER_AUTHORIZATION_REL ? bytes : null,
  };
}
function syntheticAuthorization(candidate: string, output: string): J {
  return {
    ...blankAuthorization(candidate, output),
    schema_version: "reviewed_metrics_reviewer_authorization_v1.0.0",
    status: "authorized",
    approved_reviewer: {
      reviewer_id: "synthetic-gate-h-reviewer-test-only",
      session_id: "synthetic-gate-h-review-session-test-only",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
    },
    authorizing_authority: {
      identity: "synthetic-gate-h-coordinator-test-only",
      session_id: "synthetic-gate-h-coordinator-session-test-only",
      role: "gate_h_task_review_authority",
    },
    authorized_at: "2026-07-14T22:00:00Z",
    scope_note:
      "Synthetic internal test authorization. It is not reachable through the production CLI authority loader.",
  };
}
function activeAuthorizationPin(
  candidate: string,
  bytes: Buffer,
  authorization: J,
): J {
  return {
    schema_version: "reviewed_metrics_production_authorization_pin_v1.0.0",
    authority_id: "gate-h-production-authorization-pin",
    state: "active",
    candidate_artifact_id: ID,
    candidate_descriptor_sha256: pin(path.join(candidate, "descriptor-v1.json"))
      .sha256,
    authorization_file: {
      path: PRODUCTION_REVIEWER_AUTHORIZATION_REL,
      sha256: hash(bytes),
      bytes: bytes.length,
    },
    approved_reviewer: authorization.approved_reviewer,
    authorizing_authority: authorization.authorizing_authority,
    authorized_at: authorization.authorized_at,
    permitted_output: authorization.permitted_output,
    scope_note:
      "Synthetic internal test pin. It is accepted only through the unexported symbol-gated test capability.",
  };
}
function internalAuthorizationCapability(
  candidate: string,
  authorizationFile: string,
): InternalAuthorizationCapability {
  const bytes = fs.readFileSync(authorizationFile);
  const authorization = JSON.parse(bytes.toString("utf8"));
  return {
    [INTERNAL_AUTHORIZATION_CAPABILITY]: true,
    pin: activeAuthorizationPin(candidate, bytes, authorization),
    reader: memoryAuthorityReader(bytes),
  };
}
function validateAuthorizationDocument(
  candidate: string,
  authorization: J,
  pinValue: J,
): void {
  schema("reviewer-authorization.schema.v1.json", authorization);
  const template = blankAuthorization(
    candidate,
    authorization.permitted_output.absolute_path,
  );
  same(
    authorization.candidate_descriptor,
    template.candidate_descriptor,
    "authorization descriptor",
  );
  same(
    authorization.candidate_tasks,
    template.candidate_tasks,
    "authorization tasks",
  );
  same(
    authorization.review_template,
    template.review_template,
    "authorization review template",
  );
  same(
    authorization.review_scope,
    template.review_scope,
    "authorization scope",
  );
  same(
    authorization.forbidden_principals,
    template.forbidden_principals,
    "authorization forbidden principals",
  );
  assert(
    authorization.permitted_output.absolute_path ===
      path.resolve(authorization.permitted_output.absolute_path) &&
      authorization.permitted_output.basename ===
        path.basename(authorization.permitted_output.absolute_path),
    "authorization output route invalid",
  );
  const reviewer = authorization.approved_reviewer;
  const authority = authorization.authorizing_authority;
  const principals = [
    reviewer.reviewer_id,
    reviewer.session_id,
    authority.identity,
    authority.session_id,
  ];
  const blocked = new Set([
    ...template.forbidden_principals.identities,
    ...template.forbidden_principals.sessions,
  ]);
  assert(
    principals.every(
      (value: string) => value.length > 0 && value.trim() === value,
    ) &&
      new Set(principals).size === principals.length &&
      principals.every((value: string) => !blocked.has(value)),
    "authorization principal route invalid",
  );
  assert(
    reviewer.model === "gpt-5.6-sol" &&
      reviewer.reasoning_effort === "high" &&
      authority.role === "gate_h_task_review_authority" &&
      strictTime(authorization.authorized_at) &&
      Date.parse(authorization.authorized_at) >= Date.parse(CREATED),
    "authorization reviewer, authority, or timestamp invalid",
  );
  same(pinValue.approved_reviewer, reviewer, "pin reviewer route");
  same(pinValue.authorizing_authority, authority, "pin authority route");
  same(
    pinValue.permitted_output,
    authorization.permitted_output,
    "pin output route",
  );
  assert(
    pinValue.authorized_at === authorization.authorized_at,
    "pin timestamp drift",
  );
}
function verifyTrackedAuthorizationAuthority(
  candidate: string,
  pinValue: J,
  reader: TrackedAuthorityReader,
): J {
  schema("production-authorization-pin.schema.v1.json", pinValue);
  assert(
    pinValue.candidate_artifact_id === ID,
    "authorization pin artifact drift",
  );
  const working = reader.readWorking(PRODUCTION_REVIEWER_AUTHORIZATION_REL);
  const committed = reader.readCommitted(PRODUCTION_REVIEWER_AUTHORIZATION_REL);
  if (pinValue.state === "unconfigured") {
    assert(
      pinValue.candidate_descriptor_sha256 === null &&
        pinValue.authorization_file === null &&
        pinValue.approved_reviewer === null &&
        pinValue.authorizing_authority === null &&
        pinValue.authorized_at === null &&
        pinValue.permitted_output === null,
      "unconfigured authorization pin is not fail-closed",
    );
    assert(
      working === null && committed === null,
      "unconfigured authorization file must be absent",
    );
    return { pin: pinValue, authorization: null, authorizationBytes: null };
  }
  assert(
    working && committed,
    "tracked authorization is absent or uncommitted",
  );
  assert(
    working.equals(committed),
    "tracked authorization differs from committed HEAD bytes",
  );
  same(
    pinValue.authorization_file,
    {
      path: PRODUCTION_REVIEWER_AUTHORIZATION_REL,
      sha256: hash(committed),
      bytes: committed.length,
    },
    "authorization file pin",
  );
  assert(
    pinValue.candidate_descriptor_sha256 ===
      pin(path.join(candidate, "descriptor-v1.json")).sha256,
    "pin candidate descriptor drift",
  );
  const authorization = JSON.parse(committed.toString("utf8"));
  validateAuthorizationDocument(candidate, authorization, pinValue);
  return { pin: pinValue, authorization, authorizationBytes: committed };
}
function loadProductionAuthorizationAuthority(candidate: string): J {
  const working = fs.readFileSync(PRODUCTION_AUTHORIZATION_PIN);
  const committed = committedBytes(PRODUCTION_AUTHORIZATION_PIN_REL);
  assert(committed, "production authorization pin is not committed at HEAD");
  assert(
    working.equals(committed),
    "production authorization pin differs from committed HEAD bytes",
  );
  return verifyTrackedAuthorizationAuthority(
    candidate,
    JSON.parse(committed.toString("utf8")),
    productionAuthorityReader,
  );
}
function resolveAuthorizationAuthority(
  candidate: string,
  capability?: InternalAuthorizationCapability,
): J {
  if (!capability) return loadProductionAuthorizationAuthority(candidate);
  assert(
    capability[INTERNAL_AUTHORIZATION_CAPABILITY] === true,
    "invalid internal authorization capability",
  );
  return verifyTrackedAuthorizationAuthority(
    candidate,
    capability.pin,
    capability.reader,
  );
}
function validateAuthorization(
  candidate: string,
  authorizationFile: string,
  receipt: J | null,
  capability?: InternalAuthorizationCapability,
): J {
  const supplied = fs.readFileSync(authorizationFile);
  const authority = resolveAuthorizationAuthority(candidate, capability);
  assert(
    authority.pin.state === "active",
    "production authorization pin is unconfigured",
  );
  assert(
    authority.authorizationBytes &&
      authority.authorization &&
      supplied.equals(authority.authorizationBytes),
    "supplied authorization differs from tracked committed authority bytes",
  );
  if (receipt) {
    assert(
      receipt.authorization_sha256 === hash(supplied),
      "receipt authorization hash drift",
    );
    const reviewer = authority.authorization.approved_reviewer;
    assert(
      receipt.reviewer.identity === reviewer.reviewer_id &&
        receipt.reviewer.session_id === reviewer.session_id &&
        receipt.reviewer.model === reviewer.model &&
        receipt.reviewer.reasoning_effort === reviewer.reasoning_effort,
      "receipt reviewer differs from authorized route",
    );
    assert(
      Date.parse(receipt.reviewer.reviewed_at) >
        Date.parse(authority.authorization.authorized_at),
      "receipt does not postdate authorization",
    );
  }
  return authority.authorization;
}
function validateReview(
  candidate: string,
  receiptFile: string,
  authorizationFile: string,
  embedded = false,
  capability?: InternalAuthorizationCapability,
): J {
  verifyCandidate(candidate, false, embedded);
  const receipt = load(receiptFile);
  schema("task-review-receipt.schema.v1.json", receipt);
  const authorization = validateAuthorization(
    candidate,
    authorizationFile,
    receipt,
    capability,
  );
  const tasks = load(path.join(candidate, "candidate-benchmark-tasks-v1.json"));
  const template = blankReview(candidate, tasks);
  assert(
    receipt.candidate_descriptor_sha256 ===
      pin(path.join(candidate, "descriptor-v1.json")).sha256 &&
      receipt.candidate_tasks_sha256 ===
        pin(path.join(candidate, "candidate-benchmark-tasks-v1.json")).sha256,
    "review candidate binding drift",
  );
  const blocked = new Set([
    ...template.forbidden_principals.identities,
    ...template.forbidden_principals.sessions,
  ]);
  assert(
    !blocked.has(receipt.reviewer.identity) &&
      !blocked.has(receipt.reviewer.session_id) &&
      receipt.reviewer.identity !== receipt.reviewer.session_id,
    "task reviewer is forbidden or invalid",
  );
  assert(
    strictTime(receipt.reviewer.reviewed_at) &&
      Object.values(receipt.reviewer.attestations).every(Boolean),
    "reviewer time/attestations invalid",
  );
  same(
    receipt.dispositions.map((row: J) => ({
      task_id: row.task_id,
      task_sha256: row.task_sha256,
    })),
    template.dispositions.map((row: J) => ({
      task_id: row.task_id,
      task_sha256: row.task_sha256,
    })),
    "review task bindings",
  );
  for (const row of receipt.dispositions) {
    if (row.disposition === "accepted")
      assert(
        Object.values(row.approvals).every(Boolean),
        `accepted task approvals incomplete: ${row.task_id}`,
      );
    assert(
      row.rationale.trim().length > 0,
      `review rationale absent: ${row.task_id}`,
    );
  }
  const counts = {
    candidates: 32,
    accepted: receipt.dispositions.filter(
      (row: J) => row.disposition === "accepted",
    ).length,
    held: receipt.dispositions.filter((row: J) => row.disposition === "held")
      .length,
    rejected: receipt.dispositions.filter(
      (row: J) => row.disposition === "rejected",
    ).length,
  };
  same(receipt.counts, counts, "review counts");
  return { receipt, tasks, counts, authorization };
}
function derivePublishedTasks(tasks: J, receipt: J, receiptBytes: Buffer): J {
  const dispositions = new Map<string, J>(
    receipt.dispositions.map((row: J) => [row.task_id, row]),
  );
  return {
    schema_version: "reviewed_metrics_published_tasks_v1.0.0",
    source_artifact_id: ID,
    review_receipt_sha256: hash(receiptBytes),
    accepted_tasks: tasks.tasks
      .filter(
        (task: J) => dispositions.get(task.task_id).disposition === "accepted",
      )
      .map((task: J) => ({
        ...task,
        task_review: {
          required: true,
          status: "accepted_external_review",
          disposition: "accepted",
          reviewer: receipt.reviewer,
          rationale: dispositions.get(task.task_id).rationale,
        },
      })),
    retained: receipt.dispositions.filter(
      (row: J) => row.disposition !== "accepted",
    ),
  };
}
function publicationStatus(counts: J): J {
  assert(
    counts.candidates === 32 &&
      counts.accepted === 32 &&
      counts.held === 0 &&
      counts.rejected === 0,
    "authoritative publication requires all 32 tasks accepted",
  );
  return {
    schema_version: "reviewed_metrics_publication_status_v1.0.0",
    state: "published_external_task_review",
    counts: {
      ...counts,
      reviewed_tasks: counts.accepted + counts.held + counts.rejected,
      published_tasks: counts.accepted,
      search_tasks: 0,
    },
    issue_complete: true,
    production_mutation: false,
    search_index_mutation: false,
    paid_gpu: false,
  };
}
function finalCriterionMatrix(counts: J): J {
  publicationStatus(counts);
  const candidate = criterionMatrix();
  return {
    ...candidate,
    schema_version: "reviewed_metrics_final_criterion_matrix_v1.0.0",
    issue_complete: true,
    rows: candidate.rows.map((row: J) => ({
      ...row,
      status:
        row.status === "pending_external_task_review"
          ? "satisfied_all_32_externally_accepted"
          : row.status === "candidate_ready"
            ? "satisfied"
            : row.status,
    })),
    task_review_result: {
      candidates: 32,
      reviewed: 32,
      accepted: 32,
      held: 0,
      rejected: 0,
    },
  };
}
function publicationFiles(): string[] {
  return [
    ...expectedFiles(),
    "independent-task-review-v1.json",
    "reviewer-authorization-v1.json",
    "published-benchmark-tasks-v1.json",
    "publication-status-v1.json",
    "final-criterion-matrix-v1.json",
    "final-descriptor-v1.json",
    "publication-commit-v1.json",
  ].sort();
}
function finalDescriptor(output: string, counts: J): J {
  const members = files(output).filter(
    (member) =>
      !["final-descriptor-v1.json", "publication-commit-v1.json"].includes(
        member,
      ),
  );
  return {
    schema_version: "reviewed_metrics_final_descriptor_v1.0.0",
    artifact_id: ID,
    state: "published_external_task_review",
    counts,
    review_receipt: pin(
      path.join(output, "independent-task-review-v1.json"),
      "independent-task-review-v1.json",
    ),
    reviewer_authorization: pin(
      path.join(output, "reviewer-authorization-v1.json"),
      "reviewer-authorization-v1.json",
    ),
    members: tree(output, members),
    production_mutation: false,
  };
}
function publicationCommit(output: string, receipt: J): J {
  return {
    schema_version: "reviewed_metrics_publication_commit_v1.0.0",
    state: "committed",
    receipt: pin(
      path.join(output, "independent-task-review-v1.json"),
      "independent-task-review-v1.json",
    ),
    descriptor: pin(
      path.join(output, "final-descriptor-v1.json"),
      "final-descriptor-v1.json",
    ),
    committed_at: receipt.reviewer.reviewed_at,
  };
}
async function publish(
  candidate: string,
  receiptFile: string,
  authorizationFile: string,
  output: string,
  capability?: InternalAuthorizationCapability,
): Promise<J> {
  assert(!fs.existsSync(output), "publication destination exists");
  const validated = validateReview(
    candidate,
    receiptFile,
    authorizationFile,
    false,
    capability,
  );
  publicationStatus(validated.counts);
  assert(
    path.resolve(output) ===
      validated.authorization.permitted_output.absolute_path &&
      path.basename(output) ===
        validated.authorization.permitted_output.basename,
    "publication output differs from authorized route",
  );
  const staging = fs.mkdtempSync(
    path.join(path.dirname(output), ".gate-h-publish-"),
  );
  let reserved = false;
  try {
    fs.cpSync(candidate, staging, { recursive: true });
    fs.copyFileSync(
      receiptFile,
      path.join(staging, "independent-task-review-v1.json"),
    );
    fs.copyFileSync(
      authorizationFile,
      path.join(staging, "reviewer-authorization-v1.json"),
    );
    const receiptBytes = fs.readFileSync(receiptFile);
    writeJson(
      path.join(staging, "published-benchmark-tasks-v1.json"),
      derivePublishedTasks(validated.tasks, validated.receipt, receiptBytes),
    );
    writeJson(
      path.join(staging, "publication-status-v1.json"),
      publicationStatus(validated.counts),
    );
    writeJson(
      path.join(staging, "final-criterion-matrix-v1.json"),
      finalCriterionMatrix(validated.counts),
    );
    writeJson(
      path.join(staging, "final-descriptor-v1.json"),
      finalDescriptor(staging, validated.counts),
    );
    writeJson(
      path.join(staging, "publication-commit-v1.json"),
      publicationCommit(staging, validated.receipt),
    );
    verifyPublished(staging, authorizationFile, capability, false);
    fs.mkdirSync(output);
    reserved = true;
    const commit = "publication-commit-v1.json";
    for (const member of files(staging).filter((member) => member !== commit)) {
      const destination = path.join(output, member);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(path.join(staging, member), destination);
    }
    fs.renameSync(path.join(staging, commit), path.join(output, commit));
    return verifyPublished(output, authorizationFile, capability);
  } catch (error) {
    if (reserved) fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
function verifyPublished(
  output: string,
  authorizationFile: string,
  capability?: InternalAuthorizationCapability,
  enforceOutputRoute = true,
): J {
  assert(
    fs.existsSync(path.join(output, "publication-commit-v1.json")),
    "publication commit absent",
  );
  const validated = validateReview(
    output,
    path.join(output, "independent-task-review-v1.json"),
    authorizationFile,
    true,
    capability,
  );
  if (enforceOutputRoute)
    assert(
      path.resolve(output) ===
        validated.authorization.permitted_output.absolute_path &&
        path.basename(output) ===
          validated.authorization.permitted_output.basename,
      "published output differs from authorized route",
    );
  assert(
    fs
      .readFileSync(authorizationFile)
      .equals(
        fs.readFileSync(path.join(output, "reviewer-authorization-v1.json")),
      ),
    "published authorization bytes differ from supplied authority",
  );
  const receiptBytes = fs.readFileSync(
    path.join(output, "independent-task-review-v1.json"),
  );
  const published = derivePublishedTasks(
    validated.tasks,
    validated.receipt,
    receiptBytes,
  );
  schema(
    "published-tasks.schema.v1.json",
    load(path.join(output, "published-benchmark-tasks-v1.json")),
  );
  same(
    load(path.join(output, "final-criterion-matrix-v1.json")),
    finalCriterionMatrix(validated.counts),
    "final criterion matrix",
  );
  same(
    load(path.join(output, "published-benchmark-tasks-v1.json")),
    published,
    "published tasks",
  );
  same(
    load(path.join(output, "publication-status-v1.json")),
    publicationStatus(validated.counts),
    "publication status",
  );
  same(
    load(path.join(output, "final-descriptor-v1.json")),
    finalDescriptor(output, validated.counts),
    "final descriptor",
  );
  same(
    load(path.join(output, "publication-commit-v1.json")),
    publicationCommit(output, validated.receipt),
    "publication commit",
  );
  same(files(output), publicationFiles(), "publication files");
  const facts = tree(output);
  return {
    status: "verified_published",
    accepted_tasks: validated.counts.accepted,
    held_tasks: validated.counts.held,
    rejected_tasks: validated.counts.rejected,
    files: facts.members.length,
    bytes: facts.bytes,
    tree_sha256: facts.sha256,
    production_mutation: false,
    paid_gpu: false,
  };
}
function syntheticReceipt(candidate: string, authorizationFile: string): J {
  const tasks = load(path.join(candidate, "candidate-benchmark-tasks-v1.json"));
  const template = blankReview(candidate, tasks);
  return {
    schema_version: "reviewed_metrics_task_review_receipt_v1.0.0",
    status: "completed",
    authorization_sha256: hash(fs.readFileSync(authorizationFile)),
    candidate_descriptor_sha256: template.candidate_descriptor.sha256,
    candidate_tasks_sha256: template.candidate_tasks.sha256,
    reviewer: {
      identity: "synthetic-gate-h-reviewer-test-only",
      session_id: "synthetic-gate-h-review-session-test-only",
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      reviewed_at: "2026-07-14T23:00:00Z",
      attestations: {
        no_implementation_overlap: true,
        no_candidate_author_overlap: true,
        no_gate_e_source_reviewer_overlap: true,
        no_gate_f_source_reviewer_overlap: true,
        no_gate_g_reviewer_overlap: true,
      },
    },
    dispositions: template.dispositions.map((row: J) => ({
      ...row,
      disposition: "accepted",
      approvals: {
        exact_task_binding: true,
        claim_and_dossier_authority: true,
        component_and_split: true,
        rights_and_pixels: true,
        evidence_boundary: true,
      },
      rationale:
        "Synthetic integration-only acceptance; not external review authority.",
    })),
    counts: { candidates: 32, accepted: 32, held: 0, rejected: 0 },
  };
}
async function selfTest(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h-self-"));
  let cases = 0,
    rejected = 0;
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    verifyCandidate(candidate, false);
    cases++;
    const productionAuthority = loadProductionAuthorizationAuthority(candidate);
    const productionState = productionAuthority.pin.state;
    if (productionState === "unconfigured") {
      assert(
        productionAuthority.authorization === null &&
          productionAuthority.authorizationBytes === null,
        "unconfigured production authority exposed authorization bytes",
      );
    } else {
      assert(
        productionState === "active" &&
          productionAuthority.authorization &&
          productionAuthority.authorizationBytes,
        "active production authority is incomplete",
      );
      const trackedAuthorization = productionAuthority.authorization;
      const trackedAuthorizationBytes = productionAuthority.authorizationBytes;
      const expectedAuthorization = blankAuthorization(
        candidate,
        trackedAuthorization.permitted_output.absolute_path,
      );
      same(
        trackedAuthorization.candidate_descriptor,
        expectedAuthorization.candidate_descriptor,
        "active authority candidate descriptor",
      );
      same(
        trackedAuthorization.candidate_tasks,
        expectedAuthorization.candidate_tasks,
        "active authority task packet",
      );
      same(
        trackedAuthorization.review_template,
        expectedAuthorization.review_template,
        "active authority review template",
      );
      same(
        trackedAuthorization.review_scope,
        expectedAuthorization.review_scope,
        "active authority task scope",
      );
      same(
        trackedAuthorization.forbidden_principals,
        expectedAuthorization.forbidden_principals,
        "active authority forbidden principals",
      );
      same(
        productionAuthority.pin.approved_reviewer,
        trackedAuthorization.approved_reviewer,
        "active authority reviewer route",
      );
      same(
        productionAuthority.pin.authorizing_authority,
        trackedAuthorization.authorizing_authority,
        "active authority coordinator route",
      );
      same(
        productionAuthority.pin.permitted_output,
        trackedAuthorization.permitted_output,
        "active authority output route",
      );
      assert(
        productionAuthority.pin.authorized_at ===
          trackedAuthorization.authorized_at,
        "active authority timestamp drift",
      );
      const activePinMutations: Array<[string, (value: J) => void]> = [
        [
          "active pin authorization hash",
          (value) => {
            value.authorization_file.sha256 = "0".repeat(64);
          },
        ],
        [
          "active pin candidate descriptor",
          (value) => {
            value.candidate_descriptor_sha256 = "0".repeat(64);
          },
        ],
        [
          "active pin reviewer route",
          (value) => {
            value.approved_reviewer.reviewer_id = "forged-reviewer";
          },
        ],
        [
          "active pin output route",
          (value) => {
            value.permitted_output.basename = "forged-publication";
          },
        ],
      ];
      for (const [name, mutate] of activePinMutations) {
        const mutatedPin = structuredClone(productionAuthority.pin);
        mutate(mutatedPin);
        let failed = false;
        try {
          verifyTrackedAuthorizationAuthority(
            candidate,
            mutatedPin,
            memoryAuthorityReader(trackedAuthorizationBytes),
          );
        } catch {
          failed = true;
        }
        assert(failed, `${name} mutation passed`);
        cases++;
        rejected++;
      }
      const mutatedAuthorization = structuredClone(trackedAuthorization);
      mutatedAuthorization.review_scope.task_ids.pop();
      const mutatedAuthorizationBytes = Buffer.from(
        pretty(mutatedAuthorization),
      );
      const mutatedAuthorizationPin = activeAuthorizationPin(
        candidate,
        mutatedAuthorizationBytes,
        mutatedAuthorization,
      );
      let failed = false;
      try {
        verifyTrackedAuthorizationAuthority(
          candidate,
          mutatedAuthorizationPin,
          memoryAuthorityReader(mutatedAuthorizationBytes),
        );
      } catch {
        failed = true;
      }
      assert(failed, "active authorization task-scope mutation passed");
      cases++;
      rejected++;
    }
    cases++;
    const mutations: Array<[string, string, (value: J) => void]> = [
      [
        "metric numerator",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics.find(
            (m: J) => m.metric_id === "location_coverage",
          ).numerator = 1;
        },
      ],
      [
        "metric denominator",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].denominator = 1;
        },
      ],
      [
        "metric exclusion",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].exclusions = [];
        },
      ],
      [
        "unavailable to zero",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].status = "available";
          v.metrics[0].value = 0;
        },
      ],
      [
        "fake OCR pairing",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].source_subset.id = "fake_pair";
        },
      ],
      [
        "subset universe substitution",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].source_subset.universe_member_ids[0] = "forged-crop";
        },
      ],
      [
        "subset included omission",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].source_subset.included_member_ids.pop();
        },
      ],
      [
        "subset denominator extra",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].source_subset.denominator_member_ids.push(
            "ground-crop-01",
          );
        },
      ],
      [
        "subset excluded member substitution",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics[0].source_subset.excluded_members[0].member_id =
            "ground-crop-02";
        },
      ],
      [
        "held task",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].record.numeric_id = 8132;
        },
      ],
      [
        "claim substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].claim.value = "document_map";
        },
      ],
      [
        "claim hash substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].claim_sha256 = "0".repeat(64);
        },
      ],
      [
        "source substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].source_record.record_url = "https://example.invalid";
        },
      ],
      [
        "dossier substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].dossier.dossier_id = "wrong";
        },
      ],
      [
        "component substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].component_id = v.tasks[1].component_id;
        },
      ],
      [
        "split substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].split = "test";
        },
      ],
      [
        "rights substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].rights.complete = false;
        },
      ],
      [
        "pixels substitution",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].input.sha256 = "0".repeat(64);
        },
      ],
      [
        "geolocation task",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].task_type = "geolocation";
        },
      ],
      [
        "measurement task",
        "candidate-benchmark-tasks-v1.json",
        (v) => {
          v.tasks[0].task_type = "measurement";
        },
      ],
      [
        "CASTROL promotion",
        "false-precision-cases-v1.json",
        (v) => {
          v.cases[0].disposition = "accepted";
        },
      ],
      [
        "empty percentile",
        "reviewed-metrics-v1.json",
        (v) => {
          v.metrics.find(
            (m: J) => m.metric_id === "geolocation_p90_distance",
          ).value = 0;
        },
      ],
      [
        "cross split leakage",
        "component-split-audit-v1.json",
        (v) => {
          v.candidate_tasks.cross_split_component_crossings = 1;
        },
      ],
    ];
    for (const [name, member, mutate] of mutations) {
      const copy = path.join(root, name.replaceAll(" ", "-"));
      fs.cpSync(candidate, copy, { recursive: true });
      const value = load(path.join(copy, member));
      mutate(value);
      writeJson(path.join(copy, member), value);
      let failed = false;
      try {
        verifyCandidate(copy, false);
      } catch {
        failed = true;
      }
      assert(failed, `mutation accepted: ${name}`);
      cases++;
      rejected++;
    }
    const output = path.join(root, "published");
    const authorizationFile = path.join(root, "authorization.json");
    writeJson(authorizationFile, syntheticAuthorization(candidate, output));
    const capability = internalAuthorizationCapability(
      candidate,
      authorizationFile,
    );
    const receiptFile = path.join(root, "review.json");
    writeJson(receiptFile, syntheticReceipt(candidate, authorizationFile));
    validateReview(
      candidate,
      receiptFile,
      authorizationFile,
      false,
      capability,
    );
    cases++;
    let failed = false;
    try {
      validateReview(candidate, receiptFile, authorizationFile);
    } catch {
      failed = true;
    }
    assert(failed, "production path accepted untracked synthetic authority");
    cases++;
    rejected++;
    const changedReview = load(receiptFile);
    changedReview.dispositions[0].task_sha256 = "0".repeat(64);
    writeJson(path.join(root, "changed-review.json"), changedReview);
    failed = false;
    try {
      validateReview(
        candidate,
        path.join(root, "changed-review.json"),
        authorizationFile,
        false,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "changed task review passed");
    cases++;
    rejected++;
    const implementationReview = syntheticReceipt(candidate, authorizationFile);
    implementationReview.reviewer.identity = AUTHOR.identity;
    writeJson(
      path.join(root, "implementation-review.json"),
      implementationReview,
    );
    failed = false;
    try {
      validateReview(
        candidate,
        path.join(root, "implementation-review.json"),
        authorizationFile,
        false,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "implementation reviewer passed");
    cases++;
    rejected++;
    const forgedRoute = syntheticReceipt(candidate, authorizationFile);
    forgedRoute.reviewer.identity = "renamed-synthetic-reviewer";
    writeJson(path.join(root, "forged-route.json"), forgedRoute);
    failed = false;
    try {
      validateReview(
        candidate,
        path.join(root, "forged-route.json"),
        authorizationFile,
        false,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "forged reviewer route passed");
    cases++;
    rejected++;
    const changedAuthorizationFile = path.join(
      root,
      "changed-authorization.json",
    );
    const changedAuthorization = load(authorizationFile);
    changedAuthorization.scope_note += " Changed.";
    writeJson(changedAuthorizationFile, changedAuthorization);
    failed = false;
    try {
      validateReview(
        candidate,
        receiptFile,
        changedAuthorizationFile,
        false,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "changed authorization bytes passed");
    cases++;
    rejected++;
    failed = false;
    try {
      verifyTrackedAuthorizationAuthority(candidate, capability.pin, {
        readWorking: () => fs.readFileSync(authorizationFile),
        readCommitted: () => null,
      });
    } catch {
      failed = true;
    }
    assert(failed, "uncommitted authorization bytes passed");
    cases++;
    rejected++;
    const mixedReview = syntheticReceipt(candidate, authorizationFile);
    for (const row of mixedReview.dispositions.slice(1)) {
      row.disposition = "held";
      row.approvals = {
        exact_task_binding: true,
        claim_and_dossier_authority: false,
        component_and_split: true,
        rights_and_pixels: true,
        evidence_boundary: false,
      };
      row.rationale =
        "Synthetic hold proving that partial acceptance cannot complete or publish Gate H.";
    }
    mixedReview.counts = { candidates: 32, accepted: 1, held: 31, rejected: 0 };
    const mixedReviewFile = path.join(root, "mixed-review.json");
    writeJson(mixedReviewFile, mixedReview);
    failed = false;
    try {
      await publish(
        candidate,
        mixedReviewFile,
        authorizationFile,
        output,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "1/32 accepted receipt published or completed issue");
    cases++;
    rejected++;
    failed = false;
    try {
      await publish(
        candidate,
        receiptFile,
        authorizationFile,
        path.join(root, "alternate-output"),
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "alternate output route passed");
    cases++;
    rejected++;
    failed = false;
    try {
      await publish(
        candidate,
        receiptFile,
        authorizationFile,
        path.join(root, "other-parent", path.basename(output)),
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "alternate output parent with authorized basename passed");
    cases++;
    rejected++;
    const rawOutput = path.join(root, "raw-published");
    const rawAuthorizationFile = path.join(root, "raw-authorization.json");
    writeJson(
      rawAuthorizationFile,
      syntheticAuthorization(candidate, rawOutput),
    );
    const rawCapability = internalAuthorizationCapability(
      candidate,
      rawAuthorizationFile,
    );
    const rawReceiptFile = path.join(root, "raw-review.json");
    const rawReceipt = syntheticReceipt(candidate, rawAuthorizationFile);
    fs.writeFileSync(rawReceiptFile, JSON.stringify(rawReceipt));
    await publish(
      candidate,
      rawReceiptFile,
      rawAuthorizationFile,
      rawOutput,
      rawCapability,
    );
    const rawPublished = load(
      path.join(rawOutput, "published-benchmark-tasks-v1.json"),
    );
    const rawDescriptor = load(
      path.join(rawOutput, "final-descriptor-v1.json"),
    );
    assert(
      rawPublished.review_receipt_sha256 ===
        hash(fs.readFileSync(rawReceiptFile)) &&
        rawDescriptor.review_receipt.sha256 ===
          hash(fs.readFileSync(rawReceiptFile)),
      "alternate-whitespace receipt byte digest drift",
    );
    cases++;
    await publish(
      candidate,
      receiptFile,
      authorizationFile,
      output,
      capability,
    );
    cases++;
    failed = false;
    try {
      await publish(
        candidate,
        receiptFile,
        authorizationFile,
        output,
        capability,
      );
    } catch {
      failed = true;
    }
    assert(failed, "second publication passed");
    cases++;
    rejected++;
    fs.rmSync(path.join(output, "publication-commit-v1.json"));
    failed = false;
    try {
      verifyPublished(output, authorizationFile, capability);
    } catch {
      failed = true;
    }
    assert(failed, "incomplete publication passed");
    cases++;
    rejected++;
    return {
      self_test: "passed",
      production_authorization_state: productionState,
      cases,
      adversarial_rejections: rejected,
      tracked_task_review_authored: false,
      production_mutation: false,
      paid_gpu: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
async function integration(): Promise<J> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h-int-"));
  try {
    const candidate = path.join(root, "candidate");
    await build(candidate);
    const replay = path.join(root, "replay");
    await build(replay);
    for (const member of files(candidate))
      assert(
        fs
          .readFileSync(path.join(candidate, member))
          .equals(fs.readFileSync(path.join(replay, member))),
        `integration replay drift: ${member}`,
      );
    const output = path.join(root, "published");
    const authorization = path.join(root, "authorization.json");
    writeJson(authorization, syntheticAuthorization(candidate, output));
    const capability = internalAuthorizationCapability(
      candidate,
      authorization,
    );
    const receipt = path.join(root, "review.json");
    writeJson(receipt, syntheticReceipt(candidate, authorization));
    const result = await publish(
      candidate,
      receipt,
      authorization,
      output,
      capability,
    );
    return {
      integration_test: "passed",
      candidate_files: files(candidate).length,
      candidate_tasks: 32,
      synthetic_review_only: true,
      published_tasks: result.accepted_tasks,
      production_mutation: false,
      paid_gpu: false,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function sealRegistry(): void {
  const facts = tree(FIXTURE);
  const row = {
    stable_id: ID,
    schema_version: "dataset_factory_artifact_registry_v0",
    artifact_schema_version: "reviewed_metrics_candidate_v1.0.0",
    artifact_kind: "directory",
    content_digest: {
      algorithm: "sha256",
      value: facts.sha256,
      scope: "sorted_tree_manifest",
    },
    counts: { file_count: facts.members.length, byte_count: facts.bytes },
    source_lineage: {
      description:
        "Issue #92 Gate H candidate metrics and 32 accepted-dossier image-mode benchmark task candidates pending separate external task review; unavailable metrics remain null and no task is reviewed or published.",
      source_artifact_ids: [
        "dfv0_issue69_phase_d_scale_v1_20260713",
        "dfv0_reviewed_source_evidence_v1",
        "dfv0_aerial_source_evidence_authority_v1_publication",
        "dfv0_verified_dossiers_v1_publication",
      ],
      source_urls: [
        "https://github.com/zouantchaw/mtl-archives-search/issues/92",
      ],
    },
    storage: {
      storage_class: "tracked_repository",
      path_class: "tracked_fixture",
      locator: REL,
    },
    generation: {
      method: "automated",
      command: "npm run dataset-factory:reviewed-metrics-verify-v1",
      code_ref: "codex/92-reviewed-metrics",
      human_input_ids: [],
    },
    dependency_ids: [
      "dfv0_issue69_phase_d_scale_v1_20260713",
      "dfv0_reviewed_source_evidence_v1",
      "dfv0_aerial_source_evidence_authority_v1_publication",
      "dfv0_verified_dossiers_v1_publication",
    ],
    required_by: ["issue #92 external task review and Gate H publication"],
    rights_boundary: {
      license_id: "cc-by-4.0",
      attribution:
        "Archives de la Ville de Montreal and Ville de Montreal as bound per task",
      commercial_use_allowed: true,
      notes:
        "Candidate image-mode tasks preserve exact per-dossier rights. No OCR, entity, place, geolocation, measurement, land-use, or search-semantic task is emitted; reviewed tasks and production mutations are zero.",
    },
    created_at: CREATED,
    creation_time_basis: "report_metadata",
  };
  fs.appendFileSync(REGISTRY, `${JSON.stringify(row)}\n`);
}
async function main(): Promise<void> {
  const command = process.argv[2];
  const args = parseArgs({
    args: process.argv.slice(3),
    options: {
      output: { type: "string" },
      candidate: { type: "string" },
      receipt: { type: "string" },
      authorization: { type: "string" },
    },
  });
  let result: J;
  if (command === "build")
    result = await build(path.resolve(args.values.output ?? ""));
  else if (command === "verify")
    result = await verify(path.resolve(args.values.candidate ?? FIXTURE));
  else if (command === "seal-registry") {
    verifyCandidate(FIXTURE, false);
    sealRegistry();
    result = verifyCandidate(FIXTURE);
  } else if (command === "validate-review")
    result = validateReview(
      path.resolve(args.values.candidate ?? FIXTURE),
      path.resolve(args.values.receipt ?? ""),
      path.resolve(args.values.authorization ?? ""),
    );
  else if (command === "publish")
    result = await publish(
      path.resolve(args.values.candidate ?? FIXTURE),
      path.resolve(args.values.receipt ?? ""),
      path.resolve(args.values.authorization ?? ""),
      path.resolve(args.values.output ?? ""),
    );
  else if (command === "verify-published")
    result = verifyPublished(
      path.resolve(args.values.output ?? ""),
      path.resolve(args.values.authorization ?? ""),
    );
  else if (command === "self-test") result = await selfTest();
  else if (command === "integration-test") result = await integration();
  else
    throw new Error(
      "command required: build|verify|seal-registry|validate-review|publish|verify-published|self-test|integration-test",
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
