import fs from "node:fs";
import {
  parseStrictJson,
  validateAuthorityEnvelopeV2,
  validateTranscript,
} from "./https-exchange-contract-v1.js";

const [manifestPath, transcriptPath, envelopePath, signerTrustEntrySha256] = process.argv.slice(2);
if (!manifestPath || !transcriptPath || !envelopePath || !/^[a-f0-9]{64}$/.test(signerTrustEntrySha256 ?? "")) {
  throw new Error("usage: validate-broker-runtime-artifacts MANIFEST TRANSCRIPT ENVELOPE TRUST_ENTRY_SHA256");
}
const manifest = parseStrictJson(fs.readFileSync(manifestPath));
const transcriptBytes = fs.readFileSync(transcriptPath);
const transcript = parseStrictJson(transcriptBytes);
const envelope = parseStrictJson(fs.readFileSync(envelopePath));
validateTranscript(transcript, manifest);
validateAuthorityEnvelopeV2(envelope, transcriptBytes, manifest, signerTrustEntrySha256);
console.log("gate H2 broker runtime artifacts: valid");
