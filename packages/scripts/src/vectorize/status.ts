import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Checkpoint = {
  nextIndex: number;
  total: number;
  updatedAt?: string;
  manifestPath?: string;
  inputPath?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const TEXT_CHECKPOINT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.checkpoints/vectorize-text.json');
const CLIP_CHECKPOINT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.checkpoints/vectorize-clip.json');
const TEXT_FAILURE_LOG = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.logs/vectorize-text-failures.ndjson');
const CLIP_FAILURE_LOG = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.logs/vectorize-clip-failures.ndjson');

function readCheckpoint(filePath: string): Checkpoint | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Checkpoint;
  } catch {
    return null;
  }
}

function readFailureStats(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return { totalFailures: 0, lastFailure: null as Record<string, unknown> | null };
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { totalFailures: 0, lastFailure: null as Record<string, unknown> | null };
  }

  let lastFailure: Record<string, unknown> | null = null;
  try {
    lastFailure = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  } catch {
    lastFailure = { parseError: 'Could not parse last failure entry.' };
  }

  return { totalFailures: lines.length, lastFailure };
}

function formatProgress(cp: Checkpoint | null) {
  if (!cp) return 'not-started';
  const next = Number.isFinite(cp.nextIndex) ? cp.nextIndex : 0;
  const total = Number.isFinite(cp.total) ? cp.total : 0;
  const percent = total > 0 ? ((next / total) * 100).toFixed(1) : '0.0';
  return `${next}/${total} (${percent}%)`;
}

function printSection(name: string, checkpointPath: string, failureLogPath: string) {
  const checkpoint = readCheckpoint(checkpointPath);
  const failures = readFailureStats(failureLogPath);
  const sourcePath = checkpoint?.manifestPath || checkpoint?.inputPath || 'n/a';

  console.log(`\n[${name}]`);
  console.log(`checkpoint: ${checkpointPath}`);
  console.log(`progress:   ${formatProgress(checkpoint)}`);
  console.log(`updated:    ${checkpoint?.updatedAt || 'n/a'}`);
  console.log(`source:     ${sourcePath}`);
  console.log(`fail log:   ${failureLogPath}`);
  console.log(`failures:   ${failures.totalFailures}`);

  if (failures.lastFailure) {
    const ts = typeof failures.lastFailure.timestamp === 'string' ? failures.lastFailure.timestamp : 'n/a';
    const err = typeof failures.lastFailure.error === 'string' ? failures.lastFailure.error : JSON.stringify(failures.lastFailure);
    console.log(`last fail:  ${ts} :: ${err}`);
  } else {
    console.log('last fail:  none');
  }
}

function main() {
  console.log('Vectorize Status');
  console.log(`workspace: ${MONOREPO_ROOT}`);
  printSection('text', TEXT_CHECKPOINT, TEXT_FAILURE_LOG);
  printSection('clip', CLIP_CHECKPOINT, CLIP_FAILURE_LOG);
}

main();
