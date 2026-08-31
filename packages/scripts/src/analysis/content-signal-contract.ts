/**
 * Local-only contract for content-loop signals.
 *
 * This deliberately does not turn social/product outcomes into facts. Every
 * signal keeps its source class and reward boundary, and identity joins are
 * required before a row can be emitted.
 */

export const CONTENT_SIGNAL_SCHEMA = "mtl_content_signal_v1";

/**
 * Fields shared by emitted daily/monthly aggregate rows.
 *
 * The aggregate JSON schema intentionally validates this envelope only. The
 * report rows also carry metric payloads whose shape varies by row type, so a
 * caller must project these fields before applying the envelope schema.
 */
export const AGGREGATE_ENVELOPE_FIELDS = [
  "schema_version",
  "captured_at",
  "capture_time_basis",
  "timezone",
  "platform",
  "observation_window",
  "signal_class",
  "source_type",
  "ground_truth_boundary",
  "evidence_kind",
] as const;

export function projectAggregateEnvelope(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    AGGREGATE_ENVELOPE_FIELDS.map((field) => [field, value[field]]),
  );
}

export type SignalClass =
  | "factual_truth"
  | "hypothesis"
  | "synthetic_acquisition"
  | "explicit_preference"
  | "product_behavior"
  | "social_behavior"
  | "stakeholder_review";

export type SignalSource =
  | "archive_manifest"
  | "model"
  | "human"
  | "codex"
  | "product_analytics"
  | "social_platform"
  | "stakeholder";

export type PrivacyConsent =
  | "aggregate_public"
  | "pseudonymous_consent"
  | "no_personal_data";

/**
 * Provenance for an input artifact. A fixture must never be emitted as if it
 * were a real product export, even when it happens to use the same schema.
 */
export type EvidenceKind = "real_export" | "synthetic_fixture";

export type ContentIdentity = {
  platform: "instagram" | "facebook";
  platform_post_id: string;
  canonical_record_id: string;
  visual_family_id: string;
  package_id: string;
  source_asset: string;
  audience: string;
  format: string;
  theme: string;
  hook: string | null;
  caption_version: string | null;
  pipeline_version: string | null;
  model_version: string | null;
  prompt_version: string | null;
  renderer_version: string | null;
  publish_status: "draft" | "scheduled" | "published" | "failed" | "deleted";
  platform_permalink: string | null;
  identity_basis: "declared_identity";
  package_family_verification: "not_independently_verified";
};

export type ProductSignal = {
  schema_version: typeof CONTENT_SIGNAL_SCHEMA;
  event_id: string;
  signal_class: "product_behavior";
  source_type: "product_analytics";
  event_name:
    | "photo_viewed"
    | "photo_dwelled"
    | "photo_shared"
    | "search_committed"
    | "search_result_clicked"
    | "order_mode_entered"
    | "print_cta_clicked"
    | "cart_item_added"
    | "checkout_clicked"
    | "order_completed"
    | "search_no_results";
  captured_at: string;
  capture_time_basis: "source_event";
  timezone: "America/Toronto";
  canonical_record_id: string;
  visual_family_id: string;
  package_id: string;
  source_asset: string;
  platform: "web";
  surface: "search" | "photo" | "print" | "checkout";
  metric_name: string;
  metric_value: number;
  metric_definition: string;
  observation_window: { start: string; end: string };
  source: string;
  query: string | null;
  position: number | null;
  candidate_set: string[] | null;
  ranking_version: string | null;
  model_version: string | null;
  index_version: string | null;
  experiment_assignment: string | null;
  propensity: number | null;
  safety_budget_id: string | null;
  privacy_consent: PrivacyConsent;
  evidence_kind: EvidenceKind;
  ground_truth_boundary: "reward_not_fact";
  identity_basis: "declared_identity";
  package_family_verification: "not_independently_verified";
};

export type ManifestIdentity = {
  metadata_filename?: string;
  image_filename?: string;
  metadataFilename?: string;
  imageFilename?: string;
  source?: { source_url?: string; external_url?: string };
  external_url?: string;
  image_url?: string;
  [key: string]: unknown;
};

export type IdentityValidation = {
  byPost: Map<string, ContentIdentity>;
  byRecord: Map<string, ManifestIdentity>;
  warnings: string[];
};

const PRODUCT_EVENTS = new Set<ProductSignal["event_name"]>([
  "photo_viewed",
  "photo_dwelled",
  "photo_shared",
  "search_committed",
  "search_result_clicked",
  "order_mode_entered",
  "print_cta_clicked",
  "cart_item_added",
  "checkout_clicked",
  "order_completed",
  "search_no_results",
]);

