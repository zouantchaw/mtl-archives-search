import fs from 'node:fs';
import path from 'node:path';
import {
  MONOREPO_ROOT,
  VMI_FIXTURE_DIR,
  canonicalJson,
  deriveBenchmarkTasks,
  deriveRunReport,
  fileSha256,
  rejectedClaims,
  syntheticPackets,
  unresolvedClaims,
  validatePacket,
  writeJsonl,
} from './verified-multimodal-batch-001-contract.js';

const outputDir = path.join(MONOREPO_ROOT, VMI_FIXTURE_DIR);
fs.mkdirSync(outputDir, { recursive: true });

const packets = syntheticPackets();
for (const packet of packets) validatePacket(packet);

const benchmarkTasks = deriveBenchmarkTasks(packets);
const unresolved = unresolvedClaims(packets);
const rejected = rejectedClaims(packets);

const packetsPath = path.join(outputDir, 'packets.v1.jsonl');
const benchmarkPath = path.join(outputDir, 'benchmark-tasks.v1.jsonl');
const unresolvedPath = path.join(outputDir, 'unresolved-queue.v1.jsonl');
const rejectedPath = path.join(outputDir, 'rejected-hypotheses.v1.jsonl');
const reportPath = path.join(outputDir, 'run-report.v1.json');

writeJsonl(packetsPath, packets);
writeJsonl(benchmarkPath, benchmarkTasks);
writeJsonl(unresolvedPath, unresolved);
writeJsonl(rejectedPath, rejected);

const report = deriveRunReport(packets, benchmarkTasks, {
  packet_sha256: fileSha256(packetsPath),
  benchmark_sha256: fileSha256(benchmarkPath),
  unresolved_sha256: fileSha256(unresolvedPath),
  rejected_sha256: fileSha256(rejectedPath),
});

fs.writeFileSync(reportPath, `${canonicalJson(report)}\n`, 'utf-8');

console.log(JSON.stringify({
  status: 'ok',
  scope: report.scope,
  records: report.processed_records,
  benchmark_tasks: report.counts.benchmark_tasks,
  output: path.relative(MONOREPO_ROOT, outputDir),
}));
