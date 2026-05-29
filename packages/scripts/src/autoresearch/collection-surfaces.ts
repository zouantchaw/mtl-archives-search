import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collections_downstream.jsonl',
);
const DEFAULT_RECORDS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collection_surfaces',
);

type CollectionRow = {
  collection_id: string;
  title: string;
  summary: string;
  collection_type: 'theme' | 'sequence' | 'editorial' | string;
  tags?: string[];
  intended_surfaces?: string[];
  confidence?: number;
  usefulness_notes?: string[];
  representative_images?: Array<{
    id?: string;
    imageUrl?: string;
    imagePath?: string;
    title?: string;
  }>;
  record_count?: number;
};

type CollectionRecordRow = {
  collection_id: string;
  collection_title?: string;
  collection_type?: string;
  rank?: number;
  id: string;
  title?: string;
  date?: string;
  cote?: string;
  imageUrl?: string;
  imagePath?: string;
  score?: number;
  matchScore?: number;
  matchReasons?: string[];
  socialHook?: string;
  vlmCaption?: string;
};

type SurfaceRecord = {
  rank: number;
  id: string;
  title: string;
  date: string;
  cote: string;
  imageUrl: string;
  imagePath: string;
  score: number | null;
  matchScore: number | null;
  matchReasons: string[];
  socialHook: string;
  vlmCaption: string;
  sourceMetadata: {
    collectionId: string;
    collectionTitle: string;
    collectionType: string;
    sourceArtifact: string;
    sourceRank: number;
  };
  sequenceContext?: {
    order: number;
    previousId: string | null;
    nextId: string | null;
  };
};