const IDENTITY_KEYS = new Set([
  "platform",
  "platform_post_id",
  "canonical_record_id",
  "visual_family_id",
  "package_id",
  "source_asset",
  "audience",
  "format",
  "theme",
  "hook",
  "caption_version",
  "pipeline_version",
  "model_version",
  "prompt_version",
  "renderer_version",
  "publish_status",
  "platform_permalink",
]);
const PRODUCT_SIGNAL_KEYS = new Set([
  "schema_version",
  "event_id",
  "signal_class",
  "source_type",
  "event_name",
  "captured_at",
  "capture_time_basis",
  "timezone",
  "canonical_record_id",
  "visual_family_id",
  "package_id",
  "source_asset",
  "platform",
  "surface",
  "metric_name",
  "metric_value",
  "metric_definition",
  "observation_window",
  "source",
  "query",
  "position",
  "candidate_set",
  "ranking_version",
  "model_version",
  "index_version",
  "experiment_assignment",
  "propensity",
  "safety_budget_id",
  "privacy_consent",
  "evidence_kind",
  "ground_truth_boundary",
  "identity_basis",
  "package_family_verification",
]);
const PRODUCT_SIGNAL_REQUIRED_KEYS = PRODUCT_SIGNAL_KEYS;

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function nullableText(value: unknown, label = "value"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new Error(`${label} must be a string or null`);
  return value.trim() ? value.trim() : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityKey(platform: unknown, postId: unknown): string {
  return JSON.stringify([
    text(platform, "platform"),
    text(postId, "platform_post_id"),
  ]);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
}

function assertRequiredKeys(
  value: Record<string, unknown>,
  required: Set<string>,
  label: string,
): void {
  for (const key of required)
    if (!(key in value)) throw new Error(`${label}.${key} is required`);
}

function assertPortableIdentity(value: string, label: string): void {
  if (/^(?:file:|~[\\/]|[A-Za-z]:[\\/]|[\\/]{1,2})/i.test(value))
    throw new Error(`${label} must not be an absolute/private filesystem path`);
}

function requireIso(value: unknown, label: string): string {
  const candidate = text(value, label);
  const parsed = Date.parse(candidate);
  const calendarDay = candidate.slice(0, 10);
  const validCalendarDay =
    /^\d{4}-\d{2}-\d{2}$/.test(calendarDay) &&
    new Date(`${calendarDay}T00:00:00Z`).toISOString().slice(0, 10) ===
      calendarDay;
  if (
    !Number.isFinite(parsed) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      candidate,
    ) ||
    !validCalendarDay
  )
    throw new Error(`${label} must be an ISO timestamp`);
  return candidate;
}

export function parseIdentity(
  value: unknown,
  label = "identity",
): ContentIdentity {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  assertAllowedKeys(value, IDENTITY_KEYS, label);
  const platform = text(value.platform, `${label}.platform`);
  if (platform !== "instagram" && platform !== "facebook")
    throw new Error(`${label}.platform is unsupported`);
  const status = text(
    value.publish_status,
    `${label}.publish_status`,
  ) as ContentIdentity["publish_status"];
  if (
    !["draft", "scheduled", "published", "failed", "deleted"].includes(status)
  )
    throw new Error(`${label}.publish_status is unsupported`);
  const permalink = nullableText(
    value.platform_permalink,
    `${label}.platform_permalink`,
  );
  if (status === "published" && !permalink)
    throw new Error(`${label}.published identity requires platform_permalink`);
  const output = {
    platform,
    platform_post_id: text(value.platform_post_id, `${label}.platform_post_id`),
    canonical_record_id: text(
      value.canonical_record_id,
      `${label}.canonical_record_id`,
    ),
    visual_family_id: text(value.visual_family_id, `${label}.visual_family_id`),
    package_id: text(value.package_id, `${label}.package_id`),
    source_asset: text(value.source_asset, `${label}.source_asset`),
    audience: text(value.audience, `${label}.audience`),
    format: text(value.format, `${label}.format`),
    theme: text(value.theme, `${label}.theme`),
    hook: nullableText(value.hook),
    caption_version: nullableText(value.caption_version),
    pipeline_version: nullableText(value.pipeline_version),
    model_version: nullableText(value.model_version),
    prompt_version: nullableText(value.prompt_version),
    renderer_version: nullableText(value.renderer_version),
    publish_status: status,
    platform_permalink: permalink,
    identity_basis: "declared_identity",
    package_family_verification: "not_independently_verified",
  } as ContentIdentity;
  assertPortableIdentity(output.package_id, `${label}.package_id`);
  assertPortableIdentity(output.source_asset, `${label}.source_asset`);
  return output;
}

