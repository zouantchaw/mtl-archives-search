/** Reading-room collections as portable provenance packages. Does not recaption. */

export const PACKAGE_SCHEMA = "mtl-archives.provenance-package.v1";
export const PACKAGE_ID_RE = /^pkg_[0-9a-f]{32}$/;
export const MAX_PACKAGE_PHOTOS = 24;

export const INTENDED_USES = [
  "hotel_wall",
  "print",
  "research",
  "client_review",
] as const;
export type IntendedUse = (typeof INTENDED_USES)[number];

export const REVIEW_STATES = ["draft", "client-ok", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const CLIENT_OK_MEANING =
  "Assembler review for this handoff. Not a City of Montréal certification, license, or rights clearance.";

export const PACKAGE_DISCLAIMER =
  "Supplied fields come from the canonical archive record. AI captions and visual observations are not claims. client-ok is assembler review, not City certification. Original bytes are never overwritten.";

const PHOTO_ID_RE = /^mtl_archives_metadata_\d+\.json$/;

export type PackagePhotoInput = {
  metadataFilename: string;
  name: string | null;
  dateValue: string | null;
  credits: string | null;
  cote: string | null;
  description: string | null;
  externalUrl: string | null;
  portalTitle: string | null;
  portalDescription: string | null;
  portalCote: string | null;
  vlmCaption: string | null;
  reviewRequired: boolean;
  qualityLabels: string[];
  qualityAction: string | null;
  qualitySeverity: string | null;
};

export type PackageRow = {
  id: string;
  title: string | null;
  intended_use: string;
  query: string | null;
  photo_ids_json: string;
  review_state: string;
  reviewer_note: string | null;
  created_at: string;
  updated_at: string;
};

export type PackagePhoto = {
  id: string;
  archiveUrl: string;
  supplied: {
    title: string | null;
    date: string | null;
    credits: string | null;
    cote: string | null;
    description: string | null;
    sourceUrl: string | null;
  };
  claims: { allowed: string[]; forbidden: string[] };
  unknowns: string[];
  review: { blockers: string[]; productionReady: boolean };
  processing: {
    qualityLabels: string[];
    qualityAction: string | null;
    qualitySeverity: string | null;
    reviewRequired: boolean;
    aiCaptionUnverified: boolean;
  };
};

export type ProvenancePackage = {
  schema: typeof PACKAGE_SCHEMA;
  id: string;
  title: string | null;
  query: string | null;
  intendedUse: IntendedUse;
  review: {
    state: ReviewState;
    note: string | null;
    updatedAt: string;
    meaning: string;
  };
  zones: {
    collection: { photoCount: number; photoIds: string[]; missingIds: string[] };
    processing: { generatedAt: string; note: string };
    review: { state: ReviewState };
    output: { clientOk: boolean; export: "json" };
  };
  photos: PackagePhoto[];
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
};

export interface PackageStorage {
  get(id: string): Promise<PackageRow | null>;
  put(row: PackageRow): Promise<void>;
}

export class MemoryPackageStorage implements PackageStorage {
  rows = new Map<string, PackageRow>();
  async get(id: string) {
    return this.rows.get(id) || null;
  }
  async put(row: PackageRow) {
    this.rows.set(row.id, { ...row });
  }
}

export class D1PackageStorage implements PackageStorage {
  constructor(private db: D1Database) {}
  async get(id: string) {
    return this.db
      .prepare("SELECT * FROM provenance_package WHERE id = ?")
      .bind(id)
      .first<PackageRow>();
  }
  async put(row: PackageRow) {
    await this.db
      .prepare(
        `INSERT INTO provenance_package
          (id, title, intended_use, query, photo_ids_json, review_state, reviewer_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           review_state=excluded.review_state,
           reviewer_note=excluded.reviewer_note,
           updated_at=excluded.updated_at`,
      )
      .bind(
        row.id,
        row.title,
        row.intended_use,
        row.query,
        row.photo_ids_json,
        row.review_state,
        row.reviewer_note,
        row.created_at,
        row.updated_at,
      )
      .run();
  }
}

export function newPackageId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return (
    "pkg_" +
    [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

export function canonicalPhotoId(value: string) {
  const n = value.replace(/[^\d]/g, "");
  if (!n) return null;
  const id = `mtl_archives_metadata_${n}.json`;
  return PHOTO_ID_RE.test(id) ? id : null;
}

export function parseIntendedUse(value: unknown): IntendedUse | null {
  return INTENDED_USES.includes(value as IntendedUse)
    ? (value as IntendedUse)
    : null;
}

export function parseReviewState(value: unknown): ReviewState | null {
  return REVIEW_STATES.includes(value as ReviewState)
    ? (value as ReviewState)
    : null;
}

export function claimsForUse(use: IntendedUse) {
  const forbidden = [
    "Not a City of Montréal certification or rights clearance.",
    "Original archive bytes are not altered.",
    "AI captions and visual observations are not approved claims.",
    "client-ok is assembler review, not a licensing decision.",
  ];
  if (use === "hotel_wall" || use === "print") {
    return {
      allowed: [
        "Source-linked display or print with visible credit.",
        "Share this package as a production handoff, not as a cleared license.",
      ],
      forbidden: [
        ...forbidden,
        "Do not crop out credit or invent a date.",
      ],
    };
  }
  if (use === "research") {
    return {
      allowed: [
        "Study and source-linked citation.",
        "Share unresolved questions with the recipient.",
      ],
      forbidden,
    };
  }
  return {
    allowed: [
      "Internal review of selected records, sources, and unknowns.",
    ],
    forbidden,
  };
}

function text(value: string | null | undefined) {
  const t = value?.trim() ?? "";
  if (!t || /^(S\/O|N\/A)$/i.test(t)) return null;
  return t;
}

export function unknownsForPhoto(photo: PackagePhotoInput) {
  const unknowns: string[] = [];
  if (!text(photo.dateValue)) unknowns.push("Date not recorded.");
  if (!text(photo.credits)) unknowns.push("Credit / rights holder not recorded.");
  if (!text(photo.cote) && !text(photo.portalCote))
    unknowns.push("Archival cote not recorded.");
  if (!text(photo.externalUrl)) unknowns.push("Original source URL not recorded.");
  if (!text(photo.description) && !text(photo.portalDescription))
    unknowns.push("Archival description not recorded.");
  if (photo.reviewRequired) unknowns.push("Taxonomy marked for human review.");
  if (photo.qualityAction)
    unknowns.push(`Image quality action: ${photo.qualityAction}.`);
  if (text(photo.vlmCaption))
    unknowns.push("An unverified AI caption exists; it is not a supplied fact.");
  return unknowns;
}

export function blockersForPhoto(photo: PackagePhotoInput, use: IntendedUse) {
  const blockers: string[] = [];
  if ((use === "hotel_wall" || use === "print") && !text(photo.credits)) {
    blockers.push("Credit required before production display or print.");
  }
  if (photo.qualityAction === "exclude_until_fixed") {
    blockers.push("Quality flag exclude_until_fixed.");
  }
  if (photo.reviewRequired && (use === "hotel_wall" || use === "print")) {
    blockers.push("Taxonomy review required before production use.");
  }
  return blockers;
}

export function assemblePhoto(
  photo: PackagePhotoInput,
  use: IntendedUse,
): PackagePhoto {
  const cote = text(photo.cote) || text(photo.portalCote);
  const unknowns = unknownsForPhoto(photo);
  const blockers = blockersForPhoto(photo, use);
  return {
    id: photo.metadataFilename,
    archiveUrl: `/photo/${photo.metadataFilename.replace(/\.json$/, "")}`,
    supplied: {
      title: text(photo.name) || text(photo.portalTitle),
      date: text(photo.dateValue),
      credits: text(photo.credits),
      cote,
      description: text(photo.description) || text(photo.portalDescription),
      sourceUrl: text(photo.externalUrl),
    },
    claims: claimsForUse(use),
    unknowns,
    review: {
      blockers,
      productionReady: blockers.length === 0,
    },
    processing: {
      qualityLabels: photo.qualityLabels,
      qualityAction: photo.qualityAction,
      qualitySeverity: photo.qualitySeverity,
      reviewRequired: photo.reviewRequired,
      aiCaptionUnverified: Boolean(text(photo.vlmCaption)),
    },
  };
}

export function assemblePackage(
  row: PackageRow,
  photos: PackagePhotoInput[],
): ProvenancePackage {
  const use = parseIntendedUse(row.intended_use) ?? "client_review";
  const requested = parsePhotoIds(row.photo_ids_json);
  const byId = new Map(photos.map((p) => [p.metadataFilename, p]));
  const found = requested
    .map((id) => byId.get(id))
    .filter((p): p is PackagePhotoInput => Boolean(p));
  const missingIds = requested.filter((id) => !byId.has(id));
  const assembled = found.map((p) => assemblePhoto(p, use));
  const state = parseReviewState(row.review_state) ?? "draft";
  return {
    schema: PACKAGE_SCHEMA,
    id: row.id,
    title: text(row.title),
    query: text(row.query),
    intendedUse: use,
    review: {
      state,
      note: text(row.reviewer_note),
      updatedAt: row.updated_at,
      meaning: CLIENT_OK_MEANING,
    },
    zones: {
      collection: {
        photoCount: assembled.length,
        photoIds: requested,
        missingIds,
      },
      processing: {
        generatedAt: new Date().toISOString(),
        note: "Unknowns and quality flags are computed from live D1 records. They are not approved claims.",
      },
      review: { state },
      output: { clientOk: state === "client-ok", export: "json" },
    },
    photos: assembled,
    disclaimer: PACKAGE_DISCLAIMER,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parsePhotoIds(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : String(value).split(",");
          } catch {
            return String(value).split(",");
          }
        })()
      : [];
  const ids = [
    ...new Set(
      raw
        .map((v) => canonicalPhotoId(String(v)))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  return ids.slice(0, MAX_PACKAGE_PHOTOS);
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    return [];
  }
  return [];
}

function nullable(value: unknown) {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t : null;
}

export function rowToPhotoInput(row: Record<string, unknown>): PackagePhotoInput {
  return {
    metadataFilename: String(row.metadata_filename),
    name: nullable(row.name),
    dateValue: nullable(row.date_value),
    credits: nullable(row.credits),
    cote: nullable(row.cote),
    description: nullable(row.description),
    externalUrl: nullable(row.external_url),
    portalTitle: nullable(row.portal_title),
    portalDescription: nullable(row.portal_description),
    portalCote: nullable(row.portal_cote),
    vlmCaption: nullable(row.vlm_caption),
    reviewRequired: Boolean(Number(row.taxonomy_review_required ?? 0)),
    qualityLabels: parseJsonArray(row.image_quality_labels),
    qualityAction: nullable(row.image_quality_action),
    qualitySeverity: nullable(row.image_quality_severity),
  };
}

const PHOTO_SELECT = `metadata_filename, name, date_value, credits, cote, description, external_url, portal_title, portal_description, portal_cote, vlm_caption, taxonomy_review_required, image_quality_labels, image_quality_severity, image_quality_action`;

export async function loadPackagePhotos(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results = [] } = await db
    .prepare(
      `SELECT ${PHOTO_SELECT} FROM manifest WHERE metadata_filename IN (${placeholders})`,
    )
    .bind(...ids)
    .all<Record<string, unknown>>();
  const byId = new Map(
    results.map((row) => [String(row.metadata_filename), rowToPhotoInput(row)]),
  );
  return ids.map((id) => byId.get(id)).filter((p): p is PackagePhotoInput => Boolean(p));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function authorized(request: Request, secret?: string) {
  return Boolean(secret) && request.headers.get("Authorization") === `Bearer ${secret}`;
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const CREATE_PATH = "/api/packages";
const GET_PATH = /^\/api\/packages\/(pkg_[0-9a-f]{32})$/;
const REVIEW_PATH = /^\/api\/packages\/(pkg_[0-9a-f]{32})\/review$/;

export async function handleProvenancePackage(
  request: Request,
  env: { DB: D1Database; RESEARCH_API_SECRET?: string },
  pathname: string,
): Promise<Response | null> {
  if (pathname === CREATE_PATH) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!authorized(request, env.RESEARCH_API_SECRET))
      return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON." }, 400);
    const intendedUse = parseIntendedUse(body.intendedUse ?? body.intended_use);
    const photoIds = parsePhotoIds(body.ids ?? body.photoIds ?? body.photo_ids);
    if (!intendedUse) return json({ error: "Invalid intended use." }, 400);
    if (!photoIds.length) return json({ error: "Select at least one photograph." }, 400);
    const now = new Date().toISOString();
    const row: PackageRow = {
      id: newPackageId(),
      title: typeof body.title === "string" ? body.title.slice(0, 200) : null,
      intended_use: intendedUse,
      query: typeof body.query === "string" ? body.query.slice(0, 240) : null,
      photo_ids_json: JSON.stringify(photoIds),
      review_state: "draft",
      reviewer_note: null,
      created_at: now,
      updated_at: now,
    };
    const store = new D1PackageStorage(env.DB);
    await store.put(row);
    const photos = await loadPackagePhotos(env.DB, photoIds);
    return json(assemblePackage(row, photos), 201);
  }

  const getMatch = pathname.match(GET_PATH);
  if (getMatch) {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const store = new D1PackageStorage(env.DB);
    const row = await store.get(getMatch[1]);
    if (!row) return json({ error: "Package not found" }, 404);
    const photos = await loadPackagePhotos(env.DB, parsePhotoIds(row.photo_ids_json));
    return json(assemblePackage(row, photos));
  }

  const reviewMatch = pathname.match(REVIEW_PATH);
  if (reviewMatch) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!authorized(request, env.RESEARCH_API_SECRET))
      return json({ error: "Unauthorized" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON." }, 400);
    const state = parseReviewState(body.state ?? body.review_state);
    if (!state) return json({ error: "Invalid review state." }, 400);
    const store = new D1PackageStorage(env.DB);
    const row = await store.get(reviewMatch[1]);
    if (!row) return json({ error: "Package not found" }, 404);
    const next: PackageRow = {
      ...row,
      review_state: state,
      reviewer_note:
        typeof body.note === "string" ? body.note.slice(0, 2000) : row.reviewer_note,
      updated_at: new Date().toISOString(),
    };
    await store.put(next);
    const photos = await loadPackagePhotos(env.DB, parsePhotoIds(next.photo_ids_json));
    return json(assemblePackage(next, photos));
  }

  return null;
}
