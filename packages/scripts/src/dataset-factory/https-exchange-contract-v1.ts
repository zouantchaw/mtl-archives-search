import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { domainToASCII, domainToUnicode } from "node:url";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCHEMA_ROOT = path.join(ROOT, "docs/dataset-factory/schemas/reviewed-metrics-v2");
const FIXTURE_ROOT = path.join(ROOT, "docs/dataset-factory/fixtures/https-exchange-contract-v1");
const Ajv2020 = Ajv2020Import as unknown as new (options: object) => any;
const addFormats = addFormatsImport as unknown as (ajv: any) => void;

export class HttpsExchangeContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "HttpsExchangeContractError";
  }
}

function fail(code: string, message: string): never {
  throw new HttpsExchangeContractError(code, message);
}

class StrictJsonParser {
  private index = 0;
  constructor(private readonly source: string) {}

  parse(): Json {
    const value = this.value();
    this.ws();
    if (this.index !== this.source.length) fail("HTTPS_JSON_SYNTAX", "trailing JSON content");
    return value;
  }

  private ws(): void { while (/\s/.test(this.source[this.index] ?? "") && /[\t\n\r ]/.test(this.source[this.index])) this.index++; }
  private value(): Json {
    this.ws();
    const char = this.source[this.index];
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"') return this.string();
    if (this.source.startsWith("true", this.index)) { this.index += 4; return true; }
    if (this.source.startsWith("false", this.index)) { this.index += 5; return false; }
    if (this.source.startsWith("null", this.index)) { this.index += 4; return null; }
    if (char === "-" || /[0-9]/.test(char ?? "")) return this.integer();
    return fail("HTTPS_JSON_SYNTAX", `unexpected token at byte-character ${this.index}`);
  }
  private object(): { [key: string]: Json } {
    this.index++;
    const result: { [key: string]: Json } = Object.create(null);
    const keys = new Set<string>();
    this.ws();
    if (this.source[this.index] === "}") { this.index++; return result; }
    while (true) {
      this.ws();
      if (this.source[this.index] !== '"') fail("HTTPS_JSON_SYNTAX", "object key must be a string");
      const key = this.string();
      if (keys.has(key)) fail("HTTPS_JSON_DUPLICATE_KEY", `duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.ws();
      if (this.source[this.index++] !== ":") fail("HTTPS_JSON_SYNTAX", "missing object colon");
      result[key] = this.value();
      this.ws();
      const delimiter = this.source[this.index++];
      if (delimiter === "}") return result;
      if (delimiter !== ",") fail("HTTPS_JSON_SYNTAX", "missing object delimiter");
    }
  }
  private array(): Json[] {
    this.index++;
    const result: Json[] = [];
    this.ws();
    if (this.source[this.index] === "]") { this.index++; return result; }
    while (true) {
      result.push(this.value());
      this.ws();
      const delimiter = this.source[this.index++];
      if (delimiter === "]") return result;
      if (delimiter !== ",") fail("HTTPS_JSON_SYNTAX", "missing array delimiter");
    }
  }
  private string(): string {
    const start = this.index;
    this.index++;
    let escaped = false;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (!escaped && code === 0x22) {
        this.index++;
        let value: string;
        try { value = JSON.parse(this.source.slice(start, this.index)); }
        catch { return fail("HTTPS_JSON_SYNTAX", "invalid JSON string escape"); }
        assertUnicodeScalarString(value);
        return value;
      }
      if (!escaped && code < 0x20) fail("HTTPS_JSON_SYNTAX", "unescaped control in string");
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      this.index++;
    }
    return fail("HTTPS_JSON_SYNTAX", "unterminated JSON string");
  }
  private integer(): number {
    const rest = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match) return fail("HTTPS_JSON_SYNTAX", "invalid JSON number");
    const after = rest[match[0].length];
    if (after === "." || after === "e" || after === "E") fail("HTTPS_JSON_INTEGER_ONLY", "floating-point JSON values are forbidden");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("HTTPS_JSON_INTEGER_ONLY", "JSON integer is outside the safe canonical range");
    return value;
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail("HTTPS_JSON_UNICODE", "unpaired high surrogate");
    } else if (code >= 0xdc00 && code <= 0xdfff) fail("HTTPS_JSON_UNICODE", "unpaired low surrogate");
  }
}

export function parseStrictJson(bytes: Buffer): Json {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("HTTPS_JSON_UTF8", "UTF-8 BOM is forbidden");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return fail("HTTPS_JSON_UTF8", "input is not shortest-form valid UTF-8"); }
  const parsed = new StrictJsonParser(source).parse();
  return JSON.parse(jcs(parsed)) as Json;
}

export function jcs(value: Json): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("HTTPS_JSON_INTEGER_ONLY", "JCS input must contain safe integers only");
    return JSON.stringify(value);
  }
  if (typeof value === "string") { assertUnicodeScalarString(value); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${jcs(key)}:${jcs(value[key])}`).join(",")}}`;
}

export const ID_DOMAINS = {
  capability: "gate-h2-https-exchange-capability-v1-schema-bound",
  manifest: "gate-h2-https-exchange-manifest-v1-schema-bound",
  event: "gate-h2-https-broker-event-v1-schema-bound",
  transcript: "gate-h2-https-broker-transcript-v1-schema-bound",
  authorityEnvelope: "gate-h2-https-broker-authority-envelope-v2-schema-bound",
} as const;

const AUTHORITY_SIGNATURE_DOMAIN = "gate-h2-https-broker-authority-signature-ed25519-v2";

export function domainSeparatedId(domain: string, value: Json, idField: string): string {
  const unsigned = structuredClone(value) as Record<string, Json>;
  delete unsigned[idField];
  return crypto.createHash("sha256").update(domain).update("\0").update(jcs(unsigned)).digest("hex");
}

function validateHostname(hostname: string): void {
  if (hostname !== hostname.toLowerCase() || hostname.endsWith(".") || hostname.length > 253 || !hostname.includes(".")) fail("HTTPS_HOSTNAME", "hostname must be a lowercase absolute A-label name without a trailing dot");
  if (net.isIP(hostname) !== 0) fail("HTTPS_HOSTNAME", "IP-literal hosts are forbidden");
  const labels = hostname.split(".");
  if (labels.some((label) => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) fail("HTTPS_HOSTNAME", "hostname contains a noncanonical A-label");
  if (domainToASCII(hostname) !== hostname || domainToASCII(domainToUnicode(hostname)) !== hostname) fail("HTTPS_IDNA", "hostname is not canonical IDNA A-label form");
}

function validatePathQuery(value: string): void {
  if (!/^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*)(?:\?[A-Za-z0-9\-._~!$'()*+,;=:@/?%&]*)?$/.test(value)) fail("HTTPS_PATH_QUERY", "request target must use the exact visible-ASCII origin-form grammar");
  if (value.startsWith("//") || /^(?:https?:)?\/\//i.test(value)) fail("HTTPS_PATH_QUERY", "authority or absolute URL forms are forbidden");
  const pathOnly = value.split("?", 1)[0];
  if (pathOnly.includes("//") || /(?:^|\/)\.{1,2}(?:\/|$)/.test(pathOnly)) fail("HTTPS_PATH_QUERY", "empty or dot path segments are forbidden");
  for (const match of value.matchAll(/%([0-9A-Fa-f]{2})/g)) {
    if (match[1] !== match[1].toUpperCase()) fail("HTTPS_PATH_QUERY", "percent escapes must use uppercase hex");
    const octet = Number.parseInt(match[1], 16);
    if (octet < 0x21 || octet > 0x7e) fail("HTTPS_PATH_QUERY", "percent escapes may represent only visible ASCII octets");
    if (/[A-Za-z0-9\-._~]/.test(String.fromCharCode(octet))) fail("HTTPS_PATH_QUERY", "unreserved characters must not be percent encoded");
  }
  if (/%(?![0-9A-F]{2})/.test(value)) fail("HTTPS_PATH_QUERY", "invalid percent escape");
  const query = value.indexOf("?");
  if (query >= 0) {
    const pairs = value.slice(query + 1).split("&");
    if (pairs.some((pair) => pair === "" || !pair.includes("="))) fail("HTTPS_PATH_QUERY", "query must be an ordered list of nonempty key=value pairs");
    const names = pairs.map((pair) => pair.slice(0, pair.indexOf("=")));
    if (names.some((name) => name === "" || name.includes("%")) || new Set(names).size !== names.length) fail("HTTPS_PATH_QUERY", "query names must be unique nonempty literal ASCII names");
  }
}

function validateHeaders(headers: Json): void {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) fail("HTTPS_HEADERS", "fixed headers must use the typed closed request-header structure");
  const value = headers as Record<string, Json>;
  if (jcs(Object.keys(value).sort()) !== jcs(["accept", "content_type", "serialization"])) fail("HTTPS_HEADERS", "only typed Accept and Content-Type request headers are permitted");
  if (value.serialization !== "accept: SP value CRLF; content-type: SP value CRLF") fail("HTTPS_HEADERS", "fixed header lowercase serialization and order must be exact");
  for (const field of ["accept", "content_type"] as const) {
    if (value[field] !== "application/json") fail("HTTPS_HEADERS", `${field} must be the exact reviewed application/json media value`);
  }
}

function validateAuthPolicy(capability: Record<string, Json>): void {
  const auth = capability.auth_policy as Record<string, Json>;
  const fixedNames = new Set(["accept", "content-type"]);
  if (auth.scheme === "none") {
    if (auth.header_name !== null || auth.insertion_order !== "no_auth_header" || auth.serialization !== "no_auth_header" || auth.collision_policy !== "not_applicable") fail("HTTPS_AUTH_POLICY", "none auth must serialize no header");
    return;
  }
  const headerName = auth.header_name;
  if (typeof headerName !== "string" || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName) || headerName !== headerName.toLowerCase()) fail("HTTPS_AUTH_POLICY", "auth header name must be exact lowercase ASCII");
  if (auth.scheme === "bearer" && headerName !== "authorization") fail("HTTPS_AUTH_POLICY", "bearer auth must use the lowercase authorization header");
  if (auth.scheme === "api_key_header" && headerName !== "x-api-key") fail("HTTPS_AUTH_POLICY", "API-key auth must use the exact reviewed lowercase x-api-key header");
  if (fixedNames.has(headerName)) fail("HTTPS_AUTH_POLICY", "auth header collides with a fixed header");
  if (auth.insertion_order !== "after_fixed_headers_before_transport_headers" || auth.serialization !== "lowercase_name_colon_sp_value_crlf" || auth.collision_policy !== "reject_before_serialization") fail("HTTPS_AUTH_POLICY", "auth insertion, serialization, and collision semantics must be exact");
}

const CANONICAL_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):([0-5]\d)\.(\d{3})Z$/;
export function parseCanonicalUtc(value: unknown): number {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) fail("HTTPS_TIMESTAMP", "timestamp must use canonical RFC3339 UTC with millisecond precision and no leap second");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("HTTPS_TIMESTAMP", "timestamp is not a finite canonical calendar instant");
  return parsed;
}

let validator: any;
function schema(name: string, value: Json): void {
  if (!validator) {
    validator = new Ajv2020({ allErrors: true, strict: false });
    addFormats(validator);
    for (const file of fs.readdirSync(SCHEMA_ROOT).filter((entry) => entry.endsWith(".json"))) validator.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_ROOT, file), "utf8")), file);
  }
  const validate = validator.getSchema(name);
  if (!validate || !validate(value)) fail("HTTPS_SCHEMA", `${name}: ${validator.errorsText(validate?.errors)}`);
}

const AUTHORITY_SCHEMA_PINS = {
  capability_schema: ["https-exchange-capability.schema.v1.json", "gate_h2_https_exchange_capability_v1.0.0"],
  manifest_schema: ["https-exchange-manifest.schema.v1.json", "gate_h2_https_exchange_manifest_v1.0.0"],
  uds_protocol_schema: ["https-exchange-uds-protocol.schema.v1.json", "gate_h2_https_exchange_uds_v1.0.0"],
  broker_event_schema: ["https-broker-event.schema.v1.json", "gate_h2_https_broker_event_v1.0.0"],
  broker_transcript_schema: ["https-broker-transcript.schema.v1.json", "gate_h2_https_broker_transcript_v1.0.0"],
  executor_semantics_schema: ["executor-semantics-attestation.schema.v2.2.json", "reviewed_metrics_executor_semantics_attestation_v2.2.0"],
  executor_conformance_schema: ["executor-conformance-receipt.schema.v2.2.json", "reviewed_metrics_executor_conformance_receipt_v2.2.0"],
  linux_sandbox_schema: ["linux-sandbox-attestation.schema.v2.5.json", "reviewed_metrics_linux_sandbox_attestation_v2.5.0"],
} as const;

const SELF_SCHEMA_PINS = {
  capability: ["https-exchange-capability.schema.v1.json", "gate_h2_https_exchange_capability_v1.0.0"],
  manifest: ["https-exchange-manifest.schema.v1.json", "gate_h2_https_exchange_manifest_v1.0.0"],
  event: ["https-broker-event.schema.v1.json", "gate_h2_https_broker_event_v1.0.0"],
  transcript: ["https-broker-transcript.schema.v1.json", "gate_h2_https_broker_transcript_v1.0.0"],
} as const;

function expectedSchemaPin(name: string, schemaVersion: string): { sha256: string; bytes: number; schema_version: string } {
  const raw = fs.readFileSync(path.join(SCHEMA_ROOT, name));
  return { sha256: crypto.createHash("sha256").update(raw).digest("hex"), bytes: raw.length, schema_version: schemaVersion };
}

export function validateCapability(value: Json): void {
  const capability = value as Record<string, Json>;
  validateHostname(capability.hostname as string);
  validatePathQuery(capability.path_query as string);
  validateHeaders(capability.fixed_headers);
  validateAuthPolicy(capability);
  schema("https-exchange-capability.schema.v1.json", value);
  if (jcs(capability.schema_pin) !== jcs(expectedSchemaPin(...SELF_SCHEMA_PINS.capability))) fail("HTTPS_CAPABILITY_SCHEMA_PIN", "capability self-schema bytes differ");
  if ((capability.connect_deadline_ms as number) > (capability.exchange_deadline_ms as number)) fail("HTTPS_DEADLINE", "connect deadline exceeds exchange deadline");
  if ((capability.request_artifact as any).bytes > (capability.request_byte_cap as number)) fail("HTTPS_REQUEST_SIZE", "reviewed request exceeds request byte cap");
  if (capability.method === "GET" && (capability.request_artifact as any).bytes !== 0) fail("HTTPS_METHOD", "GET capability cannot carry a request body");
  const statuses = capability.allowed_response_statuses as number[];
  if (statuses.some((status, index) => index > 0 && statuses[index - 1] >= status)) fail("HTTPS_RESPONSE_POLICY", "response statuses must be strictly ascending");
  if (capability.capability_id !== domainSeparatedId(ID_DOMAINS.capability, value, "capability_id")) fail("HTTPS_CAPABILITY_ID", "capability_id mismatch");
}

export function validateManifest(value: Json): void {
  schema("https-exchange-manifest.schema.v1.json", value);
  const manifest = value as Record<string, Json>;
  if (jcs(manifest.schema_pin) !== jcs(expectedSchemaPin(...SELF_SCHEMA_PINS.manifest))) fail("HTTPS_MANIFEST_SCHEMA_PIN", "manifest self-schema bytes differ");
  const capabilities = manifest.capabilities as Json[];
  capabilities.forEach(validateCapability);
  if (capabilities.some((entry) => (entry as any).candidate_id !== manifest.candidate_id || (entry as any).stage_id !== manifest.stage_id)) fail("HTTPS_MANIFEST_JOIN", "capability candidate/stage differs from manifest");
  const order = capabilities.map((entry) => (entry as Record<string, Json>).exchange_ordinal);
  if (order.some((ordinal, index) => ordinal !== index)) fail("HTTPS_EXCHANGE_ORDER", "exchange ordinals must be contiguous and exact");
  const rawResponseRoles = capabilities.map((entry) => (entry as Record<string, Json>).raw_response_output_role);
  if (new Set(rawResponseRoles).size !== rawResponseRoles.length) fail("HTTPS_MANIFEST_OUTPUT_ROLE", "raw-response output roles must be unique per capability");
  if (manifest.exact_exchange_count !== capabilities.length) fail("HTTPS_EXCHANGE_ORDER", "exact exchange count mismatch");
  if (manifest.manifest_id !== domainSeparatedId(ID_DOMAINS.manifest, value, "manifest_id")) fail("HTTPS_MANIFEST_ID", "manifest_id mismatch");
}

export function validateEvent(value: Json): void {
  parseCanonicalUtc((value as Record<string, Json>)?.occurred_at);
  schema("https-broker-event.schema.v1.json", value);
  if (jcs((value as Record<string, Json>).schema_pin) !== jcs(expectedSchemaPin(...SELF_SCHEMA_PINS.event))) fail("HTTPS_EVENT_SCHEMA_PIN", "event self-schema bytes differ");
  if ((value as Record<string, Json>).event_id !== domainSeparatedId(ID_DOMAINS.event, value, "event_id")) fail("HTTPS_EVENT_ID", "event_id mismatch");
}

export function validateTranscript(value: Json, manifestValue?: Json): void {
  schema("https-broker-transcript.schema.v1.json", value);
  if (!manifestValue) fail("HTTPS_TRANSCRIPT_MANIFEST", "transcript validation requires the exact authorized manifest");
  validateManifest(manifestValue);
  const transcript = value as Record<string, Json>;
  if (jcs(transcript.schema_pin) !== jcs(expectedSchemaPin(...SELF_SCHEMA_PINS.transcript))) fail("HTTPS_TRANSCRIPT_SCHEMA_PIN", "transcript self-schema bytes differ");
  const manifest = manifestValue as Record<string, Json>;
  const events = transcript.events as Json[];
  events.forEach(validateEvent);
  if (events.some((event, index) => (event as Record<string, Json>).sequence !== index)) fail("HTTPS_EVENT_ORDER", "event sequence must be contiguous");
  const started = parseCanonicalUtc(transcript.started_at); const ended = parseCanonicalUtc(transcript.ended_at);
  let previous = started;
  if (!(started < ended) || transcript.manifest_id !== manifest.manifest_id || transcript.candidate_id !== manifest.candidate_id || transcript.stage_id !== manifest.stage_id || transcript.expected_exchange_count !== manifest.exact_exchange_count || events.some((event) => {
    const at = parseCanonicalUtc((event as any).occurred_at);
    const invalid = at < previous || at < started || at > ended || (event as any).manifest_id !== transcript.manifest_id || (event as any).candidate_id !== transcript.candidate_id || (event as any).stage_id !== transcript.stage_id;
    previous = at;
    return invalid;
  })) fail("HTTPS_TRANSCRIPT_JOIN", "transcript chronology, manifest, or event authority join differs");
  const capabilities = manifest.capabilities as Record<string, Json>[];
  let attempted = 0; let completed = 0; let failureSeen = false;
  const acceptedLifecycle = ["handle_consumed", "dns_resolved", "tls_verified", "request_sent", "response_committed"];
  let ordinal = 0; let lifecycleIndex = 0;
  for (const eventValue of events) {
      const event = eventValue as Record<string, Json>;
      const capability = capabilities[ordinal];
      if (failureSeen || !capability || event.exchange_ordinal !== ordinal || event.capability_id !== capability.capability_id) fail("HTTPS_TRANSCRIPT_CAPABILITY", "events must finish one exact ordinal before the next begins");
      if (lifecycleIndex === 0) attempted++;
      const expectedType = acceptedLifecycle[lifecycleIndex];
      if (event.event_type === "exchange_failed") {
        if (lifecycleIndex === 0 || lifecycleIndex >= acceptedLifecycle.length) fail("HTTPS_EVENT_LIFECYCLE", "failure must follow a strict nonterminal lifecycle prefix");
        failureSeen = true;
      } else if (event.event_type !== expectedType) fail("HTTPS_EVENT_LIFECYCLE", "global lifecycle contains a duplicate, gap, interleaving, or out-of-order event");
      const evidence = event.evidence as Record<string, Json>; const keys = Object.keys(evidence).sort();
      const expectedKeys: Record<string, string[]> = {
        handle_consumed: ["request_bytes", "request_sha256"],
        dns_resolved: ["connected_ip_commitment", "dns_answer_set_sha256"],
        tls_verified: ["tls_peer_chain_sha256", "tls_version"],
        request_sent: ["request_bytes", "request_sha256"],
        response_committed: ["response_bytes", "response_media_type", "response_sha256", "response_status"],
        exchange_failed: ["failure_code"],
      };
      if (JSON.stringify(keys) !== JSON.stringify(expectedKeys[event.event_type as string]) || (event.event_type === "exchange_failed" ? event.outcome !== "failed_closed" : event.outcome !== "accepted")) fail("HTTPS_EVENT_EVIDENCE", "event outcome or evidence differs from its lifecycle type");
      if (["handle_consumed", "request_sent"].includes(event.event_type as string) && (evidence.request_sha256 !== (capability.request_artifact as any).sha256 || evidence.request_bytes !== (capability.request_artifact as any).bytes)) fail("HTTPS_EVENT_EVIDENCE", "request evidence differs from the authorized artifact");
      if (event.event_type === "response_committed" && (!(capability.allowed_response_statuses as number[]).includes(evidence.response_status as number) || !(capability.allowed_response_media_types as string[]).includes(evidence.response_media_type as string) || (evidence.response_bytes as number) > (capability.response_byte_cap as number))) fail("HTTPS_EVENT_EVIDENCE", "response evidence exceeds the authorized response policy");
      if (event.event_type !== "exchange_failed") lifecycleIndex++;
      if (event.event_type === "response_committed") { completed++; ordinal++; lifecycleIndex = 0; }
  }
  if (!failureSeen && lifecycleIndex !== 0) fail("HTTPS_EVENT_LIFECYCLE", "transcript ends during an exchange lifecycle");
  if (transcript.attempted_exchange_count !== attempted || transcript.completed_exchange_count !== completed || (transcript.final_outcome === "complete" ? completed !== capabilities.length || failureSeen : !failureSeen)) fail("HTTPS_TRANSCRIPT_COUNTS", "transcript counts contradict exact lifecycle evidence");
  if (transcript.transcript_id !== domainSeparatedId(ID_DOMAINS.transcript, value, "transcript_id")) fail("HTTPS_TRANSCRIPT_ID", "transcript_id mismatch");
}

export function validateAuthorityEnvelopeV2(
  value: Json,
  transcriptBytes: Buffer,
  manifestValue: Json,
  signerTrustEntryBytes: Buffer,
): void {
  schema("https-broker-authority-envelope.schema.v2.json", value);
  const envelope = value as Record<string, Json>;
  if (jcs(envelope.schema_pin) !== jcs(expectedSchemaPin("https-broker-authority-envelope.schema.v2.json", "gate_h2_https_broker_authority_envelope_v2.0.0"))) fail("HTTPS_AUTHORITY_SCHEMA_PIN", "authority envelope self-schema bytes differ");
  const transcript = parseStrictJson(transcriptBytes) as Record<string, Json>;
  const exactTranscriptBytes = Buffer.from(`${jcs(transcript)}\n`);
  if (!transcriptBytes.equals(exactTranscriptBytes)) fail("HTTPS_TRANSCRIPT_BYTES", "transcript must be the exact canonical UTF-8 JSON line retained by the broker");
  validateTranscript(transcript, manifestValue);
  const trustEntry = parseStrictJson(signerTrustEntryBytes) as Record<string, Json>;
  if (!signerTrustEntryBytes.equals(Buffer.from(`${jcs(trustEntry)}\n`))) fail("HTTPS_AUTHORITY_TRUST_BYTES", "signer trust entry must be an exact canonical UTF-8 JSON line");
  schema("https-broker-signer-trust-entry.schema.v1.json", trustEntry);
  if (jcs(trustEntry.schema_pin) !== jcs(expectedSchemaPin("https-broker-signer-trust-entry.schema.v1.json", "gate_h2_https_broker_signer_trust_entry_v1.0.0"))) fail("HTTPS_AUTHORITY_TRUST_SCHEMA_PIN", "signer trust entry self-schema bytes differ");
  const trustEntrySha256 = crypto.createHash("sha256").update(signerTrustEntryBytes).digest("hex");
  if (envelope.transcript_id !== transcript.transcript_id
    || envelope.transcript_sha256 !== crypto.createHash("sha256").update(transcriptBytes).digest("hex")
    || envelope.manifest_id !== transcript.manifest_id
    || envelope.socket_identity_sha256 !== transcript.socket_identity_sha256
    || envelope.run_token_commitment !== transcript.run_token_commitment
    || envelope.final_outcome !== transcript.final_outcome
    || envelope.signer_trust_entry_sha256 !== trustEntrySha256
    || envelope.signer_id !== trustEntry.signer_id
    || envelope.public_key_base64url !== trustEntry.public_key_base64url
    || envelope.signature_algorithm !== trustEntry.signature_algorithm
    || trustEntry.trust_status !== "trusted") {
    fail("HTTPS_AUTHORITY_JOIN", "authority envelope differs from transcript or trusted signer entry");
  }
  const unsignedId = structuredClone(envelope);
  delete unsignedId.envelope_id;
  delete unsignedId.signature_base64url;
  const expectedEnvelopeId = crypto.createHash("sha256")
    .update(ID_DOMAINS.authorityEnvelope).update("\0").update(jcs(unsignedId)).digest("hex");
  if (envelope.envelope_id !== expectedEnvelopeId) fail("HTTPS_AUTHORITY_ID", "authority envelope ID mismatch");
  const publicKey = Buffer.from(trustEntry.public_key_base64url as string, "base64url");
  const signerId = crypto.createHash("sha256")
    .update("gate-h2-ed25519-signer-v1\0").update(trustEntry.public_key_base64url as string).digest("hex");
  if (publicKey.length !== 32 || publicKey.toString("base64url") !== trustEntry.public_key_base64url || trustEntry.signer_id !== signerId) fail("HTTPS_AUTHORITY_SIGNER", "trusted authority signer identity mismatch");
  const unsignedSignature = structuredClone(envelope);
  delete unsignedSignature.signature_base64url;
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]);
  const message = Buffer.concat([
    Buffer.from(`${AUTHORITY_SIGNATURE_DOMAIN}\0`),
    Buffer.from(jcs(unsignedSignature)),
  ]);
  const signature = Buffer.from(envelope.signature_base64url as string, "base64url");
  if (signature.length !== 64 || !crypto.verify(null, message, crypto.createPublicKey({ key: spki, format: "der", type: "spki" }), signature)) fail("HTTPS_AUTHORITY_SIGNATURE", "authority Ed25519 signature mismatch");
}

export function validateCompletedTranscriptOutputs(value: Json, manifestValue: Json, retainedOutputs: Json[]): void {
  validateTranscript(value, manifestValue);
  const transcript = value as Record<string, Json>;
  if (transcript.final_outcome !== "complete") fail("HTTPS_TRANSCRIPT_INCOMPLETE", "successful stage completion requires a complete broker transcript");
  const outputs = retainedOutputs as Record<string, Json>[];
  const outputRoles = outputs.map((output) => output.artifact_role);
  if (new Set(outputRoles).size !== outputRoles.length) fail("HTTPS_RESPONSE_OUTPUT_JOIN", "retained stage output roles must be unique");
  const outputByRole = new Map(outputs.map((output) => [output.artifact_role, output]));
  const responseEvents = (transcript.events as Record<string, Json>[]).filter((event) => event.event_type === "response_committed");
  for (const capability of (manifestValue as Record<string, Json>).capabilities as Record<string, Json>[]) {
    const response = responseEvents.find((event) => event.exchange_ordinal === capability.exchange_ordinal && event.capability_id === capability.capability_id);
    const output = outputByRole.get(capability.raw_response_output_role);
    const evidence = response?.evidence as Record<string, Json> | undefined;
    if (!output || !evidence || output.sha256 !== evidence.response_sha256 || output.bytes !== evidence.response_bytes) fail("HTTPS_RESPONSE_OUTPUT_JOIN", "response evidence does not exactly join its retained raw-response output role, hash, and bytes");
  }
}

export function validateProtocol(value: Json): void { schema("https-exchange-uds-protocol.schema.v1.json", value); }
export function validateStageProgramV22(value: Json): void {
  schema("stage-program.schema.v2.2.json", value);
  const expected = crypto.createHash("sha256").update(fs.readFileSync(path.join(SCHEMA_ROOT, "stage-program.schema.v2.2.json"))).digest("hex");
  if ((value as Record<string, Json>).schema_sha256 !== expected) fail("HTTPS_STAGE_PROGRAM_SCHEMA_PIN", "stage-program v2.2 schema pin mismatch");
}

export function validateAuthorizationNetworkContract(value: any): void {
  const version = value?.schema_version;
  const operations = (value?.stage_execution?.stages ?? []).map((stage: any) => stage.operation).filter((operation: any) => operation?.kind === "external_command");
  const assertRawNetworkDenied = (): void => {
    for (const operation of operations) {
      if (operation.network_policy !== "deny_all" || operation.network_capability_ids?.length !== 0 || operation.execution_boundary?.network_policy !== "deny_all" || operation.execution_boundary?.network_capability_ids?.length !== 0) fail("HTTPS_RAW_NETWORK", "stage raw network must remain deny-all with zero destination capabilities");
    }
  };
  if (["reviewed_metrics_execution_authorization_v2.3.0", "reviewed_metrics_execution_authorization_v2.4.0"].includes(version)) {
    if (value.https_exchange_authority !== undefined) fail("HTTPS_LEGACY_MIGRATION", "legacy authority cannot carry HTTPS exchange authority");
    assertRawNetworkDenied();
    return;
  }
  if (version === "reviewed_metrics_execution_authorization_v2.5.0") {
    const authority = value.https_exchange_authority;
    if (!authority || authority.raw_network_policy !== "deny_all" || authority.legacy_migration !== "explicit_reauthorization_required_no_automatic_allow_capabilities_migration") fail("HTTPS_V25_AUTHORITY", "v2.5 requires explicit fail-closed HTTPS exchange authority");
    if (JSON.stringify(authority.predictor_exclusions) !== JSON.stringify(["destination_manifest", "provider_auth_material"])) fail("HTTPS_V25_AUTHORITY", "v2.5 predictor exclusions differ");
    for (const [field, [name, schemaVersion]] of Object.entries(AUTHORITY_SCHEMA_PINS)) {
      if (JSON.stringify(authority[field]) !== JSON.stringify(expectedSchemaPin(name, schemaVersion))) fail("HTTPS_V25_SCHEMA_PIN", `v2.5 ${field} differs from tracked successor schema bytes`);
    }
    assertRawNetworkDenied();
    const stages = new Map((value.stage_execution?.stages ?? []).map((stage: any) => [stage.stage_id, stage]));
    const bindings = authority.stage_bindings ?? [];
    if (new Set(bindings.map((binding: any) => binding.stage_id)).size !== bindings.length || new Set(bindings.map((binding: any) => binding.manifest_id)).size !== bindings.length) fail("HTTPS_V25_AUTHORITY", "v2.5 stage/manifest bindings must be one-to-one");
    for (const binding of bindings) {
      const stage: any = stages.get(binding.stage_id);
      if (!stage || binding.stage_program_version !== "reviewed_metrics_stage_program_v2.2.0" || stage.operation?.script?.sha256 !== binding.stage_program_sha256 || binding.manifest_id !== authority.manifest.manifest_id || !stage.outputs?.some((output: any) => output.artifact_role === authority.transcript_output_role)) fail("HTTPS_V25_AUTHORITY", "v2.5 stage binding lacks its exact v2.2 program, manifest, or transcript output");
    }
    return;
  }
  if (value?.https_exchange_authority !== undefined) fail("HTTPS_LEGACY_MIGRATION", "HTTPS exchange authority is valid only in execution authorization v2.5");
}

export function assertNoPredictorHttpsAuthorityLeak(value: Json): void {
  const forbiddenKeys = /^(?:destination_manifest|https_exchange_authority|manifest_id|capability_id|auth_policy|credential_capability_id|provider_auth_material|run_token)$/;
  const visit = (item: Json, location: string): void => {
    if (typeof item === "string" && (/(?:https?:\/\/|authorization\s*:|proxy-authorization\s*:|\bbearer\s+[A-Za-z0-9._~+\/-]+=*)/i.test(item) || item.includes("gate_h2_https_exchange_manifest_v1"))) fail("HTTPS_PREDICTOR_LEAK", `predictor input contains destination or auth text at ${location}`);
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${location}[${index}]`));
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKeys.test(key)) fail("HTTPS_PREDICTOR_LEAK", `predictor input contains authority field at ${location}.${key}`);
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, "$");
}