/**
 * Validate the explicit post -> package -> canonical identity map. The map's
 * package/family values are declared joins, not independently verified facts;
 * only the canonical record/source-asset lookup is checked against the supplied
 * manifest. No fuzzy caption/date matching is allowed.
 */
export function validateIdentityMap(
  values: unknown[],
  manifestValues: unknown[],
): IdentityValidation {
  const byPost = new Map<string, ContentIdentity>();
  const byPackage = new Map<string, ContentIdentity>();
  const byPlatformPackage = new Set<string>();
  const byPermalink = new Map<string, string>();
  for (const [index, value] of values.entries()) {
    const identity = parseIdentity(value, `identity[${index}]`);
    const key = identityKey(identity.platform, identity.platform_post_id);
    if (byPost.has(key)) throw new Error(`duplicate identity join for ${key}`);
    const existingPackage = byPackage.get(identity.package_id);
    if (
      existingPackage &&
      (existingPackage.canonical_record_id !== identity.canonical_record_id ||
        existingPackage.visual_family_id !== identity.visual_family_id ||
        existingPackage.source_asset !== identity.source_asset)
    ) {
      throw new Error(
        `conflicting content join for package ${identity.package_id}`,
      );
    }
    const platformPackageKey = JSON.stringify([
      identity.platform,
      identity.package_id,
    ]);
    if (byPlatformPackage.has(platformPackageKey))
      throw new Error(
        `ambiguous platform-package join for ${platformPackageKey}`,
      );
    byPlatformPackage.add(platformPackageKey);
    if (identity.platform_permalink) {
      const existingPermalink = byPermalink.get(identity.platform_permalink);
      if (existingPermalink && existingPermalink !== key)
        throw new Error(
          `permalink maps to multiple platform posts: ${identity.platform_permalink}`,
        );
      byPermalink.set(identity.platform_permalink, key);
    }
    byPost.set(key, identity);
    byPackage.set(identity.package_id, identity);
  }

  const byRecord = new Map<string, ManifestIdentity>();
  for (const [index, value] of manifestValues.entries()) {
    if (!isObject(value))
      throw new Error(`manifest[${index}] must be an object`);
    const recordId =
      nullableText(value.metadata_filename) ??
      nullableText(value.metadataFilename);
    if (!recordId) continue;
    if (byRecord.has(recordId))
      throw new Error(`duplicate canonical manifest record ${recordId}`);
    byRecord.set(recordId, value as ManifestIdentity);
  }
  if (!byRecord.size)
    throw new Error("canonical manifest contains no metadata filenames");

  for (const identity of byPost.values()) {
    const manifest = byRecord.get(identity.canonical_record_id);
    if (!manifest)
      throw new Error(
        `identity ${identity.platform_post_id} references missing canonical record ${identity.canonical_record_id}`,
      );
    const manifestAsset =
      nullableText(manifest.image_filename) ??
      nullableText(manifest.imageFilename) ??
      nullableText(manifest.external_url) ??
      nullableText(manifest.image_url) ??
      (isObject(manifest.source)
        ? (nullableText(manifest.source.source_url) ??
          nullableText(manifest.source.external_url))
        : null);
    if (!manifestAsset)
      throw new Error(
        `canonical record ${identity.canonical_record_id} has no source asset`,
      );
    if (identity.source_asset !== manifestAsset)
      throw new Error(
        `source asset mismatch for ${identity.canonical_record_id}`,
      );
  }
  return { byPost, byRecord, warnings: [] };
}

function parseObservationWindow(value: unknown): {
  start: string;
  end: string;
} {
  if (!isObject(value)) throw new Error("observation_window must be an object");
  assertAllowedKeys(value, new Set(["start", "end"]), "observation_window");
  const start = requireIso(value.start, "observation_window.start");
  const end = requireIso(value.end, "observation_window.end");
  if (Date.parse(start) > Date.parse(end))
    throw new Error("observation_window.start must not be after end");
  return { start, end };
}

