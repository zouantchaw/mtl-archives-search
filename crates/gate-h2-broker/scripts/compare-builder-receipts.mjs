import { createHash } from "node:crypto";
import { readContainedRegular } from "./secure-files.mjs";
import { parseStrictJson } from "./strict-json.mjs";
import { verifyBuilderImageReceipt } from "./verify-builder-image-receipt.mjs";

const OUTPUT_FIELDS = ["runtime_manifest", "rootfs", "layer", "config", "manifest", "index"];
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receiptBytes = (path) => readContainedRegular(path, 0o444, 1024 * 1024);

function loadReceipt(path) {
  const bytes = receiptBytes(path);
  try { return { value: parseStrictJson(bytes), bytes, sha256: sha256(bytes) }; } catch { fail("E_COMPARE_RECEIPT_JSON", `receipt is not strict JSON: ${path}`); }
}

function sameIdentity(left, right, field) {
  return left[field]?.sha256 === right[field]?.sha256 && left[field]?.bytes === right[field]?.bytes && left[field]?.media_type === right[field]?.media_type;
}

export function compareBuilderReceipts({ receiptA, outputA, acquiredA, receiptB, outputB, acquiredB, lockBytes, trustedContext }) {
  if (!Buffer.isBuffer(lockBytes)) fail("E_COMPARE_LOCK", "comparison requires the exact raw input lock bytes");
  const left = loadReceipt(receiptA), right = loadReceipt(receiptB);
  const leftVerified = verifyBuilderImageReceipt(left.value, { lockBytes, acquiredDirectory: acquiredA, outputDirectory: outputA, trustedContext });
  const rightVerified = verifyBuilderImageReceipt(right.value, { lockBytes, acquiredDirectory: acquiredB, outputDirectory: outputB, trustedContext });
  for (const field of OUTPUT_FIELDS) if (!sameIdentity(left.value, right.value, field)) fail("E_COMPARE_MISMATCH", `receipt output identity differs: ${field}`);
  if (left.value.final_image_reference !== right.value.final_image_reference) fail("E_COMPARE_MISMATCH", "final image reference differs");
  for (const field of OUTPUT_FIELDS) {
    const leftIdentity = left.value[field], rightIdentity = right.value[field];
    if (leftIdentity.sha256 !== rightIdentity.sha256 || leftIdentity.bytes !== rightIdentity.bytes) fail("E_COMPARE_MISMATCH", `output identity differs after verification: ${field}`);
  }
  return {
    schema_version: "gate_h2_builder_receipt_comparison_v1.0.0",
    status: "byte_reproducible_pending_host_independence",
    byte_reproducible: true,
    exact_output_identity: true,
    final_image_reference: left.value.final_image_reference,
    receipts: { left_sha256: left.sha256, right_sha256: right.sha256 },
    producers: {
      left_materializer: left.value.materializer,
      right_materializer: right.value.materializer,
      identity_collision: JSON.stringify(left.value.materializer) === JSON.stringify(right.value.materializer),
      host_independence: "unsupported_pending_signed_host_envelope",
    },
    verification: { left: leftVerified.outputs, right: rightVerified.outputs },
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const [receiptA, outputA, acquiredA, receiptB, outputB, acquiredB, lockPath, sourceCommit, sourceTree] = process.argv.slice(2);
  if (![receiptA, outputA, acquiredA, receiptB, outputB, acquiredB, lockPath, sourceCommit, sourceTree].every(Boolean)) fail("E_USAGE", "receipt/output/acquired paths for both bundles, lock, and trusted commit/tree are required");
  const lockBytes = readContainedRegular(lockPath, 0o444, 32 * 1024 * 1024);
  const result = compareBuilderReceipts({ receiptA, outputA, acquiredA, receiptB, outputB, acquiredB, lockBytes, trustedContext: { source_commit: sourceCommit, source_tree_sha256: sourceTree } });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
