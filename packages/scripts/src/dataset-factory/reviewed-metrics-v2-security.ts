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
  status: "new_write" | "preexisting_verified";
  statusCode: number;
  attemptedAt: string;
  completedAt: string;
  etag: string;
  versionId: string | null;
  observedExistingAt?: string;
  recoveryHead?: StorageHeadEvidence;
  recoveryGet?: StorageGetEvidence;
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
  enabledCustomDomains: number;
  managedDomainEnabled: boolean;
  statusCodeDigest: string;
  requestCount: number;
  scriptCount: number;
  dispatchNamespaceCount: number;
  dispatchScriptCount: number;
  pagesProjectCount: number;
  bindingCount: number;
  workersDevEnabled: boolean;
  customWorkerDomainCount: number;
  zoneCount: number;
  routeCount: number;
  inventoryDigest: string;
  noR2BucketBinding: boolean;
  noDirectPublicDomain: boolean;
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

const WORKER_SETTINGS_KEYS = [
  "annotations", "assets", "bindings", "compatibility_date", "compatibility_flags", "limits", "logpush",
  "observability", "placement", "tail_consumers", "tags", "usage_model",
] as const;
const KNOWN_WORKER_BINDING_TYPES = new Set([
  "ai", "analytics_engine", "browser", "d1", "dispatch_namespace", "durable_object_namespace",
  "hyperdrive", "inherit", "json", "kv_namespace", "mtls_certificate", "plain_text", "queue",
  "r2_bucket", "secret_text", "service", "vectorize", "version_metadata", "wasm_module",
]);
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}
function isExactBooleanObject(value: unknown, key: string): value is Record<string, boolean> {
  return isExactObject(value, [key]) && typeof value[key] === "boolean";
}
function assertNamedCollection(values: Record<string, unknown>[], nameKeys: readonly string[], label: string): void {
  fail(values.every((value) => isObject(value) && nameKeys.some((key) => typeof value[key] === "string" && (value[key] as string).length > 0)), "H2_RETENTION_PRIVACY_SCHEMA", `${label} do not match the pinned v4 schema`);
}
function canonicalInventoryValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalInventoryValue).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalInventoryValue(object[key])}`).join(",")}}`;
}
function canonInventory(value: unknown): string {
  return sha256(`gate-h2-cloudflare-inventory-v4\0${canonicalInventoryValue(value)}`);
}

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
    private readonly clock: () => string = now,
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
    const attemptedAt = this.clock();
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
      return { status: "new_write", statusCode: response.$metadata.httpStatusCode ?? 0, attemptedAt, completedAt: this.clock(), etag: etag(response.ETag), versionId: response.VersionId ?? null };
    } catch (error) {
      const completedAt = this.clock();
      if (error instanceof GateH2SecurityError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw new GateH2SecurityError("H2_RETENTION_PUT", "conditional R2 PUT failed");
      const head = await this.head(key);
      const existing = await this.get(key, { etag: head.etag, versionId: head.versionId });
      fail(existing.bytesValue.equals(bytes), "H2_RETENTION_PREEXISTING_DIFFERENT", "opaque content key already contains different bytes");
      fail(canonicalMetadata(existing.metadata) === canonicalMetadata(metadata), "H2_RETENTION_METADATA", "preexisting object metadata differs");
      return {
        status: "preexisting_verified",
        statusCode: status,
        attemptedAt,
        completedAt,
        etag: head.etag,
        versionId: head.versionId,
        observedExistingAt: existing.at,
        recoveryHead: head,
        recoveryGet: existing,
      };
    }
  }

  async head(key: string): Promise<StorageHeadEvidence> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: this.clock(), etag: etag(response.ETag), versionId: response.VersionId ?? null, bytes: response.ContentLength ?? -1, metadata: parseMetadata(response.Metadata) };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_HEAD", "R2 HEAD failed");
    }
  }

  async get(key: string, identity: { etag: string; versionId: string | null }): Promise<StorageGetEvidence> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, IfMatch: identity.etag, ...(identity.versionId === null ? {} : { VersionId: identity.versionId }) }));
      const bytesValue = await bodyBytes(response.Body);
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: this.clock(), bytesValue, etag: etag(response.ETag), versionId: response.VersionId ?? null, bytes: response.ContentLength ?? bytesValue.length, metadata: parseMetadata(response.Metadata) };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_READBACK", "R2 GET failed");
    }
  }

  private async api<T>(apiPath: string): Promise<{ statusCode: number; result: T; resultInfo?: CloudflareEnvelope<T>["result_info"] }> {
    const url = `https://api.cloudflare.com/client/v4${apiPath}`;
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

  private async singlePage<T>(apiPath: string): Promise<{ statusCodes: number[]; result: T[] }> {
    const response = await this.api<T[]>(apiPath);
    fail(Array.isArray(response.result) && response.resultInfo === undefined, "H2_RETENTION_PRIVACY_ENUMERATION", "Cloudflare SinglePage response unexpectedly used pagination metadata");
    return { statusCodes: [response.statusCode], result: response.result };
  }

  private async paginated<T>(apiPath: string): Promise<{ statusCodes: number[]; result: T[] }> {
    const result: T[] = [];
    const statusCodes: number[] = [];
    for (let page = 1; page <= 100; page++) {
      const separator = apiPath.includes("?") ? "&" : "?";
      const response = await this.api<T[]>(`${apiPath}${separator}page=${page}&per_page=100`);
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
    const accountRoot = `/accounts/${encodeURIComponent(this.accountId)}`;
    const bucketRoot = `${accountRoot}/r2/buckets/${encodeURIComponent(this.bucket)}`;
    const custom = await this.api<{ domains: Array<{ enabled: boolean }> }>(`${bucketRoot}/domains/custom`);
    const managed = await this.api<{ enabled: boolean }>(`${bucketRoot}/domains/managed`);
    fail(isExactObject(custom.result, ["domains"]) && Array.isArray(custom.result.domains) && custom.result.domains.every((domain) => isExactBooleanObject(domain, "enabled")) && isExactBooleanObject(managed.result, "enabled"), "H2_RETENTION_PRIVACY_SCHEMA", "Cloudflare R2 domain response does not match the pinned v4 schema");
    const enabledCustomDomains = custom.result.domains.filter((domain) => domain.enabled).length;
    fail(enabledCustomDomains === 0 && managed.result.enabled === false, "H2_RETENTION_PUBLIC_EXPOSURE", "R2 bucket has enabled custom-domain or r2.dev public exposure");

    const scripts = await this.singlePage<Record<string, unknown>>(`${accountRoot}/workers/scripts`);
    assertNamedCollection(scripts.result, ["id"], "Workers scripts");
    const dispatchNamespaces = await this.paginated<Record<string, unknown>>(`${accountRoot}/workers/dispatch/namespaces`);
    assertNamedCollection(dispatchNamespaces.result, ["namespace", "name"], "dispatch namespaces");
    const pagesProjects = await this.paginated<Record<string, unknown>>(`${accountRoot}/pages/projects`);
    const workerDomains = await this.paginated<Record<string, unknown>>(`${accountRoot}/workers/domains`);
    assertNamedCollection(workerDomains.result, ["id", "hostname"], "Workers custom domains");
    const zones = await this.paginated<Record<string, unknown>>(`/zones?account.id=${encodeURIComponent(this.accountId)}`);
    assertNamedCollection(zones.result, ["id"], "account zones");
    const statusCodes = [custom.statusCode, managed.statusCode, ...scripts.statusCodes, ...dispatchNamespaces.statusCodes, ...pagesProjects.statusCodes, ...workerDomains.statusCodes, ...zones.statusCodes];
    const inventory: string[] = [];
    inventory.push(canonInventory(["r2_custom_domains", custom.result]), canonInventory(["r2_managed_domain", managed.result]));
    const identities = (values: Record<string, unknown>[], key: string, label: string): string[] => {
      const result = values.map((value) => String(value[key]));
      fail(result.every((value) => value.length > 0) && new Set(result).size === result.length, "H2_RETENTION_PRIVACY_ENUMERATION", `${label} identities must be complete and unique`);
      return result;
    };
    const scriptIds = identities(scripts.result, "id", "Workers script");
    const namespaceIds = dispatchNamespaces.result.map((value) => String(value.namespace ?? value.name));
    fail(namespaceIds.every((value) => value.length > 0) && new Set(namespaceIds).size === namespaceIds.length, "H2_RETENTION_PRIVACY_ENUMERATION", "dispatch namespace identities must be complete and unique");
    fail(dispatchNamespaces.result.length === 0, "H2_RETENTION_DISPATCH_INVENTORY", "dispatch namespaces exist but Cloudflare exposes no documented complete dispatch-script inventory endpoint");
    identities(pagesProjects.result, "name", "Pages project");
    identities(workerDomains.result, workerDomains.result.some((value) => typeof value.id === "string") ? "id" : "hostname", "Workers custom domain");
    identities(zones.result, "id", "zone");
    for (const value of [...scripts.result, ...dispatchNamespaces.result, ...pagesProjects.result, ...workerDomains.result, ...zones.result]) inventory.push(canonInventory(value));
    let bindingCount = 0;
    let bucketBound = false;
    const inspectBindings = (bindings: unknown, surface: string): void => {
      fail(Array.isArray(bindings), "H2_RETENTION_PRIVACY_SCHEMA", `${surface} bindings must be an array`);
      for (const binding of bindings) {
        fail(isObject(binding) && typeof binding.type === "string" && typeof binding.name === "string", "H2_RETENTION_PRIVACY_SCHEMA", `${surface} binding does not match the pinned v4 schema`);
        const type = binding.type;
        fail(KNOWN_WORKER_BINDING_TYPES.has(type), "H2_RETENTION_PRIVACY_SCHEMA", `${surface} returned an unknown binding type`);
        const bucketName = type === "r2_bucket" ? binding.bucket_name : undefined;
        fail(type !== "r2_bucket" || typeof bucketName === "string", "H2_RETENTION_PRIVACY_SCHEMA", `${surface} R2 binding omitted bucket_name`);
        bindingCount += 1;
        if (bucketName === this.bucket) bucketBound = true;
        inventory.push(sha256(JSON.stringify([surface, type, bucketName === this.bucket, Object.keys(binding).sort()])));
      }
    };
    let workersDevEnabled = false;
    for (const id of scriptIds) {
      const settings = await this.api<Record<string, unknown>>(`${accountRoot}/workers/scripts/${encodeURIComponent(id)}/settings`);
      const subdomain = await this.api<Record<string, unknown>>(`${accountRoot}/workers/scripts/${encodeURIComponent(id)}/subdomain`);
      statusCodes.push(settings.statusCode, subdomain.statusCode);
      fail(isObject(settings.result) && "bindings" in settings.result && hasOnlyKeys(settings.result, WORKER_SETTINGS_KEYS), "H2_RETENTION_PRIVACY_SCHEMA", "Workers script settings do not match the pinned v4 schema");
      fail(isObject(subdomain.result) && typeof subdomain.result.enabled === "boolean" && (subdomain.result.previews_enabled === undefined || typeof subdomain.result.previews_enabled === "boolean") && hasOnlyKeys(subdomain.result, ["enabled", "previews_enabled"]), "H2_RETENTION_PRIVACY_SCHEMA", "per-script Workers subdomain response does not match the pinned v4 schema");
      workersDevEnabled ||= subdomain.result.enabled as boolean;
      inventory.push(canonInventory(["worker_settings", id, settings.result]), canonInventory(["worker_subdomain", id, subdomain.result]));
      inspectBindings(settings.result.bindings, `worker_script:${id}`);
    }
    for (const project of pagesProjects.result) {
      fail(isObject(project) && typeof project.name === "string" && isObject(project.deployment_configs), "H2_RETENTION_PRIVACY_SCHEMA", "Pages project does not match the pinned v4 schema");
      for (const environment of ["production", "preview"] as const) {
        const config = project.deployment_configs[environment];
        fail(isObject(config), "H2_RETENTION_PRIVACY_SCHEMA", `Pages ${environment} deployment config is missing`);
        const r2Buckets = config.r2_buckets ?? {};
        fail(isObject(r2Buckets), "H2_RETENTION_PRIVACY_SCHEMA", `Pages ${environment} r2_buckets must be an object`);
        for (const value of Object.values(r2Buckets)) {
          fail(isObject(value) && typeof value.name === "string" && hasOnlyKeys(value, ["name", "jurisdiction"]), "H2_RETENTION_PRIVACY_SCHEMA", "Pages R2 binding does not match the pinned v4 schema");
          bindingCount += 1;
          if (value.name === this.bucket) bucketBound = true;
          inventory.push(canonInventory(["pages_binding", project.name, environment, value]));
        }
      }
    }
    let routeCount = 0;
    for (const zone of zones.result) {
      const routes = await this.singlePage<Record<string, unknown>>(`/zones/${encodeURIComponent(zone.id as string)}/workers/routes`);
      statusCodes.push(...routes.statusCodes);
      const routeIds = identities(routes.result, "id", `zone ${zone.id} route`);
      for (const route of routes.result)
        fail(isObject(route) && typeof route.id === "string" && typeof route.pattern === "string" && (typeof route.script === "string" || route.script === undefined), "H2_RETENTION_PRIVACY_SCHEMA", "zone Worker route does not match the pinned v4 schema");
      inventory.push(...routes.result.map((route, index) => canonInventory(["zone_route", zone.id, routeIds[index], route.pattern, route.script ?? null])));
      routeCount += routes.result.length;
    }
    fail(!bucketBound, "H2_RETENTION_WORKER_EXPOSURE", "a Worker has an R2 binding to the dedicated private bucket");
    return {
      checkedAt: this.clock(),
      enabledCustomDomains,
      managedDomainEnabled: false,
      statusCodeDigest: sha256(JSON.stringify(statusCodes)),
      requestCount: statusCodes.length,
      scriptCount: scripts.result.length,
      dispatchNamespaceCount: dispatchNamespaces.result.length,
      dispatchScriptCount: 0,
      pagesProjectCount: pagesProjects.result.length,
      bindingCount,
      workersDevEnabled,
      customWorkerDomainCount: workerDomains.result.length,
      zoneCount: zones.result.length,
      routeCount,
      inventoryDigest: sha256(JSON.stringify({ schema: "cloudflare-v4-endpoint-contracts-2026-07-15", counts: [scripts.result.length, dispatchNamespaces.result.length, 0, pagesProjects.result.length, bindingCount, workerDomains.result.length, zones.result.length, routeCount], inventory: [...new Set(inventory)].sort(), statusCodeDigest: sha256(JSON.stringify(statusCodes)) })),
      noR2BucketBinding: true,
      noDirectPublicDomain: true,
    };
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
      (put.status === "new_write" && put.statusCode >= 200 && put.statusCode < 300) ||
        (put.status === "preexisting_verified" && (put.statusCode === 409 || put.statusCode === 412)),
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
      object_key_commitment: sha256(`gate-h2-public-object-key-commitment-v3\0${key}`),
      version_id: head.versionId,
      etag: head.etag,
      sha256: digest,
      bytes: input.bytes.length,
      operations: {
        put: { status: put.status, status_code: put.statusCode, attempted_at: put.attemptedAt, completed_at: put.completedAt },
        ...(put.status === "preexisting_verified" ? {
          recovery_head: { status: "preexisting_identity_observed", status_code: put.recoveryHead!.statusCode, at: put.recoveryHead!.at },
          recovery_get: { status: "preexisting_exact_bytes_verified", status_code: put.recoveryGet!.statusCode, at: put.recoveryGet!.at },
        } : {}),
        head: { status: "verified", status_code: head.statusCode, at: head.at },
        get: { status: "exact_version_bytes_verified", status_code: get.statusCode, at: get.at },
        stable_head: { status: "verified", status_code: stableHead.statusCode, at: stableHead.at },
      },
      ...(put.status === "new_write" ? { written_at: put.completedAt } : { observed_existing_at: put.observedExistingAt }),
      readback_at: get.at,
      no_public_acl: true,
      readback_verified: true,
    });
  }
  const postflight = await store.verifyPrivate();
  const stablePrivacy = (value: StoragePrivacyEvidence) => ({ ...value, checkedAt: undefined });
  fail(canonicalInventoryValue(stablePrivacy(preflight)) === canonicalInventoryValue(stablePrivacy(postflight)), "H2_RETENTION_PRIVACY_DRIFT", "Cloudflare exposure inventory changed between preflight and postflight");
  const privacyEvidence = (value: StoragePrivacyEvidence) => ({
    checked_at: value.checkedAt,
    enabled_custom_domains: value.enabledCustomDomains,
    managed_domain_enabled: value.managedDomainEnabled,
    status_code_digest: value.statusCodeDigest,
    request_count: value.requestCount,
    script_count: value.scriptCount,
    dispatch_namespace_count: value.dispatchNamespaceCount,
    dispatch_script_count: value.dispatchScriptCount,
    pages_project_count: value.pagesProjectCount,
    binding_count: value.bindingCount,
    workers_dev_enabled: value.workersDevEnabled,
    custom_worker_domain_count: value.customWorkerDomainCount,
    zone_count: value.zoneCount,
    route_count: value.routeCount,
    inventory_digest: value.inventoryDigest,
    no_r2_bucket_binding: value.noR2BucketBinding,
    no_direct_public_domain: value.noDirectPublicDomain,
  });
  return { privacy: { preflight: privacyEvidence(preflight), postflight: privacyEvidence(postflight) }, objects };
}