type ReviewSurface = {
  surfaceId: string;
  collectionId: string;
  slug: string;
  title: string;
  summary: string;
  collectionType: string;
  confidence: number | null;
  tags: string[];
  intendedSurfaces: string[];
  reviewStatus: 'draft_review_only';
  publicRoute: false;
  approvalRequired: true;
  editorialAngle: string;
  usefulnessNotes: string[];
  searchBrowse: {
    title: string;
    description: string;
    querySeeds: string[];
    facets: string[];
    representativeImageIds: string[];
  };
  storyDraft: {
    headline: string;
    dek: string;
    narrativeBeats: string[];
    sequenceContext?: string;
  };
  socialCarousel: {
    hook: string;
    slideIdeas: string[];
  };
  records: SurfaceRecord[];
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value: string): string {
  return normalize(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
}

function htmlEscape(value: unknown): string {
  return cleanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Number(value.toFixed(4));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function splitSurfaceTerms(values: string[]): string[] {
  const terms = values.flatMap((value) => normalize(value).split(' ')).filter((value) => value.length > 3);
  return unique(terms).slice(0, 8);
}

function surfacePriority(collection: CollectionRow): number {
  const surfaces = new Set((collection.intended_surfaces ?? []).map(normalize));
  let score = Number(collection.confidence ?? 0) * 10;
  if (surfaces.has('story page')) score += 3;
  if (surfaces.has('search browse collection')) score += 3;
  if (collection.collection_type === 'sequence') score += 2;
  if (collection.collection_type === 'theme') score += 1;
  score += Math.min(Number(collection.record_count ?? 0), 24) / 24;
  return score;
}

function selectCollections(collections: CollectionRow[], requestedIds: string[], limit: number, minConfidence: number): CollectionRow[] {
  if (requestedIds.length) {
    const byId = new Map(collections.map((collection) => [collection.collection_id, collection]));
    return requestedIds.map((id) => byId.get(id)).filter((collection): collection is CollectionRow => Boolean(collection));
  }

  const eligible = collections
    .filter((collection) => Number(collection.confidence ?? 0) >= minConfidence)
    .sort((a, b) => surfacePriority(b) - surfacePriority(a));

  const selected: CollectionRow[] = [];
  const add = (collection: CollectionRow | undefined) => {
    if (collection && !selected.some((item) => item.collection_id === collection.collection_id)) selected.push(collection);
  };

  add(eligible.find((collection) => collection.collection_type === 'theme'));
  add(eligible.find((collection) => collection.collection_type === 'sequence'));
  add(eligible.find((collection) => collection.collection_type === 'editorial'));
  for (const collection of eligible) {
    add(collection);
    if (selected.length >= limit) break;
  }
  return selected.slice(0, limit);
}

function groupRecords(records: CollectionRecordRow[]): Map<string, CollectionRecordRow[]> {
  const grouped = new Map<string, CollectionRecordRow[]>();
  for (const record of records) {
    const collectionId = cleanText(record.collection_id);
    if (!collectionId) continue;
    const current = grouped.get(collectionId) ?? [];
    current.push(record);
    grouped.set(collectionId, current);
  }
  for (const [collectionId, rows] of grouped) {
    grouped.set(collectionId, rows.sort((a, b) => Number(a.rank ?? 0) - Number(b.rank ?? 0)));
  }
  return grouped;
}

function editorialAngle(collection: CollectionRow): string {
  if (collection.collection_type === 'sequence') return 'A coherent ordered sequence for route, before/after, or aerial-run review.';
  if ((collection.intended_surfaces ?? []).some((surface) => normalize(surface).includes('print'))) {
    return 'A product-review collection where image quality and metadata strength should be inspected before promotion.';
  }
  if ((collection.intended_surfaces ?? []).some((surface) => normalize(surface).includes('social'))) {
    return 'A social/story review collection with visual hooks that still need human editorial approval.';
  }
  return 'A search-browse collection candidate for editorial review.';
}

function querySeeds(collection: CollectionRow, records: CollectionRecordRow[]): string[] {
  const reasonTerms = records.flatMap((record) => record.matchReasons ?? []).slice(0, 30);
  return unique([
    ...(collection.tags ?? []),
    ...splitSurfaceTerms([collection.title, collection.summary, ...reasonTerms]),
  ]).slice(0, 12);
}

function buildStoryBeats(collection: CollectionRow, records: SurfaceRecord[]): string[] {
  const beats = [
    `Open with ${records[0]?.title || collection.title} as the visual anchor.`,
    `Explain why this set belongs together: ${collection.summary}`,
    'Use match reasons as evidence, not as public copy.',
  ];
  if (collection.collection_type === 'sequence') {
    beats.push('Preserve record order and review adjacent frames before writing any route or time-based claim.');
  } else {
    beats.push('Compare the top records for the strongest public-facing story, then select one lead image manually.');
  }
  return beats;
}

function buildSurface(collection: CollectionRow, sourceRows: CollectionRecordRow[], recordLimit: number): ReviewSurface {
  const selectedRows = sourceRows.slice(0, recordLimit);
  const isSequence = collection.collection_type === 'sequence' || collection.collection_id.startsWith('sequence-');
  const records: SurfaceRecord[] = selectedRows.map((record, index) => {
    const rank = Number(record.rank ?? index + 1);
    const item: SurfaceRecord = {
      rank,
      id: cleanText(record.id),
      title: cleanText(record.title || record.id),
      date: cleanText(record.date),
      cote: cleanText(record.cote),
      imageUrl: cleanText(record.imageUrl),
      imagePath: cleanText(record.imagePath),
      score: numberOrNull(record.score),
      matchScore: numberOrNull(record.matchScore),
      matchReasons: unique(record.matchReasons ?? []),
      socialHook: cleanText(record.socialHook),
      vlmCaption: cleanText(record.vlmCaption),
      sourceMetadata: {
        collectionId: collection.collection_id,
        collectionTitle: collection.title,
        collectionType: collection.collection_type,
        sourceArtifact: 'collection_records_downstream.jsonl',
        sourceRank: rank,
      },
    };
    if (isSequence) {
      item.sequenceContext = {
        order: rank,
        previousId: selectedRows[index - 1]?.id ?? null,
        nextId: selectedRows[index + 1]?.id ?? null,
      };
    }
    return item;
  });

  const surfaceSlug = slug(`${collection.collection_id}-${collection.title}`);
  const seeds = querySeeds(collection, sourceRows);
  return {
    surfaceId: `surface-${collection.collection_id}`,
    collectionId: collection.collection_id,
    slug: surfaceSlug,
    title: collection.title,
    summary: collection.summary,
    collectionType: collection.collection_type,
    confidence: numberOrNull(collection.confidence),
    tags: unique(collection.tags ?? []),
    intendedSurfaces: unique(collection.intended_surfaces ?? []),
    reviewStatus: 'draft_review_only',
    publicRoute: false,
    approvalRequired: true,
    editorialAngle: editorialAngle(collection),
    usefulnessNotes: unique(collection.usefulness_notes ?? []),
    searchBrowse: {
      title: collection.title,
      description: collection.summary,
      querySeeds: seeds,
      facets: unique([collection.collection_type, ...(collection.tags ?? []), ...seeds.slice(0, 5)]),
      representativeImageIds: records.slice(0, 6).map((record) => record.id),
    },
    storyDraft: {
      headline: collection.title,
      dek: collection.summary,
      narrativeBeats: buildStoryBeats(collection, records),
      sequenceContext: isSequence
        ? `Ordered sequence surface. Preserve ranks ${records[0]?.rank ?? 1} through ${records.at(-1)?.rank ?? records.length}.`
        : undefined,
    },
    socialCarousel: {
      hook: records.find((record) => record.socialHook)?.socialHook || collection.summary,
      slideIdeas: records.slice(0, 5).map((record) => `${record.title}: ${record.matchReasons.slice(0, 2).join(', ')}`),
    },
    records,
  };
}

function renderMarkdown(surfaces: ReviewSurface[], generatedAt: string): string {
  const lines: string[] = [
    '# Autoresearch Collection Review Surfaces',
    '',
    `Generated: ${generatedAt}`,
    '',
    'These are review-only product/story surfaces derived from visual collection downstream artifacts. They do not create public routes, publish stories, or mutate social packages.',
    '',
    '## Summary',
    '',
    `- Surfaces: ${surfaces.length}`,
    `- Records: ${surfaces.reduce((total, surface) => total + surface.records.length, 0)}`,
    `- Sequence surfaces: ${surfaces.filter((surface) => surface.collectionType === 'sequence').length}`,
    '',
  ];

  for (const surface of surfaces) {
    lines.push(`## ${surface.title}`, '');
    lines.push(surface.summary, '');
    lines.push(`- Surface ID: \`${surface.surfaceId}\``);
    lines.push(`- Collection ID: \`${surface.collectionId}\``);
    lines.push(`- Type: \`${surface.collectionType}\``);
    lines.push(`- Review status: \`${surface.reviewStatus}\``);
    lines.push(`- Public route: \`${surface.publicRoute}\``);
    lines.push(`- Approval required: \`${surface.approvalRequired}\``);
    lines.push(`- Intended surfaces: ${surface.intendedSurfaces.join(', ') || 'none'}`);
    lines.push(`- Query seeds: ${surface.searchBrowse.querySeeds.map((seed) => `\`${seed}\``).join(', ')}`);
    if (surface.storyDraft.sequenceContext) lines.push(`- Sequence context: ${surface.storyDraft.sequenceContext}`);
    lines.push('');
    lines.push('| Rank | Record | Match | Reasons | Source |');
    lines.push('| ---: | --- | ---: | --- | --- |');
    for (const record of surface.records) {
      const reasons = record.matchReasons.slice(0, 4).join(', ');
      const title = `${record.id}<br>${record.title}${record.date ? `<br>${record.date}` : ''}`;
      const source = `${record.sourceMetadata.sourceArtifact}<br>rank ${record.sourceMetadata.sourceRank}`;
      lines.push(`| ${record.rank} | ${title} | ${record.matchScore ?? ''} | ${reasons} | ${source} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderHtml(surfaces: ReviewSurface[], generatedAt: string): string {
  const cards = surfaces.map((surface) => {
    const records = surface.records.map((record) => `
      <article class="record">
        <img src="${htmlEscape(record.imageUrl)}" alt="${htmlEscape(record.title)}" loading="lazy">
        <div>
          <p class="kicker">Rank ${record.rank} · ${htmlEscape(record.id)}</p>
          <h3>${htmlEscape(record.title)}</h3>
          <p>${htmlEscape(record.date || record.cote || 'Undated')}</p>
          <p>${htmlEscape(record.matchReasons.slice(0, 4).join(', '))}</p>
          <p class="source">${htmlEscape(record.sourceMetadata.sourceArtifact)} · source rank ${record.sourceMetadata.sourceRank}</p>
        </div>
      </article>
    `).join('\n');
    return `
      <section class="surface">
        <p class="kicker">${htmlEscape(surface.collectionType)} · review only · public route false</p>
        <h2>${htmlEscape(surface.title)}</h2>
        <p>${htmlEscape(surface.summary)}</p>
        <p><strong>Editorial angle:</strong> ${htmlEscape(surface.editorialAngle)}</p>
        <p><strong>Query seeds:</strong> ${htmlEscape(surface.searchBrowse.querySeeds.join(', '))}</p>
        <div class="grid">${records}</div>
      </section>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Autoresearch Collection Review Surfaces</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f7f3ec; color: #211b16; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    h1, h2, h3 { line-height: 1.1; }
    .surface { border-top: 1px solid #c8bba9; padding: 28px 0; }
    .kicker, .source { color: #6f6256; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .record { background: #fffaf3; border: 1px solid #d8cab8; border-radius: 8px; overflow: hidden; }
    .record img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #dfd5c9; display: block; }
    .record div { padding: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Autoresearch Collection Review Surfaces</h1>
    <p>Generated ${htmlEscape(generatedAt)}. Review-only export; no public route or story has been shipped.</p>
    ${cards}
  </main>
</body>
</html>
`;
}

function compactSearchBrowse(surface: ReviewSurface): Record<string, unknown> {
  return {
    surfaceId: surface.surfaceId,
    collectionId: surface.collectionId,
    title: surface.searchBrowse.title,
    description: surface.searchBrowse.description,
    facets: surface.searchBrowse.facets,
    querySeeds: surface.searchBrowse.querySeeds,
    representativeImageIds: surface.searchBrowse.representativeImageIds,
    records: surface.records.map((record) => ({
      rank: record.rank,
      id: record.id,
      title: record.title,
      imageUrl: record.imageUrl,
      matchReasons: record.matchReasons,
      sourceMetadata: record.sourceMetadata,
    })),
    reviewStatus: surface.reviewStatus,
    publicRoute: surface.publicRoute,
  };
}

function compactStoryDraft(surface: ReviewSurface): Record<string, unknown> {
  return {
    surfaceId: surface.surfaceId,
    collectionId: surface.collectionId,
    headline: surface.storyDraft.headline,
    dek: surface.storyDraft.dek,
    narrativeBeats: surface.storyDraft.narrativeBeats,
    sequenceContext: surface.storyDraft.sequenceContext ?? null,
    leadRecord: surface.records[0] ?? null,
    supportingRecords: surface.records.slice(1, 8),
    approvalRequired: surface.approvalRequired,
    reviewStatus: surface.reviewStatus,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      records: { type: 'string', default: DEFAULT_RECORDS },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'collection-ids': { type: 'string', default: '' },
      'limit-collections': { type: 'string', default: '4' },
      'limit-records': { type: 'string', default: '12' },
      'min-confidence': { type: 'string', default: '0.85' },
    },
  });

  const collectionsPath = resolveRepoPath(values.collections!);
  const recordsPath = resolveRepoPath(values.records!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const requestedIds = cleanText(values['collection-ids']).split(',').map(cleanText).filter(Boolean);
  const limitCollections = Math.max(1, Number.parseInt(values['limit-collections']!, 10));
  const limitRecords = Math.max(1, Number.parseInt(values['limit-records']!, 10));
  const minConfidence = Math.max(0, Number.parseFloat(values['min-confidence']!));

  if (!fs.existsSync(collectionsPath)) throw new Error(`Missing collections input: ${collectionsPath}`);
  if (!fs.existsSync(recordsPath)) throw new Error(`Missing collection records input: ${recordsPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const collections = readJsonl<CollectionRow>(collectionsPath);
  const records = readJsonl<CollectionRecordRow>(recordsPath);
  const recordsByCollection = groupRecords(records);
  const selectedCollections = selectCollections(collections, requestedIds, limitCollections, minConfidence);
  const surfaces = selectedCollections.map((collection) =>
    buildSurface(collection, recordsByCollection.get(collection.collection_id) ?? [], limitRecords),
  ).filter((surface) => surface.records.length > 0);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    inputs: {
      collections: path.relative(MONOREPO_ROOT, collectionsPath),
      records: path.relative(MONOREPO_ROOT, recordsPath),
    },
    summary: {
      inputCollections: collections.length,
      inputRecords: records.length,
      selectedSurfaces: surfaces.length,
      selectedRecords: surfaces.reduce((total, surface) => total + surface.records.length, 0),
      sequenceSurfaces: surfaces.filter((surface) => surface.collectionType === 'sequence').length,
      publicRoutesCreated: 0,
      approvalRequired: true,
    },
    surfaces,
  };

  fs.writeFileSync(path.join(outputDir, 'collection_surfaces.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'collection_surfaces.md'), renderMarkdown(surfaces, generatedAt));
  fs.writeFileSync(path.join(outputDir, 'review_gallery.html'), renderHtml(surfaces, generatedAt));
  writeJsonl(path.join(outputDir, 'surfaces_downstream.jsonl'), surfaces);
  writeJsonl(path.join(outputDir, 'search_browse_collections.jsonl'), surfaces.map(compactSearchBrowse));
  writeJsonl(path.join(outputDir, 'story_drafts.jsonl'), surfaces.map(compactStoryDraft));

  console.log(`[autoresearch:collection-surfaces] output=${outputDir}`);
  console.log(`[autoresearch:collection-surfaces] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
