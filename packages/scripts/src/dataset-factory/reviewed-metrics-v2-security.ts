import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export class GateH2SecurityError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "GateH2SecurityError";
  }
}

function fail(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GateH2SecurityError(code, message);
}

export type RetentionObjectInput = {
  artifactRole: "private_expected_envelope" | "private_score_detail";
  bytes: Buffer;
  candidateId: string;
  finalizationId: string;
};

export type StorageObjectMetadata = {
  sha256: string;
  bytes: string;
  candidateId: string;
  finalizationId: string;
};

export type StorageWriteEvidence = {
  status: "created" | "preexisting_identical";
  statusCode: number;
  at: string;
  etag: string;
  versionId: string | null;
};

export type StorageHeadEvidence = {
  statusCode: number;
  at: string;
  etag: string;
  versionId: string | null;
  bytes: number;
  metadata: StorageObjectMetadata;
};

export type StorageGetEvidence = StorageHeadEvidence & { bytesValue: Buffer };

export type StoragePrivacyEvidence = {
  checkedAt: string;
  customDomainsStatusCode: number;
  managedDomainStatusCode: number;
  enabledCustomDomains: number;
  managedDomainEnabled: boolean;
  scriptsStatusCode: number;
  bindingsStatusCount: number;
  routesStatusCode: number;
  scriptCount: number;
  bindingCount: number;
  routeCount: number;
  inventoryDigest: string;
  noWorkerBucketBinding: boolean;
};

export interface PrivateObjectStore {
  objectKey(contentSha256: string): string;
  putIfAbsent(key: string, bytes: Buffer, metadata: StorageObjectMetadata): Promise<StorageWriteEvidence>;
  head(key: string): Promise<StorageHeadEvidence>;
  get(key: string, identity: { etag: string; versionId: string | null }): Promise<StorageGetEvidence>;
  verifyPrivate(): Promise<StoragePrivacyEvidence>;
  readonly bucketDigest: string;
  readonly capabilityId: string;
}