export type AwsCertificate = { regions: string[]; pem: string; certificate_sha256: string };

export type TrustedExecutableName = "openssl" | "curl" | "git" | "ioreg" | "sw_vers" | "uname";
const TRUSTED_EXECUTABLES: Record<NodeJS.Platform, Partial<Record<TrustedExecutableName, string>>> = {
  darwin: { openssl: "/usr/bin/openssl", curl: "/usr/bin/curl", git: "/usr/bin/git", ioreg: "/usr/sbin/ioreg", sw_vers: "/usr/bin/sw_vers", uname: "/usr/bin/uname" },
  linux: { openssl: "/usr/bin/openssl", curl: "/usr/bin/curl", git: "/usr/bin/git", uname: "/usr/bin/uname" },
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
  type MockOptions = {
    apiDrift?: boolean;
    advancingClock?: boolean;
    bindingSurface?: "worker" | "pages";
    dispatchNamespace?: boolean;
    incompletePagination?: boolean;
    identityDriftSurface?: "worker" | "pages" | "domain" | "zone" | "route";
    metadataMismatch?: boolean;
    identityRace?: boolean;
    permissionError?: boolean;
    postflightExposure?: boolean;
    preexisting?: boolean;
  };
  const makeStore = (options: MockOptions = {}) => {
    const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string>; etag: string; version: string }>();
    const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const input = command.input as { Key: string; Body?: Buffer; Metadata?: Record<string, string>; IfMatch?: string; VersionId?: string };
      if (command.constructor.name === "PutObjectCommand") {
        if (options.preexisting && objects.has(input.Key)) {
          const error = new Error("precondition failed") as Error & { $metadata: { httpStatusCode: number } };
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
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
      if (options.permissionError) return new Response(JSON.stringify({ success: false, result: null, errors: [{ code: 10000 }] }), { status: 403 });
      let result: unknown;
      if (pathname.endsWith("/domains/custom")) { customChecks += 1; result = { domains: options.postflightExposure && customChecks === 2 ? [{ enabled: true }] : [] }; }
      else if (pathname.endsWith("/domains/managed")) result = { enabled: false };
      else if (/\/workers\/scripts\/[^/]+\/subdomain$/.test(pathname)) result = options.apiDrift ? { enabled: "false" } : { enabled: false, previews_enabled: false };
      else if (/\/workers\/scripts\/[^/]+\/settings$/.test(pathname)) result = { bindings: options.bindingSurface === "worker" ? [{ type: "r2_bucket", name: "PRIVATE", bucket_name: "dedicated-private" }] : [], annotations: { owner: "fixture" }, tags: ["fixture"] };
      else if (pathname.endsWith("/workers/scripts")) result = [{ id: options.identityDriftSurface === "worker" && customChecks === 2 ? "opaque-script-replaced" : "opaque-script" }];
      else if (pathname.endsWith("/workers/dispatch/namespaces")) result = options.dispatchNamespace ? [{ namespace: "opaque-namespace", script_count: 1 }] : [];
      else if (pathname.endsWith("/pages/projects")) result = [{ name: options.identityDriftSurface === "pages" && customChecks === 2 ? "opaque-pages-project-replaced" : "opaque-pages-project", deployment_configs: { production: { r2_buckets: options.bindingSurface === "pages" ? { PRIVATE: { name: "dedicated-private" } } : {} }, preview: { r2_buckets: {} } } }];
      else if (pathname.endsWith("/workers/domains")) result = [{ id: options.identityDriftSurface === "domain" && customChecks === 2 ? "domain-replaced" : "domain", hostname: options.identityDriftSurface === "domain" && customChecks === 2 ? "replaced.example.invalid" : "fixture.example.invalid", service: "opaque-script" }];
      else if (pathname === "/client/v4/zones") result = [{ id: options.identityDriftSurface === "zone" && customChecks === 2 ? "opaque-zone-replaced" : "opaque-zone" }];
      else if (/\/zones\/[^/]+\/workers\/routes$/.test(pathname)) result = [{ id: options.identityDriftSurface === "route" && customChecks === 2 ? "route-replaced" : "route", pattern: options.identityDriftSurface === "route" && customChecks === 2 ? "replaced.example.invalid/*" : "fixture.example.invalid/*", script: "opaque-script" }];
      else return new Response("not found", { status: 404 });
      const paginated = url.searchParams.has("page");
      const count = paginated ? (result as unknown[]).length : 0;
      return new Response(JSON.stringify({ success: true, result, ...(paginated ? { result_info: { page: 1, total_pages: options.incompletePagination ? 2 : 1, count, total_count: count } } : {}) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    let tick = 0;
    const clock = options.advancingClock
      ? () => new Date(Date.parse("2026-07-15T00:00:00.000Z") + tick++ * 10).toISOString()
      : now;
    return new CloudflareR2PrivateStore(account, "dedicated-private", "api-token", endpoint, "access-key", "secret-key", "capability", hmacKey, bucketIdentity, request, client, clock);
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
  fail(noExposure.objects.length === 2 && noExposure.privacy.postflight.no_r2_bucket_binding === true, "H2_SECURITY_TEST_PRIVATE", "no-exposure mock did not complete");
  const publicReceipt = JSON.stringify(noExposure);
  const privateKeys = inputs.map((input) => makeStore().objectKey(sha256(input.bytes)));
  fail(privateKeys.every((key) => !publicReceipt.includes(key) && !publicReceipt.includes(path.posix.basename(key)) && !publicReceipt.includes(key.slice(0, -8))), "H2_SECURITY_TEST_OBJECT_KEY", "public retention evidence leaks a reconstructable private object key");
  const plainKeyStore = makeStore();
  plainKeyStore.objectKey = (contentSha256: string) => `gate-h2/private/sha256/${contentSha256}`;
  await reject("plain-reconstructable-key", "H2_RETENTION_OBJECT_KEY", () => retainPrivateObjects(plainKeyStore, inputs));
  await reject("ifmatch-version-race", "H2_RETENTION_OBJECT_IDENTITY", () => retainPrivateObjects(makeStore({ identityRace: true }), inputs));
  await reject("custom-metadata-mismatch", "H2_RETENTION_METADATA", () => retainPrivateObjects(makeStore({ metadataMismatch: true }), inputs));
  await reject("worker-r2-binding", "H2_RETENTION_WORKER_EXPOSURE", () => retainPrivateObjects(makeStore({ bindingSurface: "worker" }), inputs));
  await reject("dispatch-inventory-unavailable", "H2_RETENTION_DISPATCH_INVENTORY", () => retainPrivateObjects(makeStore({ dispatchNamespace: true }), inputs));
  await reject("pages-r2-binding", "H2_RETENTION_WORKER_EXPOSURE", () => retainPrivateObjects(makeStore({ bindingSurface: "pages" }), inputs));
  await reject("incomplete-worker-enumeration", "H2_RETENTION_PRIVACY_ENUMERATION", () => retainPrivateObjects(makeStore({ incompletePagination: true }), inputs));
  await reject("cloudflare-api-drift", "H2_RETENTION_PRIVACY_SCHEMA", () => retainPrivateObjects(makeStore({ apiDrift: true }), inputs));
  await reject("cloudflare-permission-error", "H2_RETENTION_PRIVACY_PROOF", () => retainPrivateObjects(makeStore({ permissionError: true }), inputs));
  await reject("postflight-public-change", "H2_RETENTION_PUBLIC_EXPOSURE", () => retainPrivateObjects(makeStore({ postflightExposure: true }), inputs));
  for (const surface of ["worker", "pages", "domain", "zone", "route"] as const)
    await reject(`same-count-${surface}-identity-drift`, "H2_RETENTION_PRIVACY_DRIFT", () => retainPrivateObjects(makeStore({ identityDriftSurface: surface }), inputs));
  const preexistingStore = makeStore({ preexisting: true, advancingClock: true });
  await retainPrivateObjects(preexistingStore, inputs);
  const preexisting = await retainPrivateObjects(preexistingStore, inputs);
  for (const object of preexisting.objects as Array<Record<string, unknown>>) {
    const operations = object.operations as Record<string, Record<string, unknown>>;
    fail(!("written_at" in object) && typeof object.observed_existing_at === "string", "H2_SECURITY_TEST_PREEXISTING_CHRONOLOGY", "preexisting object must record observation, not a fictitious write");
    fail(Date.parse(String(operations.put.attempted_at)) < Date.parse(String(operations.put.completed_at)) && Date.parse(String(operations.put.completed_at)) < Date.parse(String(operations.recovery_head.at)) && Date.parse(String(operations.recovery_head.at)) < Date.parse(String(operations.recovery_get.at)) && Date.parse(String(operations.recovery_get.at)) <= Date.parse(String(object.observed_existing_at)), "H2_SECURITY_TEST_PREEXISTING_CHRONOLOGY", "preexisting conditional PUT and recovery chronology is not exact");
  }
  const oldPath = process.env.PATH;
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), "gate-h2-path-shadow-"));
  try {
    fs.writeFileSync(path.join(shadow, "openssl"), "#!/bin/sh\nexit 0\n", { mode: 0o777 });
    fs.writeFileSync(path.join(shadow, "git"), "#!/bin/sh\nprintf forged\n", { mode: 0o777 });
    process.env.PATH = `${shadow}:${oldPath ?? ""}`;
    fail(trustedExecutable("openssl") === "/usr/bin/openssl", "H2_SECURITY_TEST_PATH_SHADOW", "PATH shadow changed trusted executable resolution");
    fail(trustedExecutable("git") === "/usr/bin/git", "H2_SECURITY_TEST_PATH_SHADOW", "PATH shadow changed trusted git resolution");
    await reject("writable-executable", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("openssl", path.join(shadow, "openssl")));
    await reject("writable-git", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("git", path.join(shadow, "git")));
    const alias = path.join(shadow, "openssl-alias");
    fs.symlinkSync("/usr/bin/openssl", alias);
    await reject("replaced-executable-alias", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("openssl", alias));
    const gitAlias = path.join(shadow, "git-alias");
    fs.symlinkSync("/usr/bin/git", gitAlias);
    await reject("replaced-git-alias", "H2_TRUSTED_EXECUTABLE", () => verifyTrustedExecutable("git", gitAlias));
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
