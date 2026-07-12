import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { MONOREPO_ROOT } from './verified-multimodal-batch-001-contract.js';

const cli = path.join(MONOREPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const builder = path.join(MONOREPO_ROOT, 'packages/scripts/src/dataset-factory/build-real-pilot-candidate-selection-v1.ts');
const output = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/verified_multimodal_batch_001_real_pilot/selection');
const descriptor = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-selection-v1.json');
function run(args: string[], expectSuccess = true, env: NodeJS.ProcessEnv = process.env): string { const result = spawnSync(process.execPath, [cli, builder, ...args], { cwd: MONOREPO_ROOT, encoding: 'utf8', env }); if (expectSuccess) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0, 'tampered boundary unexpectedly passed'); return `${result.stdout}${result.stderr}`; }
function digestTree(): string { const files: string[] = []; const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); if (fs.statSync(file).isDirectory()) walk(file); else files.push(file); } }; walk(output); files.push(descriptor); return crypto.createHash('sha256').update(files.sort().map((file) => `${path.relative(MONOREPO_ROOT, file)}\t${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`).join('\n')).digest('hex'); }

run([]); const first = digestTree(); run([]); const second = digestTree(); assert.equal(first, second, 'real builder rebuild was not deterministic'); run(['--verify-output']);
const extra = path.join(output, 'unlisted-tamper.txt'); fs.writeFileSync(extra, 'tamper\n'); assert.match(run(['--verify-output'], false), /exact output membership mismatch/); fs.rmSync(extra); run(['--verify-output']);
const tamperedDescriptor = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'issue69-descriptor-')), 'descriptor.json'); fs.copyFileSync(path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/reproducibility-bundle-v1.json'), tamperedDescriptor); fs.appendFileSync(tamperedDescriptor, ' ');
assert.match(run([], false, { ...process.env, ISSUE69_RECOVERY_DESCRIPTOR: tamperedDescriptor }), /recovery descriptor approved hash drift/); fs.rmSync(path.dirname(tamperedDescriptor), { recursive: true, force: true });
console.log(JSON.stringify({ status: 'ok', deterministic_rebuild_sha256: second, actual_builder_runs: 3, descriptor_verifications: 2, exact_membership_tamper_rejected: true, approved_descriptor_tamper_rejected: true }));
