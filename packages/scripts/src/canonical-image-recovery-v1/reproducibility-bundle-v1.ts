import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DESCRIPTOR = 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/reproducibility-bundle-v1.json';
const CONTRACT = 'canonical_image_recovery_reproducibility_bundle_v1';
const EXACT_FILES = [
  'data/mtl_archives/manifest_clean.jsonl.gz',
  'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl',
  'data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl',
  'docs/dataset-factory/fixtures/visual-family-graph-v1/review-adjudications.jsonl',
] as const;
const FILE_TREES = [
  'data/mtl_archives/reports/visual_family_graph_v1/canonical_local',
  'data/mtl_archives/reports/visual_family_graph_v1/input',
  'data/mtl_archives/reports/visual_family_graph_v1/phash',
  'data/mtl_archives/reports/canonical_image_recovery_v1/derivatives',
  'data/mtl_archives/reports/canonical_image_recovery_v1/graph-after',
  'data/mtl_archives/reports/canonical_image_recovery_v1/search-evaluation',
  'docs/dataset-factory/fixtures/canonical-image-recovery-v1/registered-quality-derivatives',
] as const;
const RECOVERY_FILES = [
  'recovery-ledger-v1.jsonl', 'recovery-report-v1.json', 'r2-remediation-plan-no-apply-v1.jsonl',
  'source-size-inventory-v1.jsonl', 'successor-phash-features-v1.jsonl', 'successor-phash-failures-v1.jsonl',
  'successor-phash-report-v1.json', 'graph-impact-report-v1.json',
].map((name) => `data/mtl_archives/reports/canonical_image_recovery_v1/${name}`);

type Member = { path: string; bytes: number; sha256: string };
type Descriptor = { schema_version: string; artifact_contract: string; cache_key: string; bundle: { sha256: string; bytes: number }; tree_sha256: string; counts: { files: number; bytes: number }; members: Member[] };
const digest = (value: Buffer | string): string => crypto.createHash('sha256').update(value).digest('hex');
const slash = (value: string): string => value.split(path.sep).join('/');

function collect(root: string): Member[] {
  const paths = [...EXACT_FILES, ...RECOVERY_FILES];
  for (const tree of FILE_TREES) {
    const absolute = path.join(root, tree);
    for (const entry of fs.readdirSync(absolute, { recursive: true, withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`bundle source contains symlink: ${tree}/${entry.name}`);
      if (entry.isFile()) paths.push(slash(path.relative(root, path.join(entry.parentPath, entry.name))));
    }
  }
  return [...new Set(paths)].sort().map((relative): Member => {
    if (relative.includes('..') || path.isAbsolute(relative)) throw new Error(`unsafe bundle member: ${relative}`);
    const absolute = path.join(root, relative); const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`bundle member is not a regular file: ${relative}`);
    return { path: relative, bytes: stat.size, sha256: digest(fs.readFileSync(absolute)) };
  });
}

function treeDigest(members: Member[]): string {
  return digest(members.map((row) => `${row.path}\t${row.sha256}\t${row.bytes}`).join('\n') + '\n');
}

function readDescriptor(root: string): Descriptor {
  return JSON.parse(fs.readFileSync(path.join(root, DESCRIPTOR), 'utf8')) as Descriptor;
}

function inspectArchive(bundle: string, descriptor: Descriptor): void {
  const stat = fs.statSync(bundle);
  if (stat.size !== descriptor.bundle.bytes || digest(fs.readFileSync(bundle)) !== descriptor.bundle.sha256) throw new Error('bundle byte hash mismatch');
  const lines = execFileSync('tar', ['-tzvf', bundle], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const entries = lines.map((line) => ({ type: line[0], name: line.trim().split(/\s+/).at(-1)! }));
  if (entries.some((entry) => entry.type !== '-')) throw new Error('bundle contains non-regular member');
  const expected = descriptor.members.map((row) => row.path);
  const actual = entries.map((entry) => entry.name).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) throw new Error('bundle contains unexpected or omitted members');
  if (actual.some((name) => path.isAbsolute(name) || name.split('/').includes('..'))) throw new Error('bundle contains traversal member');
}

function verifyExtracted(root: string, descriptor: Descriptor): void {
  const actual = collect(root);
  if (JSON.stringify(actual) !== JSON.stringify(descriptor.members) || treeDigest(actual) !== descriptor.tree_sha256) throw new Error('restored member manifest mismatch');
}

function build(root: string, bundle: string): void {
  const members = collect(root); fs.mkdirSync(path.dirname(bundle), { recursive: true });
  execFileSync('tar', ['-czf', bundle, '-C', root, ...members.map((row) => row.path)], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bundleBytes = fs.statSync(bundle).size; const bundleSha = digest(fs.readFileSync(bundle));
  const descriptor: Descriptor = { schema_version: 'canonical_image_recovery_reproducibility_bundle_v1.0.0', artifact_contract: CONTRACT,
    cache_key: `bundles/issue-77/canonical-image-recovery-v1-${bundleSha}.tar.gz`, bundle: { sha256: bundleSha, bytes: bundleBytes },
    tree_sha256: treeDigest(members), counts: { files: members.length, bytes: members.reduce((sum, row) => sum + row.bytes, 0) }, members };
  fs.writeFileSync(path.join(root, DESCRIPTOR), `${JSON.stringify(descriptor, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'built', ...descriptor }));
}

function restore(root: string, bundle: string): void {
  const descriptor = readDescriptor(root); inspectArchive(bundle, descriptor);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'issue77-restore-'));
  try {
    execFileSync('tar', ['-xzf', bundle, '-C', staging]); verifyExtracted(staging, descriptor);
    for (const member of descriptor.members) {
      const source = path.join(staging, member.path); const target = path.join(root, member.path);
      const parent = path.dirname(target); fs.mkdirSync(parent, { recursive: true });
      const realParent = fs.realpathSync(parent); const realRoot = fs.realpathSync(root);
      if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) throw new Error(`restore path escapes root: ${member.path}`);
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`restore target is unsafe: ${member.path}`);
        if (digest(fs.readFileSync(target)) !== member.sha256) throw new Error(`restore would overwrite different file: ${member.path}`);
      } else fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
    verifyExtracted(root, descriptor);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  console.log(JSON.stringify({ status: 'restored', cache_key: descriptor.cache_key, bundle_sha256: descriptor.bundle.sha256, files: descriptor.counts.files }));
}

const { values } = parseArgs({ options: { mode: { type: 'string' }, bundle: { type: 'string' }, root: { type: 'string', default: ROOT } } });
if (!values.mode || !values.bundle) throw new Error('--mode build|verify|restore and --bundle are required');
const root = path.resolve(values.root!); const bundle = path.resolve(values.bundle);
if (values.mode === 'build') build(root, bundle);
else if (values.mode === 'verify') { const descriptor = readDescriptor(root); inspectArchive(bundle, descriptor); console.log(JSON.stringify({ status: 'verified', cache_key: descriptor.cache_key, bundle_sha256: descriptor.bundle.sha256 })); }
else if (values.mode === 'restore') restore(root, bundle);
else throw new Error(`unsupported mode: ${values.mode}`);