function now(): string { return new Date().toISOString(); }
function sha256(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function etag(value: string | undefined): string {
  fail(typeof value === "string" && value.trim().length > 0, "H2_RETENTION_OBJECT_IDENTITY", "R2 response omitted ETag");
  return value;
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  fail(body !== undefined && body !== null, "H2_RETENTION_READBACK", "R2 GET omitted body");
  const candidate = body as { transformToByteArray?: () => Promise<Uint8Array>; [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> };
  if (candidate.transformToByteArray) return Buffer.from(await candidate.transformToByteArray());
  const chunks: Buffer[] = [];
  if (candidate[Symbol.asyncIterator]) {
    for await (const chunk of candidate as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new GateH2SecurityError("H2_RETENTION_READBACK", "unsupported R2 GET body type");
}

type CloudflareEnvelope<T> = { success: boolean; result: T; result_info?: { page?: number; total_pages?: number; count?: number; total_count?: number }; errors?: Array<{ code?: number; message?: string }> };

export class CloudflareR2PrivateStore implements PrivateObjectStore {
  readonly bucketDigest: string;
  readonly capabilityId: string;
  private readonly client: S3Client;
  private readonly objectHmacKey: Buffer;
  private readonly bucketIdentity: string;

  constructor(
    private readonly accountId: string,
    private readonly bucket: string,
    private readonly apiToken: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
    capability: string,
    objectHmacKey: string,
    bucketIdentity: string,
    private readonly request: typeof fetch = fetch,
    client?: S3Client,
  ) {
    const expectedEndpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    fail(/^[a-f0-9]{32}$/.test(accountId), "H2_RETENTION_ACCOUNT_ENDPOINT", "Cloudflare account ID must be an exact 32-character lowercase hex identity");
    fail(endpoint === expectedEndpoint, "H2_RETENTION_ACCOUNT_ENDPOINT", "R2 endpoint must exactly match the privacy API account ID");
    fail(/^[a-f0-9]{32,128}$/.test(bucketIdentity), "H2_RETENTION_DEDICATED_BUCKET", "dedicated private bucket identity is missing or invalid");
    let decodedHmac: Buffer;
    try { decodedHmac = Buffer.from(objectHmacKey, "base64"); }
    catch { decodedHmac = Buffer.alloc(0); }
    fail(decodedHmac.length >= 32 && decodedHmac.length <= 64 && new Set(decodedHmac).size >= 16, "H2_RETENTION_HMAC_KEY", "R2 object HMAC key must contain at least 256 bits of high-entropy key material");
    fail(accountId.length > 0 && bucket.length > 0 && apiToken.length > 0 && accessKeyId.length > 0 && secretAccessKey.length > 0 && capability.length > 0, "H2_RETENTION_CAPABILITY", "R2 capability environment is incomplete");
    this.objectHmacKey = decodedHmac;
    this.bucketIdentity = bucketIdentity;
    this.bucketDigest = sha256(`gate-h2-r2-dedicated-bucket-v3\n${accountId}\n${bucket}\n${bucketIdentity}`);
    this.capabilityId = sha256(`gate-h2-r2-capability-v2\n${capability}`);
    this.client = client ?? new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): CloudflareR2PrivateStore {
    const required = (name: string): string => {
      const value = env[name];
      fail(value, "H2_RETENTION_CAPABILITY", `required environment capability ${name} is unavailable`);
      return value;
    };
    return new CloudflareR2PrivateStore(
      required("CLOUDFLARE_ACCOUNT_ID"),
      required("GATE_H2_R2_BUCKET"),
      required("CLOUDFLARE_API_TOKEN"),
      required("CLOUDFLARE_R2_ENDPOINT"),
      required("AWS_ACCESS_KEY_ID"),
      required("AWS_SECRET_ACCESS_KEY"),
      required("GATE_H2_R2_CAPABILITY_ID"),
      required("GATE_H2_R2_OBJECT_HMAC_KEY"),
      required("GATE_H2_R2_DEDICATED_BUCKET_ID"),
    );
  }

  objectKey(contentSha256: string): string {
    fail(/^[a-f0-9]{64}$/.test(contentSha256), "H2_RETENTION_OBJECT_KEY", "private object digest is invalid");
    const opaque = crypto.createHmac("sha256", this.objectHmacKey)
      .update(`gate-h2-r2-object-v3\n${this.bucketIdentity}\n${contentSha256}`)
      .digest("hex");
    return `gate-h2/private/opaque/${opaque}`;
  }

  async putIfAbsent(key: string, bytes: Buffer, metadata: StorageObjectMetadata): Promise<StorageWriteEvidence> {
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Metadata: {
          "gate-h2-sha256": metadata.sha256,
          "gate-h2-bytes": metadata.bytes,
          "gate-h2-candidate": metadata.candidateId,
          "gate-h2-finalization": metadata.finalizationId,
        },
      }));
      return { status: "created", statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), etag: etag(response.ETag), versionId: response.VersionId ?? null };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw new GateH2SecurityError("H2_RETENTION_PUT", "conditional R2 PUT failed");
      const head = await this.head(key);
      const existing = await this.get(key, { etag: head.etag, versionId: head.versionId });
      fail(existing.bytesValue.equals(bytes), "H2_RETENTION_PREEXISTING_DIFFERENT", "opaque content key already contains different bytes");
      fail(canonicalMetadata(existing.metadata) === canonicalMetadata(metadata), "H2_RETENTION_METADATA", "preexisting object metadata differs");
      return { status: "preexisting_identical", statusCode: status, at: now(), etag: head.etag, versionId: head.versionId };
    }
  }

  async head(key: string): Promise<StorageHeadEvidence> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), etag: etag(response.ETag), versionId: response.VersionId ?? null, bytes: response.ContentLength ?? -1, metadata: parseMetadata(response.Metadata) };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_HEAD", "R2 HEAD failed");
    }
  }

  async get(key: string, identity: { etag: string; versionId: string | null }): Promise<StorageGetEvidence> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: identity.etag, ...(identity.versionId === null ? {} : { VersionId: identity.versionId }) }));
      const bytesValue = await bodyBytes(response.Body);
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), bytesValue, etag: etag(response.ETag), versionId: response.VersionId ?? null, bytes: response.ContentLength ?? bytesValue.length, metadata: parseMetadata(response.Metadata) };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_READBACK", "R2 GET failed");
    }
  }

  private async api<T>(suffix: string): Promise<{ statusCode: number; result: T; resultInfo?: CloudflareEnvelope<T>["result_info"] }> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}${suffix}`;
    let response: Response;
    try {
      response = await this.request(url, { method: "GET", headers: { Authorization: `Bearer ${this.apiToken}`, Accept: "application/json" }, redirect: "error" });
    } catch {
      throw new GateH2SecurityError("H2_RETENTION_PRIVACY_PROOF", "Cloudflare privacy API request failed");
    }
    let payload: CloudflareEnvelope<T>;
    try { payload = await response.json() as CloudflareEnvelope<T>; }
    catch { throw new GateH2SecurityError("H2_RETENTION_PRIVACY_PROOF", "Cloudflare privacy API returned invalid JSON"); }
    fail(response.ok && payload.success === true, "H2_RETENTION_PRIVACY_PROOF", "Cloudflare privacy API did not prove bucket configuration");
    return { statusCode: response.status, result: payload.result, resultInfo: payload.result_info };
  }

  private async collection<T>(suffix: string): Promise<{ statusCodes: number[]; result: T[] }> {
    const result: T[] = [];
    const statusCodes: number[] = [];
    for (let page = 1; page <= 100; page++) {
      const separator = suffix.includes("?") ? "&" : "?";
      const response = await this.api<T[]>(`${suffix}${separator}page=${page}&per_page=100`);
      const info = response.resultInfo;
      fail(Array.isArray(response.result) && info?.page === page && Number.isInteger(info.total_pages) && info.total_pages! >= page && info.count === response.result.length && Number.isInteger(info.total_count) && info.total_count! >= result.length + response.result.length, "H2_RETENTION_PRIVACY_ENUMERATION", "Cloudflare collection pagination proof is incomplete");
      result.push(...response.result);
      statusCodes.push(response.statusCode);
      if (page === info.total_pages) {
        fail(result.length === info.total_count, "H2_RETENTION_PRIVACY_ENUMERATION", "Cloudflare collection total count is incomplete");
        return { statusCodes, result };
      }
    }
    throw new GateH2SecurityError("H2_RETENTION_PRIVACY_ENUMERATION", "Cloudflare collection exceeded the bounded page limit");
  }

  async verifyPrivate(): Promise<StoragePrivacyEvidence> {
    const bucketRoot = `/r2/buckets/${encodeURIComponent(this.bucket)}`;
    const custom = await this.api<{ domains: Array<{ enabled: boolean }> }>(`${bucketRoot}/domains/custom`);
    const managed = await this.api<{ enabled: boolean }>(`${bucketRoot}/domains/managed`);
    fail(Array.isArray(custom.result.domains) && custom.result.domains.every((domain) => typeof domain.enabled === "boolean") && typeof managed.result.enabled === "boolean", "H2_RETENTION_PRIVACY_PROOF", "Cloudflare privacy API response shape is incomplete");
    const enabledCustomDomains = custom.result.domains.filter((domain) => domain.enabled).length;
    fail(enabledCustomDomains === 0 && managed.result.enabled === false, "H2_RETENTION_PUBLIC_EXPOSURE", "R2 bucket has enabled custom-domain or r2.dev public exposure");
    const scripts = await this.collection<{ id?: string }>("/workers/scripts");
    fail(Array.isArray(scripts.result) && scripts.result.every((script) => typeof script.id === "string" && script.id.length > 0), "H2_RETENTION_PRIVACY_ENUMERATION", "Workers script enumeration is incomplete");
    const bindingDigests: string[] = [];
    let bindingCount = 0;
    let bindingsStatusCount = 0;
    let bucketBound = false;
    for (const script of scripts.result) {
      const bindings = await this.collection<Record<string, unknown>>(`/workers/scripts/${encodeURIComponent(script.id!)}/bindings`);
      bindingsStatusCount += bindings.statusCodes.length;
      fail(Array.isArray(bindings.result), "H2_RETENTION_PRIVACY_ENUMERATION", "Workers binding enumeration is incomplete");
      for (const binding of bindings.result) {
        bindingCount += 1;
        const type = String(binding.type ?? "");
        const namespace = String(binding.namespace ?? binding.bucket_name ?? "");
        if ((type === "r2_bucket" || type === "r2") && namespace === this.bucket) bucketBound = true;
        bindingDigests.push(sha256(JSON.stringify([type, namespace === this.bucket, Object.keys(binding).sort()])));
      }
    }
    const routes = await this.collection<Record<string, unknown>>("/workers/routes");
    fail(Array.isArray(routes.result), "H2_RETENTION_PRIVACY_ENUMERATION", "Workers route enumeration is incomplete");
    fail(!bucketBound, "H2_RETENTION_WORKER_EXPOSURE", "a Worker has an R2 binding to the dedicated private bucket");
    const inventoryDigest = sha256(JSON.stringify({ scripts: scripts.result.length, bindings: bindingDigests.sort(), routes: routes.result.length }));
    return { checkedAt: now(), customDomainsStatusCode: custom.statusCode, managedDomainStatusCode: managed.statusCode, enabledCustomDomains, managedDomainEnabled: false, scriptsStatusCode: scripts.statusCodes[0], bindingsStatusCount, routesStatusCode: routes.statusCodes[0], scriptCount: scripts.result.length, bindingCount, routeCount: routes.result.length, inventoryDigest, noWorkerBucketBinding: true };
  }
}

function canonicalMetadata(metadata: StorageObjectMetadata): string {
  return JSON.stringify([metadata.sha256, metadata.bytes, metadata.candidateId, metadata.finalizationId]);
}

function parseMetadata(value: Record<string, string> | undefined): StorageObjectMetadata {
  const metadata = {
    sha256: value?.["gate-h2-sha256"] ?? "",
    bytes: value?.["gate-h2-bytes"] ?? "",
    candidateId: value?.["gate-h2-candidate"] ?? "",
    finalizationId: value?.["gate-h2-finalization"] ?? "",
  };
  fail(/^[a-f0-9]{64}$/.test(metadata.sha256) && /^[1-9][0-9]*$/.test(metadata.bytes) && metadata.candidateId.length > 0 && /^[a-f0-9]{64}$/.test(metadata.finalizationId), "H2_RETENTION_METADATA", "R2 custom metadata is missing or invalid");
  return metadata;
}

export async function retainPrivateObjects(store: PrivateObjectStore, inputs: RetentionObjectInput[]): Promise<{
  privacy: { preflight: Record<string, unknown>; postflight: Record<string, unknown> };
  objects: Array<Record<string, unknown>>;
}> {
  fail(inputs.length === 2 && new Set(inputs.map((input) => input.artifactRole)).size === 2, "H2_RETENTION_EXACT_BYTES", "exactly two distinct private objects are required");
  const preflight = await store.verifyPrivate();
  const objects: Array<Record<string, unknown>> = [];
  for (const input of inputs) {
    const digest = sha256(input.bytes);
    const key = store.objectKey(digest);
    fail(!key.includes(digest), "H2_RETENTION_OBJECT_KEY", "opaque private object key must not disclose the content digest");
    const metadata = { sha256: digest, bytes: String(input.bytes.length), candidateId: input.candidateId, finalizationId: input.finalizationId };
    const put = await store.putIfAbsent(key, input.bytes, metadata);
    fail(
      (put.status === "created" && put.statusCode >= 200 && put.statusCode < 300) ||
        (put.status === "preexisting_identical" && (put.statusCode === 409 || put.statusCode === 412)),
      "H2_RETENTION_PUT",
      "conditional R2 PUT did not return an allowed status",
    );
    const head = await store.head(key);
    fail(head.statusCode >= 200 && head.statusCode < 300 && head.bytes === input.bytes.length, "H2_RETENTION_HEAD", "R2 HEAD did not verify exact object length");
    fail(canonicalMetadata(head.metadata) === canonicalMetadata(metadata), "H2_RETENTION_METADATA", "R2 HEAD custom metadata differs from sealed object metadata");
    fail(head.etag === put.etag && (head.versionId === put.versionId || put.versionId === null), "H2_RETENTION_OBJECT_IDENTITY", "R2 PUT and HEAD object identity differ");
    const get = await store.get(key, { etag: head.etag, versionId: head.versionId });
    fail(get.statusCode >= 200 && get.statusCode < 300 && get.bytesValue.equals(input.bytes), "H2_RETENTION_READBACK", "R2 GET bytes differ from sealed private bytes");
    fail(get.etag === head.etag && get.versionId === head.versionId && get.bytes === head.bytes, "H2_RETENTION_OBJECT_IDENTITY", "conditional R2 GET identity differs from HEAD");
    fail(canonicalMetadata(get.metadata) === canonicalMetadata(metadata), "H2_RETENTION_METADATA", "R2 GET custom metadata differs from sealed object metadata");
    const stableHead = await store.head(key);
    fail(stableHead.etag === head.etag && stableHead.versionId === head.versionId && stableHead.bytes === head.bytes && canonicalMetadata(stableHead.metadata) === canonicalMetadata(metadata), "H2_RETENTION_OBJECT_IDENTITY", "R2 object identity changed after exact readback");
    objects.push({
      artifact_role: input.artifactRole,
      object_key_sha256: sha256(`gate-h2-r2-object-key-v2\n${key}`),
      opaque_object_id: path.posix.basename(key),
      version_id: head.versionId,
      etag: head.etag,
      sha256: digest,
      bytes: input.bytes.length,
      operations: {
        put: { status: put.status, status_code: put.statusCode, at: put.at },
        head: { status: "verified", status_code: head.statusCode, at: head.at },
        get: { status: "exact_version_bytes_verified", status_code: get.statusCode, at: get.at },
        stable_head: { status: "verified", status_code: stableHead.statusCode, at: stableHead.at },
      },
      written_at: put.at,
      readback_at: get.at,
      no_public_acl: true,
      readback_verified: true,
    });
  }
  const postflight = await store.verifyPrivate();
  const privacyEvidence = (value: StoragePrivacyEvidence) => ({
    checked_at: value.checkedAt,
    custom_domains_status_code: value.customDomainsStatusCode,
    managed_domain_status_code: value.managedDomainStatusCode,
    enabled_custom_domains: value.enabledCustomDomains,
    managed_domain_enabled: value.managedDomainEnabled,
    scripts_status_code: value.scriptsStatusCode,
    bindings_status_count: value.bindingsStatusCount,
    routes_status_code: value.routesStatusCode,
    script_count: value.scriptCount,
    binding_count: value.bindingCount,
    route_count: value.routeCount,
    inventory_digest: value.inventoryDigest,
    no_worker_bucket_binding: value.noWorkerBucketBinding,
  });
  return { privacy: { preflight: privacyEvidence(preflight), postflight: privacyEvidence(postflight) }, objects };
}

export type AwsCertificate = { regions: string[]; pem: string; certificate_sha256: string };

export type TrustedExecutableName = "openssl" | "curl" | "ioreg" | "sw_vers" | "uname";
const TRUSTED_EXECUTABLES: Record<NodeJS.Platform, Partial<Record<TrustedExecutableName, string>>> = {
  darwin: { openssl: "/usr/bin/openssl", curl: "/usr/bin/curl", ioreg: "/usr/sbin/ioreg", sw_vers: "/usr/bin/sw_vers", uname: "/usr/bin/uname" },
  linux: { openssl: "/usr/bin/openssl", curl: "/usr/bin/curl", uname: "/usr/bin/uname" },
  aix: {}, android: {}, freebsd: {}, haiku: {}, openbsd: {}, sunos: {}, win32: {}, cygwin: {}, netbsd: {},
};

function verifyTrustedExecutable(name: TrustedExecutableName, injectedPath?: string): string {
  const approved = injectedPath ?? TRUSTED_EXECUTABLES[process.platform]?.[name];
  fail(typeof approved === "string" && path.isAbsolute(approved), "H2_TRUSTED_EXECUTABLE", `no approved absolute ${name} executable for this OS`);
  let real: string;
  let fd: number | undefined;
  try {
    real = fs.realpathSync(approved);
    fail(real === approved, "H2_TRUSTED_EXECUTABLE", `${name} executable must not be a symlink or alias`);
    fd = fs.openSync(approved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    fail(stat.isFile() && stat.uid === 0 && (stat.mode & 0o022) === 0, "H2_TRUSTED_EXECUTABLE", `${name} executable must be root-owned and not group/world writable`);
    const pathStat = fs.statSync(approved);
    fail(pathStat.dev === stat.dev && pathStat.ino === stat.ino, "H2_TRUSTED_EXECUTABLE", `${name} executable changed during verification`);
    return approved;
  } catch (error) {
    if (error instanceof GateH2SecurityError) throw error;
    throw new GateH2SecurityError("H2_TRUSTED_EXECUTABLE", `${name} executable verification failed`);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function trustedExecutable(name: TrustedExecutableName): string {
  return verifyTrustedExecutable(name);
}

export async function securityHelperSelfTest(): Promise<{ status: string; exact_codes: Record<string, string> }> {
  const exactCodes: Record<string, string> = {};
  const reject = async (label: string, code: string, operation: () => unknown | Promise<unknown>) => {
    let observed = "";
    try { await operation(); }
    catch (error) { if (error instanceof GateH2SecurityError) observed = error.code; }
    if (observed !== code) throw new GateH2SecurityError("H2_SECURITY_TEST_EXACT_CODE", `${label}: expected ${code}, observed ${observed || "no rejection"}`);
    exactCodes[label] = observed;
  };
  const account = "0123456789abcdef0123456789abcdef";
  const endpoint = `https://${account}.r2.cloudflarestorage.com`;
  const hmacKey = crypto.randomBytes(32).toString("base64");
  const bucketIdentity = crypto.randomBytes(32).toString("hex");
  type MockOptions = { metadataMismatch?: boolean; identityRace?: boolean; workerBinding?: boolean; incompleteScripts?: boolean; postflightExposure?: boolean };
  const makeStore = (options: MockOptions = {}) => {
    const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string>; etag: string; version: string }>();
    const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const input = command.input as { Key: string; Body?: Buffer; Metadata?: Record<string, string>; IfMatch?: string; VersionId?: string };
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(input.Key, { bytes: Buffer.from(input.Body!), metadata: { ...input.Metadata }, etag: '"etag-v1"', version: "version-v1" });
        return { $metadata: { httpStatusCode: 200 }, ETag: '"etag-v1"', VersionId: "version-v1" };
      }
      const object = objects.get(input.Key)!;
      if (command.constructor.name === "HeadObjectCommand") return { $metadata: { httpStatusCode: 200 }, ETag: object.etag, VersionId: object.version, ContentLength: object.bytes.length, Metadata: options.metadataMismatch ? { ...object.metadata, "gate-h2-sha256": "0".repeat(64) } : object.metadata };
      fail(input.IfMatch === object.etag && input.VersionId === object.version, "H2_RETENTION_OBJECT_IDENTITY", "GET omitted exact IfMatch or VersionId");
      return { $metadata: { httpStatusCode: 200 }, ETag: options.identityRace ? '"etag-v2"' : object.etag, VersionId: options.identityRace ? "version-v2" : object.version, ContentLength: object.bytes.length, Metadata: object.metadata, Body: { transformToByteArray: async () => object.bytes } };
    } } as unknown as S3Client;
    let customChecks = 0;
    const request: typeof fetch = async (urlValue) => {
      const url = new URL(String(urlValue));
      const pathname = url.pathname;
      let result: unknown;
      if (pathname.endsWith("/domains/custom")) { customChecks += 1; result = { domains: options.postflightExposure && customChecks === 2 ? [{ enabled: true }] : [] }; }
      else if (pathname.endsWith("/domains/managed")) result = { enabled: false };
      else if (pathname.endsWith("/workers/scripts")) result = options.incompleteScripts ? [{}] : [{ id: "opaque-script" }];
      else if (pathname.endsWith("/bindings")) result = options.workerBinding ? [{ type: "r2_bucket", namespace: "dedicated-private" }] : [];
      else if (pathname.endsWith("/workers/routes")) result = [];
      else return new Response("not found", { status: 404 });
      const collection = url.searchParams.has("page");
      return new Response(JSON.stringify({ success: true, result, ...(collection ? { result_info: { page: 1, total_pages: 1, count: (result as unknown[]).length, total_count: (result as unknown[]).length } } : {}) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    return new CloudflareR2PrivateStore(account, "dedicated-private", "api-token", endpoint, "access-key", "secret-key", "capability", hmacKey, bucketIdentity, request, client);
  };
  await reject("account-endpoint-mismatch", "H2_RETENTION_ACCOUNT_ENDPOINT", () => new CloudflareR2PrivateStore(account, "dedicated-private", "token", "https://ffffffffffffffffffffffffffffffff.r2.cloudflarestorage.com", "access", "secret", "capability", hmacKey, bucketIdentity));
  await reject("weak-hmac-key", "H2_RETENTION_HMAC_KEY", () => new CloudflareR2PrivateStore(account, "dedicated-private", "token", endpoint, "access", "secret", "capability", Buffer.alloc(8, 1).toString("base64"), bucketIdentity));
  await reject("missing-hmac-key", "H2_RETENTION_HMAC_KEY", () => new CloudflareR2PrivateStore(account, "dedicated-private", "token", endpoint, "access", "secret", "capability", "", bucketIdentity));
  const digest = sha256("sealed-private");
  fail(!makeStore().objectKey(digest).includes(digest), "H2_SECURITY_TEST_OBJECT_KEY", "opaque HMAC key is reconstructable from the public digest");
  const inputs: RetentionObjectInput[] = [
    { artifactRole: "private_expected_envelope", bytes: Buffer.from("sealed-envelope"), candidateId: "candidate", finalizationId: "a".repeat(64) },
    { artifactRole: "private_score_detail", bytes: Buffer.from("sealed-detail"), candidateId: "candidate", finalizationId: "a".repeat(64) },
  ];
  const noExposure = await retainPrivateObjects(makeStore(), inputs);
  fail(noExposure.objects.length === 2 && noExposure.privacy.postflight.no_worker_bucket_binding === true, "H2_SECURITY_TEST_PRIVATE", "no-exposure mock did not complete");
  const plainKeyStore = makeStore();
  plainKeyStore.objectKey = (contentSha256: string) => `gate-h2/private/sha256/${contentSha256}`;
  await reject("plain-reconstructable-key", "H2_RETENTION_OBJECT_KEY", () => retainPrivateObjects(plainKeyStore, inputs));
  await reject("ifmatch-version-race", "H2_RETENTION_OBJECT_IDENTITY", () => retainPrivateObjects(makeStore({ identityRace: true }), inputs));
  await reject("custom-metadata-mismatch", "H2_RETENTION_METADATA", () => retainPrivateObjects(makeStore({ metadataMismatch: true }), inputs));
  await reject("worker-r2-binding", "H2_RETENTION_WORKER_EXPOSURE", () => retainPrivateObjects(makeStore({ workerBinding: true }), inputs));
  await reject("incomplete-worker-enumeration", "H2_RETENTION_PRIVACY_ENUMERATION", () => retainPrivateObjects(makeStore({ incompleteScripts: true }), inputs));
  await reject("postflight-public-change", "H2_RETENTION_PUBLIC_EXPOSURE", () => retainPrivateObjects(makeStore({ postflightExposure: true }), inputs));
  const oldPath = process.env.PATH;
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-path-shadow-"));
  try {
    fs.writeFileSync(path.join(shadow, "openssl"), "#!/bin/sh\nexit 0\n", { mode: 0o777 });
    process.env.PATH = `${shadow}:${oldPath ?? ""}`;
    fail(trustedExecutable("openssl") === "/usr/bin/openssl", "H2_SECURITY_TEST_PATH_SHADOW", "PATH shadow changed trusted executable resolution");
    await reject("writable-executable", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("openssl", path.join(shadow, "openssl")));
    const alias = path.join(shadow, "openssl-alias");
    fs.symlinkSync("/usr/bin/openssl", alias);
    await reject("replaced-executable-alias", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("openssl", alias));
  } finally { process.env.PATH = oldPath; fs.rmSync(shadow, { recursive: true, force: true }); }
  return { status: "security_helper_self_test_passed", exact_codes: exactCodes };
}

export function verifyAwsInstanceIdentityPkcs7(
  documentRaw: Buffer,
  pkcs7Raw: Buffer,
  expected: { account_id: string; region: string; instance_id: string; image_id: string; pending_time: string },
  certificates: AwsCertificate[],
  measuredAt: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): { document: Record<string, unknown>; certificate_sha256: string } {
  let document: Record<string, unknown>;
  try { document = JSON.parse(documentRaw.toString("utf8")); }
  catch { throw new GateH2SecurityError("H2_AWS_IDENTITY_DOCUMENT", "AWS identity document is not valid JSON"); }
  fail(
    document.accountId === expected.account_id && document.region === expected.region && document.instanceId === expected.instance_id &&
      document.imageId === expected.image_id && document.pendingTime === expected.pending_time,
    "H2_AWS_IDENTITY_BINDING",
    "signed AWS identity fields do not match the authorized instance binding",
  );
  const pending = Date.parse(String(document.pendingTime));
  const measured = Date.parse(measuredAt);
  fail(Number.isFinite(pending) && Number.isFinite(measured) && pending <= measured && measured - pending <= maxAgeMs, "H2_AWS_IDENTITY_FRESHNESS", "AWS instance identity pending time is stale or in the future");
  const certificate = certificates.find((candidate) => candidate.regions.includes(String(document.region)));
  fail(certificate, "H2_AWS_IDENTITY_CERTIFICATE", "no pinned official AWS DSA certificate exists for this region");
  const x509 = new crypto.X509Certificate(certificate.pem);
  const fingerprint = sha256(x509.raw);
  fail(fingerprint === certificate.certificate_sha256, "H2_AWS_IDENTITY_CERTIFICATE", "pinned AWS certificate fingerprint mismatch");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-aws-iid-"));
  try {
    const signature = path.join(temp, "identity.pkcs7.pem");
    const cert = path.join(temp, "aws-dsa.pem");
    const verified = path.join(temp, "verified-document");
    const normalizedPkcs7 = pkcs7Raw.toString("utf8").includes("BEGIN PKCS7")
      ? pkcs7Raw
      : Buffer.from(`-----BEGIN PKCS7-----\n${pkcs7Raw.toString("utf8").trim()}\n-----END PKCS7-----\n`);
    fs.writeFileSync(signature, normalizedPkcs7, { mode: 0o600 });
    fs.writeFileSync(cert, certificate.pem, { mode: 0o600 });
    try {
      execFileSync(trustedExecutable("openssl"), ["smime", "-verify", "-binary", "-nointern", "-in", signature, "-inform", "PEM", "-certfile", cert, "-noverify", "-out", verified], { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      throw new GateH2SecurityError("H2_AWS_IDENTITY_SIGNATURE", "AWS PKCS7 signature verification failed");
    }
    const signedBytes = fs.readFileSync(verified);
    fail(signedBytes.equals(documentRaw), "H2_AWS_IDENTITY_DOCUMENT_MISMATCH", "PKCS7 signed bytes differ from IMDS document bytes");
    return { document, certificate_sha256: fingerprint };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
