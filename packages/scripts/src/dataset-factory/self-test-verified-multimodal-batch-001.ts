import fs from 'node:fs';
import path from 'node:path';
import {
  MONOREPO_ROOT,
  VMI_FIXTURE_DIR,
  canonicalJson,
  deriveBenchmarkTasks,
  fileSha256,
  readJsonl,
  syntheticPackets,
  validatePacket,
  type VerifiedMultimodalPacket,
} from './verified-multimodal-batch-001-contract.js';

function expectFailure(label: string, mutate: (packet: VerifiedMultimodalPacket) => void): void {
  const packet = structuredClone(syntheticPackets()[0]);
  mutate(packet);
  try {
    validatePacket(packet);
  } catch {
    return;
  }
  throw new Error(`Expected fail-closed validation for ${label}`);
}

for (const packet of syntheticPackets()) validatePacket(packet);

expectFailure('visual claim without region', (packet) => {
  packet.evidence.find((item) => item.evidence_id === 'e-visual-sign')!.region_id = null;
});

expectFailure('external claim without URL', (packet) => {
  packet.evidence.find((item) => item.evidence_id === 'e-directory')!.external_source_url = null;
});

expectFailure('incomplete rights', (packet) => {
  packet.rights_attribution.attribution = '';
});

expectFailure('non-external verified status', (packet) => {
  packet.visual_observations[0].verified_status = 'externally_verified';
});

expectFailure('exact location without georeference', (packet) => {
  packet.externally_verified_claims[0].exact_location = true;
});

expectFailure('area without scale', (packet) => {
  packet.visual_observations[0].asserts_area_or_distance = true;
});

expectFailure('reviewer overlap', (packet) => {
  packet.review_state.independent_reviewer_id = packet.review_state.primary_reviewer_id;
});

expectFailure('benchmark from unresolved inference', (packet) => {
  packet.inferred_hypotheses[0].benchmark_eligible = true;
});

const fixtureDir = path.join(MONOREPO_ROOT, VMI_FIXTURE_DIR);
if (fs.existsSync(fixtureDir)) {
  const packetsPath = path.join(fixtureDir, 'packets.v1.jsonl');
  const benchmarkPath = path.join(fixtureDir, 'benchmark-tasks.v1.jsonl');
  const reportPath = path.join(fixtureDir, 'run-report.v1.json');
  const packets = readJsonl<VerifiedMultimodalPacket>(packetsPath);
  for (const packet of packets) validatePacket(packet);
  const derivedBenchmark = deriveBenchmarkTasks(packets);
  const fixtureBenchmark = readJsonl(benchmarkPath);
  if (canonicalJson(derivedBenchmark) !== canonicalJson(fixtureBenchmark)) {
    throw new Error('benchmark fixture is not derived from accepted external evidence');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
  if (report.packet_sha256 !== fileSha256(packetsPath)) throw new Error('run report packet digest drift');
  if (report.benchmark_sha256 !== fileSha256(benchmarkPath)) throw new Error('run report benchmark digest drift');
  if (report.foundation_incomplete !== true || report.processed_records !== 4) {
    throw new Error('run report must mark the synthetic pilot incomplete against issue #69');
  }
}

console.log(JSON.stringify({
  status: 'ok',
  adversarial_cases: 8,
  fixture_checked: fs.existsSync(fixtureDir),
}));
