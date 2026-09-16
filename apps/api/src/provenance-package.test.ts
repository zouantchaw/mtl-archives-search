import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGE_SCHEMA,
  assemblePackage,
  assemblePhoto,
  blockersForPhoto,
  claimsForUse,
  canonicalPhotoId,
  handleProvenancePackage,
  newPackageId,
  parsePhotoIds,
  unknownsForPhoto,
  type PackagePhotoInput,
  type PackageRow,
} from "./provenance-package";

const hotel: PackagePhotoInput = {
  metadataFilename: "mtl_archives_metadata_18557.json",
  name: "Women beside helicopters",
  dateValue: "1962",
  credits: "Archives de la Ville de Montréal",
  cote: "VM94-18557",
  description: "A sufficiently long archival description for this photograph.",
  externalUrl: "https://archivesdemontreal.ica-atom.org/example",
  portalTitle: null,
  portalDescription: null,
  portalCote: null,
  vlmCaption: "people near aircraft",
  reviewRequired: false,
  qualityLabels: [],
  qualityAction: null,
  qualitySeverity: null,
};

const undated: PackagePhotoInput = {
  ...hotel,
  metadataFilename: "mtl_archives_metadata_1.json",
  name: null,
  dateValue: null,
  credits: null,
  cote: null,
  description: null,
  externalUrl: null,
  vlmCaption: null,
  reviewRequired: true,
  qualityAction: "exclude_until_fixed",
};

