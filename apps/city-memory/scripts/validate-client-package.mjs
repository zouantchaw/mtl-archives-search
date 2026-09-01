import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'index.html',
  'src/App.tsx',
  'src/PrintDeck.tsx',
  'src/SpatialScene.tsx',
  'src/data.ts',
  'src/styles.css',
  'public/media/archive-11.jpg',
  'public/media/archive-17.jpg',
  'public/media/archive-54.jpg',
  'public/media/archive-88.jpg',
  'public/media/atrium-cutaway-v2.jpg',
  'public/media/application-atrium-v2.jpg',
  'public/media/application-room-v1.jpg',
  'public/media/application-listening-v1.jpg',
];

const pdfPath = resolve(root, '../../output/pdf/city-memory-hotel-nelligan-reference-concept-v1.pdf');

const failures = [];
for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing required file: ${path}`);
}
if (!existsSync(pdfPath)) {
  failures.push('missing required PDF handoff: output/pdf/city-memory-hotel-nelligan-reference-concept-v1.pdf');
} else {
  const pdf = readFileSync(pdfPath);
  if (pdf.length < 100_000 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    failures.push('invalid or unexpectedly small PDF handoff');
  }
}

const sourceFiles = [];
const visit = (path) => {
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    if (statSync(child).isDirectory()) visit(child);
    else if (/\.(html|ts|tsx|css|json|md)$/.test(name)) sourceFiles.push(child);
  }
};
visit(join(root, 'src'));
sourceFiles.push(join(root, 'index.html'));

const bundledText = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const blockedPatterns = [
  [/\/Users\//, 'local filesystem path'],
  [/github\.com\/.+\/issues\/\d+/i, 'internal issue link'],
  [/alex lesage|zebulonperron\.com\/.*\.(jpg|png)/i, 'unapproved property imagery'],
  [/src\s*=\s*['\"]https?:\/\//i, 'external runtime image'],
];
for (const [pattern, label] of blockedPatterns) {
  if (pattern.test(bundledText)) failures.push(`client boundary violation: ${label}`);
}

for (const phrase of ['Conceptual massing · not a measured survey', 'production review required', 'not commissioned by or affiliated with Hôtel Nelligan']) {
  if (!bundledText.includes(phrase)) failures.push(`missing release boundary: ${phrase}`);
}

for (const phrase of ['$38,000 CAD', '40% start · 40% direction approval · 20% final handoff', 'Excluded']) {
  if (!bundledText.includes(phrase)) failures.push(`missing fixed offer term: ${phrase}`);
}

for (const id of [11, 17, 54, 88]) {
  if (!bundledText.includes(`id: ${id},`)) failures.push(`missing provenance record: ${id}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`City Memory client package valid: ${required.length} required source/media files, PDF handoff, 4 reviewed records, release boundaries, and fixed offer present.`);