function expectCode(code: string, mutate: () => void): void {
  try { mutate(); } catch (error) { if (error instanceof HttpsExchangeContractError && error.code === code) return; throw error; }
  fail("HTTPS_SELF_TEST", `expected ${code}`);
}

export function selfTest(): void {
  const legacyPins = {
    "execution-authorization.schema.v2.json": "8b477e754e50867d85b49998dcf5f21697d639d796c981ab70b88bab3f7f1216",
    "stage-program.schema.v2.json": "b292a145b4d1df0b7eeff2dbe56ce297a0d2150ffe918d52b1da097197fbdcc9",
    "executor-semantics-attestation.schema.v2.json": "57206b85aef297ecd7b50b2fbd4f2a1c1e82564117c8b8e089f3ffe4f308ac97",
    "executor-conformance-receipt.schema.v2.json": "9acb523117af0085386af9a35990067496002cf1b26d6ae6ef7ad9021a63d50f",
    "linux-sandbox-attestation.schema.v2.json": "bb04e3eb86ba79ebc2c3223d2b0b075600eb60d1cf24e7a45a23a6d87abec32b",
  };
  for (const [name, expected] of Object.entries(legacyPins)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(SCHEMA_ROOT, name))).digest("hex");
    if (actual !== expected) fail("HTTPS_LEGACY_SCHEMA_DRIFT", `${name} changed instead of adding a successor schema`);
  }
  const read = (name: string) => parseStrictJson(fs.readFileSync(path.join(FIXTURE_ROOT, name)));
  const manifest = read("manifest-v1.json");
  const transcript = read("transcript-v1.json");
  const resignCapability = (value: any): any => { value.capability_id = domainSeparatedId(ID_DOMAINS.capability, value, "capability_id"); return value; };
  const resignEvent = (value: any): any => { value.event_id = domainSeparatedId(ID_DOMAINS.event, value, "event_id"); return value; };
  const resignTranscript = (value: any): any => { value.transcript_id = domainSeparatedId(ID_DOMAINS.transcript, value, "transcript_id"); return value; };
  validateManifest(manifest); validateTranscript(transcript, manifest);
  const transcriptBytes = Buffer.from(`${jcs(transcript)}\n`);
  const makeSigner = (): { privateKey: crypto.KeyObject; publicKeyBase64url: string; signerId: string } => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const publicKeyBase64url = publicKeyBytes.toString("base64url");
    const signerId = crypto.createHash("sha256").update("gate-h2-ed25519-signer-v1\0").update(publicKeyBase64url).digest("hex");
    return { privateKey, publicKeyBase64url, signerId };
  };
  const trustedSigner = makeSigner();
  const trustEntry: any = {
    schema_version: "gate_h2_https_broker_signer_trust_entry_v1.0.0",
    schema_pin: expectedSchemaPin("https-broker-signer-trust-entry.schema.v1.json", "gate_h2_https_broker_signer_trust_entry_v1.0.0"),
    signer_id: trustedSigner.signerId,
    public_key_base64url: trustedSigner.publicKeyBase64url,
    signature_algorithm: "ed25519",
    trust_status: "trusted",
  };
  const trustEntryBytes = Buffer.from(`${jcs(trustEntry)}\n`);
  const envelope: any = {
    schema_version: "gate_h2_https_broker_authority_envelope_v2.0.0",
    schema_pin: expectedSchemaPin("https-broker-authority-envelope.schema.v2.json", "gate_h2_https_broker_authority_envelope_v2.0.0"),
    envelope_id: "",
    transcript_id: (transcript as any).transcript_id,
    transcript_sha256: crypto.createHash("sha256").update(transcriptBytes).digest("hex"),
    manifest_id: (transcript as any).manifest_id,
    d1_attempt_id: "d1_attempt_1",
    d1_begin_sha256: "6".repeat(64),
    session_id: "session_1",
    attempt_id: "attempt_1",
    broker_binary: { sha256: "1".repeat(64), bytes: 1, version: "broker-v1" },
    stage_runtime: { sha256: "2".repeat(64), bytes: 1, version: "runtime-v1" },
    trust_roots: { sha256: "3".repeat(64), bytes: 1, version: "roots-v1" },
    socket_identity_sha256: (transcript as any).socket_identity_sha256,
    run_token_commitment: (transcript as any).run_token_commitment,
    final_outcome: (transcript as any).final_outcome,
    signer_id: trustedSigner.signerId,
    signer_trust_entry_sha256: crypto.createHash("sha256").update(trustEntryBytes).digest("hex"),
    public_key_base64url: trustedSigner.publicKeyBase64url,
    signature_algorithm: "ed25519",
    signature_base64url: "",
  };
  const signEnvelope = (candidate: any, privateKey: crypto.KeyObject): void => {
    const idValue = structuredClone(candidate); delete idValue.envelope_id; delete idValue.signature_base64url;
    candidate.envelope_id = crypto.createHash("sha256").update(ID_DOMAINS.authorityEnvelope).update("\0").update(jcs(idValue)).digest("hex");
    const unsigned = structuredClone(candidate); delete unsigned.signature_base64url;
    candidate.signature_base64url = crypto.sign(null, Buffer.concat([Buffer.from(`${AUTHORITY_SIGNATURE_DOMAIN}\0`), Buffer.from(jcs(unsigned))]), privateKey).toString("base64url");
  };
  signEnvelope(envelope, trustedSigner.privateKey);
  validateAuthorityEnvelopeV2(envelope, transcriptBytes, manifest, trustEntryBytes);
  expectCode("HTTPS_TRANSCRIPT_BYTES", () => validateAuthorityEnvelopeV2(envelope, Buffer.concat([Buffer.from(" "), transcriptBytes]), manifest, trustEntryBytes));
  expectCode("HTTPS_TRANSCRIPT_BYTES", () => validateAuthorityEnvelopeV2(envelope, transcriptBytes.subarray(0, transcriptBytes.length - 1), manifest, trustEntryBytes));
  const attacker = makeSigner();
  const selfSelectedEnvelope = structuredClone(envelope);
  selfSelectedEnvelope.signer_id = attacker.signerId;
  selfSelectedEnvelope.public_key_base64url = attacker.publicKeyBase64url;
  signEnvelope(selfSelectedEnvelope, attacker.privateKey);
  expectCode("HTTPS_AUTHORITY_JOIN", () => validateAuthorityEnvelopeV2(selfSelectedEnvelope, transcriptBytes, manifest, trustEntryBytes));
  validateProtocol(read("uds-request-v1.json")); validateProtocol(read("uds-response-v1.json"));
  validateStageProgramV22(read("stage-program-v2.2.json"));
  expectCode("HTTPS_JSON_DUPLICATE_KEY", () => { parseStrictJson(Buffer.from('{"a":1,"a":2}')); });
  expectCode("HTTPS_JSON_UTF8", () => { parseStrictJson(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc0, 0xaf, 0x22, 0x7d])); });
  expectCode("HTTPS_JSON_INTEGER_ONLY", () => { parseStrictJson(Buffer.from('{"x":1.5}')); });
  expectCode("HTTPS_JSON_SYNTAX", () => { parseStrictJson(Buffer.from('{"x":NaN}')); });
  for (const [code, field, replacement] of [["HTTPS_HOSTNAME", "hostname", "Example.NET"], ["HTTPS_IDNA", "hostname", "xn--a.example"], ["HTTPS_HOSTNAME", "hostname", "127.0.0.1"], ["HTTPS_PATH_QUERY", "path_query", "//example.net/v1"], ["HTTPS_PATH_QUERY", "path_query", "/v1?q=%7e"], ["HTTPS_PATH_QUERY", "path_query", "/v1|rewritten"], ["HTTPS_PATH_QUERY", "path_query", "/v1?q=%0D"], ["HTTPS_PATH_QUERY", "path_query", "/v1?q=caf\u00e9"]] as const) {
    const bad = structuredClone((manifest as any).capabilities[0]); bad[field] = replacement; bad.capability_id = domainSeparatedId(ID_DOMAINS.capability, bad, "capability_id"); expectCode(code, () => validateCapability(bad));
  }
  const forbiddenFixedHeaderNames = ["x-api-key", "X-Api-Key", "forwarded", "Forwarded", "x-forwarded-host", "X-Forwarded-Host", "x-original-url", "X-Original-URL", "authorization", "proxy-authorization", "host", "connection", "content-length", "transfer-encoding", "cookie", "set-cookie", "x-forwarded-for", "x-real-ip", "client-ip", "true-client-ip", "via", "proxy-connection", "x-rewrite-url", "x-http-method-override"];
  for (const name of forbiddenFixedHeaderNames) { const bad = structuredClone((manifest as any).capabilities[0]); bad.fixed_headers[name] = "application/json"; resignCapability(bad); expectCode("HTTPS_HEADERS", () => validateCapability(bad)); }
  const legacyHeaderArray = structuredClone((manifest as any).capabilities[0]); legacyHeaderArray.fixed_headers = [{ name: "accept", value: "application/json" }]; resignCapability(legacyHeaderArray); expectCode("HTTPS_HEADERS", () => validateCapability(legacyHeaderArray));
  for (const field of ["accept", "content_type"] as const) for (const value of [" leading", "text/plain", "application/secret-token", "application/json; token=secret", "Application/JSON", "application/ld+json", "caf\u00e9", "text/plain\r\nx-api-key: secret"]) { const ambiguous = structuredClone((manifest as any).capabilities[0]); ambiguous.fixed_headers[field] = value; resignCapability(ambiguous); expectCode("HTTPS_HEADERS", () => validateCapability(ambiguous)); }
  for (const [field, value] of [["request_artifact", "application/secret-token"], ["request_artifact", "application/json; token=secret"], ["request_artifact", "Application/JSON"], ["allowed_response_media_types", "application/secret-token"], ["allowed_response_media_types", "application/json; token=secret"], ["allowed_response_media_types", "Application/JSON"]] as const) {
    const badMedia = structuredClone((manifest as any).capabilities[0]);
    if (field === "request_artifact") badMedia.request_artifact.media_type = value; else badMedia.allowed_response_media_types = [value];
    resignCapability(badMedia); expectCode("HTTPS_SCHEMA", () => validateCapability(badMedia));
  }
  const invalidAcceptedResponseMediaTypes = ["Application/JSON", "application/json; charset=utf-8", "application/json; token=secret", "application/ld+json"];
  for (const mediaType of invalidAcceptedResponseMediaTypes) {
    const udsResponse = structuredClone(read("uds-response-v1.json") as any); udsResponse.output_artifact.media_type = mediaType;
    expectCode("HTTPS_SCHEMA", () => validateProtocol(udsResponse));
    const responseEvent = structuredClone((transcript as any).events[4]); responseEvent.evidence.response_media_type = mediaType; resignEvent(responseEvent);
    expectCode("HTTPS_SCHEMA", () => validateEvent(responseEvent));
  }
  const badHeaderOrder = structuredClone((manifest as any).capabilities[0]); badHeaderOrder.fixed_headers.serialization = "content-type: SP value CRLF; accept: SP value CRLF"; resignCapability(badHeaderOrder); expectCode("HTTPS_HEADERS", () => validateCapability(badHeaderOrder));
  const apiKey = (headerName: string): any => { const value = structuredClone((manifest as any).capabilities[0]); value.auth_policy = { injection_owner: "host_broker", scheme: "api_key_header", credential_capability_id: "4".repeat(64), stage_visibility: "never", header_name: headerName, insertion_order: "after_fixed_headers_before_transport_headers", serialization: "lowercase_name_colon_sp_value_crlf", collision_policy: "reject_before_serialization" }; return resignCapability(value); };
  const apiKeyOne = apiKey("x-api-key"); validateCapability(apiKeyOne);
  const authCollision = apiKey("accept"); expectCode("HTTPS_AUTH_POLICY", () => validateCapability(authCollision));
  const authCaseAlias = apiKey("X-Api-Key"); expectCode("HTTPS_AUTH_POLICY", () => validateCapability(authCaseAlias));
  for (const name of ["authorization", "host", "x-host", "forwarded", "x-forwarded-host", "x-forwarded-method", "x-original-url", "x-original-host", "x-rewrite-url", "x-http-method-override", "proxy-authorization", "proxy-host", "connection", "content-length", "cookie", "client-ip", "x-client-key", "api-key"]) expectCode("HTTPS_AUTH_POLICY", () => validateCapability(apiKey(name)));
  const authOrder = apiKey("x-api-key"); authOrder.auth_policy.insertion_order = "no_auth_header"; resignCapability(authOrder); expectCode("HTTPS_AUTH_POLICY", () => validateCapability(authOrder));
  const badId = structuredClone((manifest as any).capabilities[0]); badId.capability_id = "0".repeat(64); expectCode("HTTPS_CAPABILITY_ID", () => validateCapability(badId));
  const capabilitySchemaSubstitution = structuredClone((manifest as any).capabilities[0]); capabilitySchemaSubstitution.schema_pin.sha256 = "f".repeat(64); resignCapability(capabilitySchemaSubstitution); expectCode("HTTPS_CAPABILITY_SCHEMA_PIN", () => validateCapability(capabilitySchemaSubstitution));
  const manifestSchemaSubstitution = structuredClone(manifest as any); manifestSchemaSubstitution.schema_pin.sha256 = "f".repeat(64); manifestSchemaSubstitution.manifest_id = domainSeparatedId(ID_DOMAINS.manifest, manifestSchemaSubstitution, "manifest_id"); expectCode("HTTPS_MANIFEST_SCHEMA_PIN", () => validateManifest(manifestSchemaSubstitution));
  const eventSchemaSubstitution = structuredClone((transcript as any).events[0]); eventSchemaSubstitution.schema_pin.sha256 = "f".repeat(64); resignEvent(eventSchemaSubstitution); expectCode("HTTPS_EVENT_SCHEMA_PIN", () => validateEvent(eventSchemaSubstitution));
  for (const timestamp of ["2026-02-31T00:00:00.000Z", "2026-07-16T00:00:60.000Z", "2026-07-16T00:00:00.000+00:00"]) {
    const invalidDateEvent = structuredClone((transcript as any).events[0]); invalidDateEvent.occurred_at = timestamp; resignEvent(invalidDateEvent);
    expectCode("HTTPS_TIMESTAMP", () => validateEvent(invalidDateEvent));
  }
  const transcriptSchemaSubstitution = structuredClone(transcript as any); transcriptSchemaSubstitution.schema_pin.sha256 = "f".repeat(64); resignTranscript(transcriptSchemaSubstitution); expectCode("HTTPS_TRANSCRIPT_SCHEMA_PIN", () => validateTranscript(transcriptSchemaSubstitution, manifest));
  const reordered = structuredClone(manifest as any); reordered.capabilities[0].exchange_ordinal = 1; reordered.capabilities[0].capability_id = domainSeparatedId(ID_DOMAINS.capability, reordered.capabilities[0], "capability_id"); reordered.manifest_id = domainSeparatedId(ID_DOMAINS.manifest, reordered, "manifest_id"); expectCode("HTTPS_EXCHANGE_ORDER", () => validateManifest(reordered));
  const injectedUrl = structuredClone(read("uds-request-v1.json") as any); injectedUrl.url = "https://api.example.net/v1/exchange"; expectCode("HTTPS_SCHEMA", () => validateProtocol(injectedUrl));
  const backslashUrl = structuredClone((manifest as any).capabilities[0]); backslashUrl.path_query = "/\\\\evil.example/v1"; backslashUrl.capability_id = domainSeparatedId(ID_DOMAINS.capability, backslashUrl, "capability_id"); expectCode("HTTPS_PATH_QUERY", () => validateCapability(backslashUrl));
  const replay = structuredClone(transcript as any); replay.events[1].sequence = 0; replay.events[1].event_id = domainSeparatedId(ID_DOMAINS.event, replay.events[1], "event_id"); replay.transcript_id = domainSeparatedId(ID_DOMAINS.transcript, replay, "transcript_id"); expectCode("HTTPS_EVENT_ORDER", () => validateTranscript(replay, manifest));
  const lifecycleGap = structuredClone(transcript as any); [lifecycleGap.events[1], lifecycleGap.events[2]] = [lifecycleGap.events[2], lifecycleGap.events[1]]; lifecycleGap.events.forEach((event: any, index: number) => { event.sequence = index; event.occurred_at = new Date(Date.parse(lifecycleGap.started_at) + (index + 1) * 100).toISOString(); resignEvent(event); }); resignTranscript(lifecycleGap); expectCode("HTTPS_EVENT_LIFECYCLE", () => validateTranscript(lifecycleGap, manifest));
  const twoManifest = structuredClone(manifest as any); const secondCapability = structuredClone(twoManifest.capabilities[0]); secondCapability.exchange_ordinal = 1; secondCapability.raw_response_output_role = "raw_https_response_2"; resignCapability(secondCapability); twoManifest.capabilities.push(secondCapability); twoManifest.exact_exchange_count = 2; twoManifest.manifest_id = domainSeparatedId(ID_DOMAINS.manifest, twoManifest, "manifest_id"); validateManifest(twoManifest);
  const duplicateRawRole = structuredClone(twoManifest); duplicateRawRole.capabilities[1].raw_response_output_role = duplicateRawRole.capabilities[0].raw_response_output_role; resignCapability(duplicateRawRole.capabilities[1]); duplicateRawRole.manifest_id = domainSeparatedId(ID_DOMAINS.manifest, duplicateRawRole, "manifest_id"); expectCode("HTTPS_MANIFEST_OUTPUT_ROLE", () => validateManifest(duplicateRawRole));
  const eventsFor = (ordinal: number, capabilityId: string): any[] => (transcript as any).events.map((source: any) => { const event = structuredClone(source); event.manifest_id = twoManifest.manifest_id; event.capability_id = capabilityId; event.exchange_ordinal = ordinal; return event; });
  const interleaved = structuredClone(transcript as any); interleaved.manifest_id = twoManifest.manifest_id; interleaved.expected_exchange_count = 2; interleaved.attempted_exchange_count = 2; interleaved.completed_exchange_count = 2; interleaved.ended_at = new Date(Date.parse(interleaved.started_at) + 2_000).toISOString(); const ordinalZero = eventsFor(0, twoManifest.capabilities[0].capability_id); const ordinalOne = eventsFor(1, twoManifest.capabilities[1].capability_id); interleaved.events = [ordinalZero[0], ordinalOne[0], ...ordinalZero.slice(1), ...ordinalOne.slice(1)]; interleaved.events.forEach((event: any, index: number) => { event.sequence = index; event.occurred_at = new Date(Date.parse(interleaved.started_at) + (index + 1) * 100).toISOString(); resignEvent(event); }); resignTranscript(interleaved); expectCode("HTTPS_TRANSCRIPT_CAPABILITY", () => validateTranscript(interleaved, twoManifest));
  const completedTwo = structuredClone(transcript as any); completedTwo.manifest_id = twoManifest.manifest_id; completedTwo.expected_exchange_count = 2; completedTwo.attempted_exchange_count = 2; completedTwo.completed_exchange_count = 2; completedTwo.ended_at = new Date(Date.parse(completedTwo.started_at) + 2_000).toISOString(); completedTwo.events = [...eventsFor(0, twoManifest.capabilities[0].capability_id), ...eventsFor(1, twoManifest.capabilities[1].capability_id)]; completedTwo.events[9].evidence.response_sha256 = "6".repeat(64); completedTwo.events[9].evidence.response_bytes = 513; completedTwo.events.forEach((event: any, index: number) => { event.sequence = index; event.occurred_at = new Date(Date.parse(completedTwo.started_at) + (index + 1) * 100).toISOString(); resignEvent(event); }); resignTranscript(completedTwo);
  const retained = [{ artifact_role: "raw_https_response", sha256: "5".repeat(64), bytes: 512 }, { artifact_role: "raw_https_response_2", sha256: "6".repeat(64), bytes: 513 }];
  validateCompletedTranscriptOutputs(completedTwo, twoManifest, retained);
  expectCode("HTTPS_RESPONSE_OUTPUT_JOIN", () => validateCompletedTranscriptOutputs(completedTwo, twoManifest, retained.slice(0, 1)));
  expectCode("HTTPS_RESPONSE_OUTPUT_JOIN", () => validateCompletedTranscriptOutputs(completedTwo, twoManifest, [{ ...retained[0], artifact_role: "substituted_role" }, retained[1]]));
  expectCode("HTTPS_RESPONSE_OUTPUT_JOIN", () => validateCompletedTranscriptOutputs(completedTwo, twoManifest, [retained[0], { ...retained[1], sha256: "5".repeat(64) }]));
  expectCode("HTTPS_RESPONSE_OUTPUT_JOIN", () => validateCompletedTranscriptOutputs(completedTwo, twoManifest, [retained[0], { ...retained[1], bytes: 512 }]));
  expectCode("HTTPS_RESPONSE_OUTPUT_JOIN", () => validateCompletedTranscriptOutputs(completedTwo, twoManifest, [retained[0], { ...retained[1], artifact_role: retained[0].artifact_role }]));
  const failedTranscript = structuredClone(transcript as any); failedTranscript.events[4].event_type = "exchange_failed"; failedTranscript.events[4].outcome = "failed_closed"; failedTranscript.events[4].evidence = { failure_code: "upstream_rejected" }; failedTranscript.completed_exchange_count = 0; failedTranscript.final_outcome = "failed_closed"; resignEvent(failedTranscript.events[4]); resignTranscript(failedTranscript); expectCode("HTTPS_TRANSCRIPT_INCOMPLETE", () => validateCompletedTranscriptOutputs(failedTranscript, manifest, retained.slice(0, 1)));
  for (const timestamp of ["2026-07-16T00:00:60.000Z", "2026-02-31T00:00:00.000Z", "not-a-time", "2026-07-16T00:00:00Z"]) expectCode("HTTPS_TIMESTAMP", () => { parseCanonicalUtc(timestamp); });
  const wrongCapability = structuredClone(transcript as any); wrongCapability.events[0].capability_id = "9".repeat(64); wrongCapability.events[0].event_id = domainSeparatedId(ID_DOMAINS.event, wrongCapability.events[0], "event_id"); wrongCapability.transcript_id = domainSeparatedId(ID_DOMAINS.transcript, wrongCapability, "transcript_id"); expectCode("HTTPS_TRANSCRIPT_CAPABILITY", () => validateTranscript(wrongCapability, manifest));
  const legacy = { schema_version: "reviewed_metrics_execution_authorization_v2.4.0", stage_execution: { stages: [{ operation: { kind: "external_command", network_policy: "allow_capabilities_only", network_capability_ids: ["a".repeat(64)], execution_boundary: { network_policy: "allow_capabilities_only", network_capability_ids: ["a".repeat(64)] } } }] } };
  expectCode("HTTPS_RAW_NETWORK", () => validateAuthorizationNetworkContract(legacy));
  const migrated: any = structuredClone(legacy); migrated.https_exchange_authority = { raw_network_policy: "deny_all" };
  expectCode("HTTPS_LEGACY_MIGRATION", () => validateAuthorizationNetworkContract(migrated));
  const programSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(FIXTURE_ROOT, "stage-program-v2.2.json"))).digest("hex");
  const schemaPins = Object.fromEntries(Object.entries(AUTHORITY_SCHEMA_PINS).map(([field, [name, schemaVersion]]) => [field, expectedSchemaPin(name, schemaVersion)]));
  const v25: any = { schema_version: "reviewed_metrics_execution_authorization_v2.5.0", stage_execution: { stages: [{ stage_id: "source_predict", outputs: [{ artifact_role: "https_broker_transcript" }], operation: { kind: "external_command", script: { sha256: programSha }, network_policy: "deny_all", network_capability_ids: [], execution_boundary: { network_policy: "deny_all", network_capability_ids: [] } } }] }, https_exchange_authority: { raw_network_policy: "deny_all", ...schemaPins, manifest: { manifest_id: (manifest as any).manifest_id }, stage_bindings: [{ stage_id: "source_predict", manifest_id: (manifest as any).manifest_id, opaque_handle_count: 1, stage_program_version: "reviewed_metrics_stage_program_v2.2.0", stage_program_sha256: programSha }], transcript_output_role: "https_broker_transcript", predictor_exclusions: ["destination_manifest", "provider_auth_material"], legacy_migration: "explicit_reauthorization_required_no_automatic_allow_capabilities_migration" } };
  validateAuthorizationNetworkContract(v25);
  const substitutedSchema = structuredClone(v25); substitutedSchema.https_exchange_authority.uds_protocol_schema.sha256 = "f".repeat(64); expectCode("HTTPS_V25_SCHEMA_PIN", () => validateAuthorizationNetworkContract(substitutedSchema));
  const substitutedProgram = structuredClone(v25); substitutedProgram.stage_execution.stages[0].operation.script.sha256 = "f".repeat(64); expectCode("HTTPS_V25_AUTHORITY", () => validateAuthorizationNetworkContract(substitutedProgram));
  assertNoPredictorHttpsAuthorityLeak({ schema_version: "predictor_fixture_v1", https_exchange_handles: ["h2h_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] });
  expectCode("HTTPS_PREDICTOR_LEAK", () => assertNoPredictorHttpsAuthorityLeak({ destination_manifest: manifest }));
  expectCode("HTTPS_PREDICTOR_LEAK", () => assertNoPredictorHttpsAuthorityLeak({ provider_auth_material: "forbidden" }));
  expectCode("HTTPS_PREDICTOR_LEAK", () => assertNoPredictorHttpsAuthorityLeak({ prompt: "POST https://api.example.net with Authorization: Bearer secret" }));
  expectCode("HTTPS_SCHEMA", () => schema("execution-authorization.schema.v2.5.json", { schema_version: "reviewed_metrics_execution_authorization_v2.5.0" }));
  expectCode("HTTPS_SCHEMA", () => schema("execution-authorization.schema.v2.json", { schema_version: "reviewed_metrics_execution_authorization_v2.5.0" }));
  console.log("https exchange contract v1 self-test passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) selfTest();