function row(overrides: Partial<PackageRow> = {}): PackageRow {
  return {
    id: "pkg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    title: "A hotel wall",
    intended_use: "hotel_wall",
    query: "Photographs for a high-end Montreal hotel wall",
    photo_ids_json: JSON.stringify([hotel.metadataFilename]),
    review_state: "draft",
    reviewer_note: null,
    created_at: "2026-09-16T00:00:00.000Z",
    updated_at: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

test("canonical ids reject path tricks and cap at 24", () => {
  assert.equal(canonicalPhotoId("18557"), "mtl_archives_metadata_18557.json");
  assert.equal(canonicalPhotoId("../secret"), null);
  const ids = parsePhotoIds(Array.from({ length: 40 }, (_, i) => String(i + 1)));
  assert.equal(ids.length, 24);
});

test("package ids are unguessable pkg_ plus 32 hex chars", () => {
  const id = newPackageId();
  assert.match(id, /^pkg_[0-9a-f]{32}$/);
  assert.notEqual(id, newPackageId());
});

test("supplied layer never promotes the AI caption", () => {
  const photo = assemblePhoto(hotel, "hotel_wall");
  assert.equal(photo.supplied.title, "Women beside helicopters");
  assert.equal(photo.supplied.date, "1962");
  assert.equal(photo.supplied.credits, "Archives de la Ville de Montréal");
  assert.ok(photo.processing.aiCaptionUnverified);
  assert.ok(
    photo.unknowns.some((u) => /unverified AI caption/i.test(u)),
  );
  assert.equal(
    JSON.stringify(photo.supplied).includes("people near aircraft"),
    false,
  );
});

test("missing date, credit, and quality become unknowns and blockers", () => {
  const unknowns = unknownsForPhoto(undated);
  assert.ok(unknowns.some((u) => /Date not recorded/.test(u)));
  assert.ok(unknowns.some((u) => /Credit/.test(u)));
  const blockers = blockersForPhoto(undated, "hotel_wall");
  assert.ok(blockers.some((b) => /Credit required/.test(b)));
  assert.ok(blockers.some((b) => /exclude_until_fixed/.test(b)));
  assert.equal(assemblePhoto(undated, "hotel_wall").review.productionReady, false);
  assert.equal(assemblePhoto(hotel, "hotel_wall").review.productionReady, true);
});

test("client-ok is assembler review, not City certification", () => {
  const forbidden = claimsForUse("hotel_wall").forbidden.join(" ");
  assert.match(forbidden, /Not a City of Montréal certification/);
  const pkg = assemblePackage(
    row({ review_state: "client-ok" }),
    [hotel],
  );
  assert.equal(pkg.schema, PACKAGE_SCHEMA);
  assert.equal(pkg.review.state, "client-ok");
  assert.match(pkg.review.meaning, /not a City of Montréal certification/i);
  assert.equal(pkg.zones.output.clientOk, true);
  assert.match(pkg.disclaimer, /not City certification/);
});

test("missing records stay in the collection as missing ids", () => {
  const pkg = assemblePackage(
    row({
      photo_ids_json: JSON.stringify([
        hotel.metadataFilename,
        "mtl_archives_metadata_999.json",
      ]),
    }),
    [hotel],
  );
  assert.deepEqual(pkg.zones.collection.missingIds, [
    "mtl_archives_metadata_999.json",
  ]);
  assert.equal(pkg.photos.length, 1);
});

type MockRow = Record<string, unknown>;

function mockEnv(options: {
  secret?: string;
  packages?: PackageRow[];
  photos?: MockRow[];
}) {
  const packages = options.packages ?? [];
  const photos = options.photos ?? [];
  const db = {
    prepare(sql: string) {
      const run = async (params: unknown[]) => {
        if (sql.includes("FROM provenance_package WHERE id")) {
          return packages.find((p) => p.id === String(params[0])) ?? null;
        }
        if (sql.includes("INSERT INTO provenance_package")) {
          const existing = packages.findIndex((p) => p.id === String(params[0]));
          const next: PackageRow = {
            id: String(params[0]),
            title: params[1] == null ? null : String(params[1]),
            intended_use: String(params[2]),
            query: params[3] == null ? null : String(params[3]),
            photo_ids_json: String(params[4]),
            review_state: String(params[5]),
            reviewer_note: params[6] == null ? null : String(params[6]),
            created_at: String(params[7]),
            updated_at: String(params[8]),
          };
          if (existing >= 0) packages[existing] = next;
          else packages.push(next);
          return { success: true };
        }
        if (sql.includes("FROM manifest WHERE metadata_filename IN")) {
          const ids = new Set(params.map((v) => String(v)));
          return {
            results: photos.filter((row) =>
              ids.has(String(row.metadata_filename)),
            ),
          };
        }
        return { results: [] };
      };
      return {
        bind(...params: unknown[]) {
          return {
            first: async <T>() => (await run(params)) as T,
            all: async () => {
              const result = await run(params);
              if (result && typeof result === "object" && "results" in result)
                return result as { results: MockRow[] };
              return { results: [] };
            },
            run: async () => {
              await run(params);
              return { success: true };
            },
          };
        },
      };
    },
  };
  return {
    env: {
      DB: db as unknown as D1Database,
      RESEARCH_API_SECRET: options.secret,
    },
    packages,
  };
}

function photoRow(input: PackagePhotoInput): MockRow {
  return {
    metadata_filename: input.metadataFilename,
    name: input.name,
    date_value: input.dateValue,
    credits: input.credits,
    cote: input.cote,
    description: input.description,
    external_url: input.externalUrl,
    portal_title: input.portalTitle,
    portal_description: input.portalDescription,
    portal_cote: input.portalCote,
    vlm_caption: input.vlmCaption,
    taxonomy_review_required: input.reviewRequired ? 1 : 0,
    image_quality_labels: JSON.stringify(input.qualityLabels),
    image_quality_action: input.qualityAction,
    image_quality_severity: input.qualitySeverity,
  };
}

test("create requires the worker secret and get is public", async () => {
  const { env, packages } = mockEnv({
    secret: "s",
    photos: [photoRow(hotel)],
  });
  const denied = await handleProvenancePackage(
    new Request("https://worker/api/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: ["18557"],
        intendedUse: "hotel_wall",
        title: "A hotel wall",
      }),
    }),
    env,
    "/api/packages",
  );
  assert.equal(denied?.status, 401);

  const created = await handleProvenancePackage(
    new Request("https://worker/api/packages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer s",
      },
      body: JSON.stringify({
        ids: ["18557"],
        intendedUse: "hotel_wall",
        query: "hotel wall",
      }),
    }),
    env,
    "/api/packages",
  );
  assert.equal(created?.status, 201);
  const body = (await created!.json()) as { id: string; photos: unknown[] };
  assert.match(body.id, /^pkg_[0-9a-f]{32}$/);
  assert.equal(body.photos.length, 1);
  assert.equal(packages.length, 1);

  const got = await handleProvenancePackage(
    new Request(`https://worker/api/packages/${body.id}`),
    { DB: env.DB },
    `/api/packages/${body.id}`,
  );
  assert.equal(got?.status, 200);
  const fetched = (await got!.json()) as { review: { state: string } };
  assert.equal(fetched.review.state, "draft");
});

test("review updates state without rewriting photo records", async () => {
  const id = "pkg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const { env, packages } = mockEnv({
    secret: "s",
    packages: [row({ id })],
    photos: [photoRow(hotel)],
  });
  const reviewed = await handleProvenancePackage(
    new Request(`https://worker/api/packages/${id}/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer s",
      },
      body: JSON.stringify({ state: "client-ok", note: "Ready to share." }),
    }),
    env,
    `/api/packages/${id}/review`,
  );
  assert.equal(reviewed?.status, 200);
  const body = (await reviewed!.json()) as {
    review: { state: string; note: string };
  };
  assert.equal(body.review.state, "client-ok");
  assert.equal(body.review.note, "Ready to share.");
  assert.equal(packages[0].review_state, "client-ok");
  assert.equal(packages[0].photo_ids_json.includes("18557"), true);
});
