import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

type J = any;
type Pin = { path: string; sha256: string; bytes: number };
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
  for (const member of fs
    .readdirSync(gateGSchemas)
    .filter((file) => file.endsWith(".json")))
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
function metric(
  id: string,
  status: "available" | "unavailable",
  numerator: number | null,
  denominator: number,
  value: number | null,
  unit: string,
  subset: string,
  exclusions: string[],
  reason: string,
): J {
  return {
    metric_id: id,
    status,
    numerator,
    denominator,
    value,
    unit,
    source_subset: { id: subset, predecessor_digests: predecessorPins() },
    exclusions,
    zero_denominator_policy:
      denominator === 0
        ? "status_unavailable_value_null_never_coerce_to_zero"
        : "ordinary_ratio_or_count",
    reason,
  };
}
function reviewedMetrics(): J {
  const support: Record<string, number> = {
    ground_street: 0,
    aerial_vertical: 0,
    aerial_oblique: 0,
    document_map: 0,
    low_information: 0,
  };
  for (const dossier of acceptedDossiers())
    support[dossier.visual_claims[0].value]++;
  const metrics: J[] = [];
  for (const id of ["ocr_normalized_exact_match", "ocr_cer", "ocr_wer"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        0,
        null,
        id === "ocr_normalized_exact_match" ? "ratio" : "error_rate",
        "paired_ocr_prediction_reference_crops",
        ["no prediction/reference crop intersection"],
        "No reviewed prediction/reference pair exists.",
      ),
    );
  for (const id of ["entity_precision", "entity_recall", "false_identity_rate"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        0,
        null,
        "ratio",
        "reviewed_entity_prediction_gold",
        ["no reviewed entity prediction/gold set"],
        "Entity metrics require paired reviewed predictions and gold labels.",
      ),
    );
  metrics.push(
    metric(
      "place_link_precision",
      "unavailable",
      null,
      0,
      null,
      "ratio",
      "accepted_dossier_place_links",
      ["no accepted dossier-level place link"],
      "No accepted place-link denominator exists.",
    ),
  );
  for (const name of Object.keys(support)) {
    metrics.push(
      metric(
        `image_mode_support_${name}`,
        "available",
        support[name],
        32,
        support[name],
        "records",
        "gate_g_accepted_image_mode_labels",
        [],
        "Support count from independently accepted Gate G labels; not model performance.",
      ),
    );
    for (const kind of ["precision", "recall"])
      metrics.push(
        metric(
          `image_mode_${name}_${kind}`,
          "unavailable",
          null,
          0,
          null,
          "ratio",
          "paired_image_mode_predictions_gold",
          [
            "accepted labels are not paired model predictions versus independent gold",
          ],
          "Per-class model performance is unavailable.",
        ),
      );
  }
  metrics.push(
    metric(
      "image_mode_macro_f1",
      "unavailable",
      null,
      0,
      null,
      "ratio",
      "paired_image_mode_predictions_gold",
      ["no model prediction/gold pairing"],
      "Macro-F1 is unavailable.",
    ),
  );
  metrics.push(
    metric(
      "gate_g_reviewer_agreement",
      "available",
      32,
      32,
      1,
      "ratio",
      "gate_g_accepted_image_mode_labels",
      ["four categorically held pilots"],
      "All 32 counted labels received positive independent dossier review; this is reviewer agreement, not model performance.",
    ),
  );
  for (const id of ["aerial_region_label_agreement", "aerial_mask_iou"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        0,
        null,
        "ratio",
        "reviewed_aerial_masks",
        ["no reviewed masks"],
        "No mask denominator exists.",
      ),
    );
  for (const id of ["geolocation_median_distance", "geolocation_p90_distance"])
    metrics.push(
      metric(
        id,
        "unavailable",
        null,
        0,
        null,
        "distance",
        "accepted_verified_coordinates",
        ["no accepted coordinates"],
        "No verified coordinate/error sample exists.",
      ),
    );
  const gateFDispositions = load(GATE_F_REVIEW).dispositions;
  for (const target of [
    "location",
    "georef",
    "scale",
    "land_use",
    "measurement",
  ]) {
    const abstentions = gateFDispositions.filter(
      (row: J) => row[target] === "abstained",
    ).length;
    const nonAbstentions = gateFDispositions.length - abstentions;
    metrics.push(
      metric(
        `${target}_coverage`,
        "available",
        nonAbstentions,
        gateFDispositions.length,
        nonAbstentions / gateFDispositions.length,
        "ratio",
        "gate_f_semantic_target_universe",
        [],
        "Gate F records with accepted semantic authority.",
      ),
    );
    metrics.push(
      metric(
        `${target}_abstention_rate`,
        "available",
        abstentions,
        gateFDispositions.length,
        abstentions / gateFDispositions.length,
        "ratio",
        "gate_f_semantic_target_universe",
        [],
        "Gate F rows explicitly marked abstained.",
      ),
    );
    metrics.push(
      metric(
        `${target}_error_among_non_abstentions`,
        "unavailable",
        null,
        nonAbstentions,
        null,
        "error_rate",
        "gate_f_non_abstentions",
        ["zero non-abstentions"],
        "Error among non-abstentions is undefined when the denominator is zero.",
      ),
    );
  }
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
        0,
        null,
        id.includes("cost") ? "currency" : "duration",
        "tracked_stage_runtime_and_billing",
        ["no tracked prior stage durations or billing"],
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
  ];
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
function validateReview(
  candidate: string,
  receiptFile: string,
  embedded = false,
): J {
  verifyCandidate(candidate, false, embedded);
  const receipt = load(receiptFile);
  schema("task-review-receipt.schema.v1.json", receipt);
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
  return { receipt, tasks, counts };
}
function derivePublishedTasks(tasks: J, receipt: J): J {
  const dispositions = new Map<string, J>(
    receipt.dispositions.map((row: J) => [row.task_id, row]),
  );
  return {
    schema_version: "reviewed_metrics_published_tasks_v1.0.0",
    source_artifact_id: ID,
    review_receipt_sha256: hash(pretty(receipt)),
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
  return {
    schema_version: "reviewed_metrics_publication_status_v1.0.0",
    state: "published_external_task_review",
    counts: {
      ...counts,
      reviewed_tasks: counts.accepted + counts.held + counts.rejected,
      published_tasks: counts.accepted,
      search_tasks: 0,
    },
    issue_complete: counts.accepted > 0,
    production_mutation: false,
    search_index_mutation: false,
    paid_gpu: false,
  };
}
function publicationFiles(): string[] {
  return [
    ...expectedFiles(),
    "independent-task-review-v1.json",
    "published-benchmark-tasks-v1.json",
    "publication-status-v1.json",
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
  output: string,
): Promise<J> {
  assert(!fs.existsSync(output), "publication destination exists");
  const validated = validateReview(candidate, receiptFile);
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
    writeJson(
      path.join(staging, "published-benchmark-tasks-v1.json"),
      derivePublishedTasks(validated.tasks, validated.receipt),
    );
    writeJson(
      path.join(staging, "publication-status-v1.json"),
      publicationStatus(validated.counts),
    );
    writeJson(
      path.join(staging, "final-descriptor-v1.json"),
      finalDescriptor(staging, validated.counts),
    );
    writeJson(
      path.join(staging, "publication-commit-v1.json"),
      publicationCommit(staging, validated.receipt),
    );
    verifyPublished(staging);
    fs.mkdirSync(output);
    reserved = true;
    const commit = "publication-commit-v1.json";
    for (const member of files(staging).filter((member) => member !== commit)) {
      const destination = path.join(output, member);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(path.join(staging, member), destination);
    }
    fs.renameSync(path.join(staging, commit), path.join(output, commit));
    return verifyPublished(output);
  } catch (error) {
    if (reserved) fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
function verifyPublished(output: string): J {
  assert(
    fs.existsSync(path.join(output, "publication-commit-v1.json")),
    "publication commit absent",
  );
  const validated = validateReview(
    output,
    path.join(output, "independent-task-review-v1.json"),
    true,
  );
  const published = derivePublishedTasks(validated.tasks, validated.receipt);
  schema(
    "published-tasks.schema.v1.json",
    load(path.join(output, "published-benchmark-tasks-v1.json")),
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
function syntheticReceipt(candidate: string): J {
  const tasks = load(path.join(candidate, "candidate-benchmark-tasks-v1.json"));
  const template = blankReview(candidate, tasks);
  return {
    schema_version: "reviewed_metrics_task_review_receipt_v1.0.0",
    status: "completed",
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
    const receiptFile = path.join(root, "review.json");
    writeJson(receiptFile, syntheticReceipt(candidate));
    validateReview(candidate, receiptFile);
    cases++;
    const changedReview = load(receiptFile);
    changedReview.dispositions[0].task_sha256 = "0".repeat(64);
    writeJson(path.join(root, "changed-review.json"), changedReview);
    let failed = false;
    try {
      validateReview(candidate, path.join(root, "changed-review.json"));
    } catch {
      failed = true;
    }
    assert(failed, "changed task review passed");
    cases++;
    rejected++;
    const implementationReview = syntheticReceipt(candidate);
    implementationReview.reviewer.identity = AUTHOR.identity;
    writeJson(
      path.join(root, "implementation-review.json"),
      implementationReview,
    );
    failed = false;
    try {
      validateReview(candidate, path.join(root, "implementation-review.json"));
    } catch {
      failed = true;
    }
    assert(failed, "implementation reviewer passed");
    cases++;
    rejected++;
    const mixedReview = syntheticReceipt(candidate);
    mixedReview.dispositions[0].disposition = "held";
    mixedReview.dispositions[0].approvals = {
      exact_task_binding: true,
      claim_and_dossier_authority: false,
      component_and_split: true,
      rights_and_pixels: true,
      evidence_boundary: false,
    };
    mixedReview.dispositions[0].rationale =
      "Synthetic hold proving that non-accepted tasks are retained but not published.";
    mixedReview.counts = { candidates: 32, accepted: 31, held: 1, rejected: 0 };
    const mixedReviewFile = path.join(root, "mixed-review.json");
    writeJson(mixedReviewFile, mixedReview);
    const mixedOutput = path.join(root, "mixed-published");
    const mixedResult = await publish(candidate, mixedReviewFile, mixedOutput);
    const mixedTasks = load(
      path.join(mixedOutput, "published-benchmark-tasks-v1.json"),
    );
    assert(
      mixedResult.accepted_tasks === 31 &&
        mixedResult.held_tasks === 1 &&
        mixedTasks.accepted_tasks.length === 31 &&
        mixedTasks.retained.length === 1 &&
        mixedTasks.retained[0].disposition === "held",
      "held task publication boundary failed",
    );
    cases++;
    const output = path.join(root, "published");
    await publish(candidate, receiptFile, output);
    cases++;
    failed = false;
    try {
      await publish(candidate, receiptFile, output);
    } catch {
      failed = true;
    }
    assert(failed, "second publication passed");
    cases++;
    rejected++;
    fs.rmSync(path.join(output, "publication-commit-v1.json"));
    failed = false;
    try {
      verifyPublished(output);
    } catch {
      failed = true;
    }
    assert(failed, "incomplete publication passed");
    cases++;
    rejected++;
    return {
      self_test: "passed",
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
    const receipt = path.join(root, "review.json");
    writeJson(receipt, syntheticReceipt(candidate));
    const result = await publish(
      candidate,
      receipt,
      path.join(root, "published"),
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
    );
  else if (command === "publish")
    result = await publish(
      path.resolve(args.values.candidate ?? FIXTURE),
      path.resolve(args.values.receipt ?? ""),
      path.resolve(args.values.output ?? ""),
    );
  else if (command === "verify-published")
    result = verifyPublished(path.resolve(args.values.output ?? ""));
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