/** Validate product telemetry before it can be considered a behavior signal. */
export function validateProductSignal(
  value: unknown,
  identities: Map<string, ContentIdentity>,
): ProductSignal {
  if (!isObject(value)) throw new Error("product signal must be an object");
  assertAllowedKeys(value, PRODUCT_SIGNAL_KEYS, "product signal");
  assertRequiredKeys(value, PRODUCT_SIGNAL_REQUIRED_KEYS, "product signal");
  if (value.schema_version !== CONTENT_SIGNAL_SCHEMA)
    throw new Error("product signal schema_version is unsupported");
  if (
    value.signal_class !== "product_behavior" ||
    value.source_type !== "product_analytics"
  )
    throw new Error("product signal class/source mismatch");
  const platform = text(value.platform, "platform");
  if (platform !== "web")
    throw new Error("product signal platform must be web");
  const eventName = text(
    value.event_name,
    "event_name",
  ) as ProductSignal["event_name"];
  if (!PRODUCT_EVENTS.has(eventName))
    throw new Error(`unsupported product event ${eventName}`);
  const eventId = text(value.event_id, "event_id");
  const recordId = text(value.canonical_record_id, "canonical_record_id");
  const familyId = text(value.visual_family_id, "visual_family_id");
  const packageId = text(value.package_id, "package_id");
  const sourceAsset = text(value.source_asset, "source_asset");
  const identity = identities.get(
    identityLookupKey({
      canonical_record_id: recordId,
      package_id: packageId,
    }),
  );
  if (
    !identity ||
    identity.publish_status !== "published" ||
    identity.visual_family_id !== familyId ||
    identity.source_asset !== sourceAsset
  )
    throw new Error(`product signal identity join failed for ${eventId}`);
  const capturedAt = requireIso(value.captured_at, "captured_at");
  if (value.timezone !== "America/Toronto")
    throw new Error("product signal timezone must be America/Toronto");
  const metricValue = value.metric_value;
  if (
    typeof metricValue !== "number" ||
    !Number.isFinite(metricValue) ||
    metricValue < 0
  )
    throw new Error("metric_value must be a finite non-negative number");
  const metricName = text(value.metric_name, "metric_name");
  const metricDefinition = text(value.metric_definition, "metric_definition");
  const source = text(value.source, "source");
  assertPortableIdentity(source, "source");
  const observationWindow = parseObservationWindow(value.observation_window);
  if (
    Date.parse(capturedAt) < Date.parse(observationWindow.start) ||
    Date.parse(capturedAt) > Date.parse(observationWindow.end)
  ) {
    throw new Error(
      `captured_at must fall within observation_window for ${eventId}`,
    );
  }
  const experiment = nullableText(value.experiment_assignment);
  const propensity =
    value.propensity === null || value.propensity === undefined
      ? null
      : value.propensity;
  if (
    propensity !== null &&
    (typeof propensity !== "number" ||
      !Number.isFinite(propensity) ||
      propensity <= 0 ||
      propensity > 1)
  )
    throw new Error("propensity must be in (0,1]");
  const safetyBudget = nullableText(value.safety_budget_id);
  if (experiment || propensity !== null || safetyBudget) {
    if (!experiment || propensity === null)
      throw new Error("experiment assignment requires propensity");
    if (!safetyBudget)
      throw new Error("experiment assignment requires safety_budget_id");
  }
  if (value.ground_truth_boundary !== "reward_not_fact")
    throw new Error("product behavior must use reward_not_fact boundary");
  if (
    value.identity_basis !== "declared_identity" ||
    value.package_family_verification !== "not_independently_verified"
  ) {
    throw new Error(
      "product behavior must declare identity basis and verification boundary",
    );
  }
  const consent = text(
    value.privacy_consent,
    "privacy_consent",
  ) as PrivacyConsent;
  if (
    !["aggregate_public", "pseudonymous_consent", "no_personal_data"].includes(
      consent,
    )
  )
    throw new Error("privacy_consent is unsupported");
  const evidenceKind = text(
    value.evidence_kind,
    "evidence_kind",
  ) as EvidenceKind;
  if (!(["real_export", "synthetic_fixture"] as const).includes(evidenceKind))
    throw new Error("evidence_kind is unsupported");
  const query = nullableText(value.query, "query");
  if (text(value.capture_time_basis, "capture_time_basis") !== "source_event")
    throw new Error("product signals must use source_event capture_time_basis");
  const position =
    value.position === null || value.position === undefined
      ? null
      : value.position;
  if (
    position !== null &&
    (typeof position !== "number" ||
      !Number.isInteger(position) ||
      position < 0)
  )
    throw new Error("position must be a non-negative integer");
  const candidateSet =
    value.candidate_set === null || value.candidate_set === undefined
      ? null
      : value.candidate_set;
  if (
    candidateSet !== null &&
    (!Array.isArray(candidateSet) ||
      candidateSet.some((item) => typeof item !== "string" || !item.trim()))
  )
    throw new Error("candidate_set must be string IDs");
  if (
    Array.isArray(candidateSet) &&
    new Set(candidateSet).size !== candidateSet.length
  )
    throw new Error("candidate_set must contain unique IDs");
  if (
    consent === "no_personal_data" &&
    (query !== null || candidateSet !== null)
  )
    throw new Error(
      "no_personal_data signals must not contain raw query or candidate_set",
    );
  const surface = text(value.surface, "surface") as ProductSignal["surface"];
  if (!["search", "photo", "print", "checkout"].includes(surface))
    throw new Error("surface is unsupported");
  if (
    eventName === "search_committed" ||
    eventName === "search_result_clicked" ||
    eventName === "search_no_results"
  ) {
    if (surface !== "search")
      throw new Error(`${eventName} requires search surface`);
  }
  if (eventName === "search_result_clicked") {
    if (!query || position === null || !candidateSet?.length)
      throw new Error(
        "search_result_clicked requires query, position, and candidate_set",
      );
    if (!candidateSet.includes(recordId))
      throw new Error("clicked canonical record must be a candidate");
    if (position >= candidateSet.length || candidateSet[position] !== recordId)
      throw new Error("clicked position must identify the clicked candidate");
    if (
      !nullableText(value.ranking_version) ||
      !nullableText(value.model_version) ||
      !nullableText(value.index_version)
    ) {
      throw new Error(
        "search_result_clicked requires ranking_version, model_version, and index_version",
      );
    }
  }
  return {
    schema_version: CONTENT_SIGNAL_SCHEMA,
    event_id: eventId,
    signal_class: "product_behavior",
    source_type: "product_analytics",
    event_name: eventName,
    captured_at: capturedAt,
    capture_time_basis: "source_event",
    timezone: "America/Toronto",
    canonical_record_id: recordId,
    visual_family_id: familyId,
    package_id: packageId,
    source_asset: sourceAsset,
    platform: "web",
    surface,
    metric_name: metricName,
    metric_value: metricValue,
    metric_definition: metricDefinition,
    observation_window: observationWindow,
    source,
    query,
    position,
    candidate_set: candidateSet as string[] | null,
    ranking_version: nullableText(value.ranking_version),
    model_version: nullableText(value.model_version),
    index_version: nullableText(value.index_version),
    experiment_assignment: experiment,
    propensity,
    safety_budget_id: safetyBudget,
    privacy_consent: consent,
    evidence_kind: evidenceKind,
    ground_truth_boundary: "reward_not_fact",
    identity_basis: "declared_identity",
    package_family_verification: "not_independently_verified",
  };
}

