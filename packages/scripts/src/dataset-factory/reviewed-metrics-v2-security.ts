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
};

export type StoragePrivacyEvidence = {
  checkedAt: string;
  customDomainsStatusCode: number;
  managedDomainStatusCode: number;
  enabledCustomDomains: number;
  managedDomainEnabled: boolean;
};

export interface PrivateObjectStore {
  putIfAbsent(key: string, bytes: Buffer): Promise<StorageWriteEvidence>;
  head(key: string): Promise<StorageHeadEvidence>;
  get(key: string): Promise<{ statusCode: number; at: string; bytes: Buffer }>;
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

type CloudflareEnvelope<T> = { success: boolean; result: T; errors?: Array<{ code?: number; message?: string }> };

export class CloudflareR2PrivateStore implements PrivateObjectStore {
  readonly bucketDigest: string;
  readonly capabilityId: string;
  private readonly client: S3Client;

  constructor(
    private readonly accountId: string,
    private readonly bucket: string,
    private readonly apiToken: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
    capability: string,
    private readonly request: typeof fetch = fetch,
  ) {
    fail(/^https:\/\/[a-z0-9]+\.r2\.cloudflarestorage\.com\/?$/.test(endpoint), "H2_RETENTION_ENDPOINT", "R2 endpoint must be the account-scoped Cloudflare HTTPS endpoint");
    fail(accountId.length > 0 && bucket.length > 0 && apiToken.length > 0 && accessKeyId.length > 0 && secretAccessKey.length > 0 && capability.length > 0, "H2_RETENTION_CAPABILITY", "R2 capability environment is incomplete");
    this.bucketDigest = sha256(`gate-h2-r2-bucket-v2\n${accountId}\n${bucket}`);
    this.capabilityId = sha256(`gate-h2-r2-capability-v2\n${capability}`);
    this.client = new S3Client({
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
    );
  }

  async putIfAbsent(key: string, bytes: Buffer): Promise<StorageWriteEvidence> {
    try {
      const response = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentLength: bytes.length,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Metadata: { "gate-h2-sha256": sha256(bytes) },
      }));
      return { status: "created", statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), etag: etag(response.ETag), versionId: response.VersionId ?? null };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw new GateH2SecurityError("H2_RETENTION_PUT", "conditional R2 PUT failed");
      const existing = await this.get(key);
      fail(existing.bytes.equals(bytes), "H2_RETENTION_PREEXISTING_DIFFERENT", "content-addressed key already contains different bytes");
      const head = await this.head(key);
      return { status: "preexisting_identical", statusCode: status, at: now(), etag: head.etag, versionId: head.versionId };
    }
  }

  async head(key: string): Promise<StorageHeadEvidence> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), etag: etag(response.ETag), versionId: response.VersionId ?? null, bytes: response.ContentLength ?? -1 };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_HEAD", "R2 HEAD failed");
    }
  }

  async get(key: string): Promise<{ statusCode: number; at: string; bytes: Buffer }> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { statusCode: response.$metadata.httpStatusCode ?? 0, at: now(), bytes: await bodyBytes(response.Body) };
    } catch (error) {
      if (error instanceof GateH2SecurityError) throw error;
      throw new GateH2SecurityError("H2_RETENTION_READBACK", "R2 GET failed");
    }
  }

  private async api<T>(suffix: string): Promise<{ statusCode: number; result: T }> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/r2/buckets/${encodeURIComponent(this.bucket)}${suffix}`;
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
    return { statusCode: response.status, result: payload.result };
  }

  async verifyPrivate(): Promise<StoragePrivacyEvidence> {
    const custom = await this.api<{ domains: Array<{ enabled: boolean }> }>("/domains/custom");
    const managed = await this.api<{ enabled: boolean }>("/domains/managed");
    fail(Array.isArray(custom.result.domains) && custom.result.domains.every((domain) => typeof domain.enabled === "boolean") && typeof managed.result.enabled === "boolean", "H2_RETENTION_PRIVACY_PROOF", "Cloudflare privacy API response shape is incomplete");
    const enabledCustomDomains = custom.result.domains.filter((domain) => domain.enabled).length;
    fail(enabledCustomDomains === 0 && managed.result.enabled === false, "H2_RETENTION_PUBLIC_EXPOSURE", "R2 bucket has enabled custom-domain or r2.dev public exposure");
    return { checkedAt: now(), customDomainsStatusCode: custom.statusCode, managedDomainStatusCode: managed.statusCode, enabledCustomDomains, managedDomainEnabled: false };
  }
}

export function retentionObjectKey(sha: string): string {
  fail(/^[a-f0-9]{64}$/.test(sha), "H2_RETENTION_OBJECT_KEY", "private object digest is invalid");
  return `gate-h2/private/sha256/${sha}`;
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
    const key = retentionObjectKey(digest);
    const put = await store.putIfAbsent(key, input.bytes);
    fail(
      (put.status === "created" && put.statusCode >= 200 && put.statusCode < 300) ||
        (put.status === "preexisting_identical" && (put.statusCode === 409 || put.statusCode === 412)),
      "H2_RETENTION_PUT",
      "conditional R2 PUT did not return an allowed status",
    );
    const head = await store.head(key);
    fail(head.statusCode >= 200 && head.statusCode < 300 && head.bytes === input.bytes.length, "H2_RETENTION_HEAD", "R2 HEAD did not verify exact object length");
    fail(head.etag === put.etag && (head.versionId === put.versionId || put.versionId === null), "H2_RETENTION_OBJECT_IDENTITY", "R2 PUT and HEAD object identity differ");
    const get = await store.get(key);
    fail(get.statusCode >= 200 && get.statusCode < 300 && get.bytes.equals(input.bytes), "H2_RETENTION_READBACK", "R2 GET bytes differ from sealed private bytes");
    objects.push({
      artifact_role: input.artifactRole,
      object_key_sha256: sha256(`gate-h2-r2-object-key-v2\n${key}`),
      version_id: head.versionId,
      etag: head.etag,
      sha256: digest,
      bytes: input.bytes.length,
      operations: {
        put: { status: put.status, status_code: put.statusCode, at: put.at },
        head: { status: "verified", status_code: head.statusCode, at: head.at },
        get: { status: "exact_bytes_verified", status_code: get.statusCode, at: get.at },
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
  });
  return { privacy: { preflight: privacyEvidence(preflight), postflight: privacyEvidence(postflight) }, objects };
}

export type AwsCertificate = { regions: string[]; pem: string; certificate_sha256: string };

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
      execFileSync("openssl", ["smime", "-verify", "-binary", "-nointern", "-in", signature, "-inform", "PEM", "-certfile", cert, "-noverify", "-out", verified], { stdio: ["ignore", "ignore", "pipe"] });
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
