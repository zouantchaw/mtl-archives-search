import fs from "node:fs";
import {
  parseStrictJson,
  validateAuthorityEnvelopeV2,
  validateTranscript,
} from "./https-exchange-contract-v1.js";

const [manifestPath, transcriptPath, envelopePath, signerTrustEntryPath] = process.argv.slice(2);
if (!manifestPath || !transcriptPath || !envelopePath || !signerTrustEntryPath) {
  throw new Error("usage: validate-broker-runtime-artifacts MANIFEST TRANSCRIPT ENVELOPE SIGNER_TRUST_ENTRY");
}
const manifest = parseStrictJson(fs.readFileSync(manifestPath));
const transcriptBytes = fs.readFileSync(transcriptPath);
const transcript = parseStrictJson(transcriptBytes);
const envelope = parseStrictJson(fs.readFileSync(envelopePath));
const signerTrustEntryBytes = fs.readFileSync(signerTrustEntryPath);
validateTranscript(transcript, manifest);
validateAuthorityEnvelopeV2(envelope, transcriptBytes, manifest, signerTrustEntryBytes);
console.log("gate H2 broker runtime artifacts: valid");