export function validateProductSignals(
  values: unknown[],
  identities: Map<string, ContentIdentity>,
): ProductSignal[] {
  const seen = new Set<string>();
  return values
    .map((value, index) => {
      const signal = validateProductSignal(value, identities);
      if (seen.has(signal.event_id))
        throw new Error(`duplicate product event_id ${signal.event_id}`);
      seen.add(signal.event_id);
      return signal;
    })
    .map((signal, index) => {
      if (!signal.event_id)
        throw new Error(`product signal ${index} missing event_id`);
      return signal;
    });
}

export function assertProductSignalsWithinDateRange(
  signals: ProductSignal[],
  startDate: string,
  endDate: string,
  toLocalDate: (timestamp: string) => string,
): void {
  const outside = signals.find((signal) => {
    const date = toLocalDate(signal.captured_at);
    return date < startDate || date > endDate;
  });
  if (outside)
    throw new Error(
      `product event ${outside.event_id} is outside requested window ${startDate}..${endDate}; policy=reject`,
    );
}

export function identityLookupKey(
  identity: Pick<ContentIdentity, "canonical_record_id" | "package_id">,
): string {
  return JSON.stringify([identity.canonical_record_id, identity.package_id]);
}

export function postLookupKey(platform: string, postId: string): string {
  return identityKey(platform, postId);
}

export function assertCompletePostJoins(
  postKeys: string[],
  identities: Map<string, ContentIdentity>,
): void {
  const missing = postKeys.filter((key) => !identities.has(key));
  if (missing.length)
    throw new Error(
      `missing explicit content identity joins: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}`,
    );
}
