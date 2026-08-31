import { createHash } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseAndValidateInputLock, verifyAcquiredDirectory } from "./verify-external-input-lock.mjs";
import { syncDirectory } from "./secure-files.mjs";
import { parseStrictJson } from "./strict-json.mjs";
import {
  assertRetainedCapability,
  cleanupDirectories,
  cleanupFiles,
  closeRetainedCapability,
  closeRetainedHandle,
  openOrCreateChildDirectory,
  openOrCreateDestination,
  removeDirectoryIfIdentity,
  writeImmutableAt,
} from "./packet-3c-retained-files.mjs";

const MAX_TIMEOUT_MS = 30_000;
const MAX_AUTHENTICATE_BYTES = 4 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 3600;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const ambientNetworkKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE", "NETRC", "DOCKER_CONFIG", "REGISTRY_AUTH_FILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"];

function clearAmbientNetworkEnvironment() {
  for (const key of ambientNetworkKeys) delete process.env[key];
  process.env.NO_PROXY = "*";
}

function header(response, name) {
  if (response.headers instanceof Map) return response.headers.get(name) ?? response.headers.get(name.toLowerCase()) ?? null;
  if (response.headers?.get) return response.headers.get(name) ?? response.headers.get(name.toLowerCase()) ?? null;
  return response.headers?.[name] ?? response.headers?.[name.toLowerCase()] ?? null;
}

export function productionTransport({ url, headers, signal }) {
  return fetch(url, { method: "GET", headers, redirect: "error", credentials: "omit", cache: "no-store", signal });
}

function parseOciLocator(locator, authority) {
  const prefix = `oci://${authority}/`;
  if (!locator.startsWith(prefix)) fail("E_ACQUIRE_OCI_LOCATOR", "OCI locator authority differs from the lock");
  const rest = locator.slice(prefix.length), marker = rest.lastIndexOf("@sha256:");
  if (marker <= 0 || !/^[a-f0-9]{64}$/.test(rest.slice(marker + 8))) fail("E_ACQUIRE_OCI_LOCATOR", "OCI locator is not a safe digest-pinned repository locator");
  const repository = rest.slice(0, marker);
  if (repository.split("/").some((part) => !part || part === "." || part === "..")) fail("E_ACQUIRE_OCI_LOCATOR", "OCI repository path is unsafe");
  return { repository, digest: rest.slice(marker + 8) };
}

function expectedOciService(authority) {
  if (authority === "docker.io" || authority === "registry-1.docker.io") return "registry.docker.io";
  return authority;
}

function approvedTokenRealm(authority, realm) {
  const hostname = new URL(realm).hostname;
  if (hostname === authority) return true;
  return (authority === "docker.io" || authority === "registry-1.docker.io") && hostname === "auth.docker.io";
}

function parseBearerChallenge(value, artifact, repository) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_AUTHENTICATE_BYTES || !/^Bearer[ ]+/.test(value) || value.includes(",Bearer")) fail("E_ACQUIRE_CHALLENGE", `OCI challenge is not a single strict Bearer challenge for ${artifact.member_path}`);
  const params = value.slice(7).split(","), parsed = new Map();
  if (params.length !== 3) fail("E_ACQUIRE_CHALLENGE", `OCI challenge parameter count is invalid for ${artifact.member_path}`);
  for (const item of params) {
    const match = /^([a-z]+)="([^"\\]*)"$/.exec(item.trim());
    if (!match || parsed.has(match[1])) fail("E_ACQUIRE_CHALLENGE", `OCI challenge parameter is malformed for ${artifact.member_path}`);
    parsed.set(match[1], match[2]);
  }
  if (parsed.size !== 3 || !parsed.has("realm") || !parsed.has("service") || !parsed.has("scope")) fail("E_ACQUIRE_CHALLENGE", `OCI challenge fields are incomplete for ${artifact.member_path}`);
  let realm;
  try { realm = new URL(parsed.get("realm")); } catch { fail("E_ACQUIRE_CHALLENGE", `OCI challenge realm is invalid for ${artifact.member_path}`); }
  if (realm.protocol !== "https:" || realm.username || realm.password || realm.port || realm.hash || realm.search || !approvedTokenRealm(artifact.source.authority, realm.toString())) fail("E_ACQUIRE_CHALLENGE", `OCI challenge realm is not an approved HTTPS authority for ${artifact.member_path}`);
  const expectedScope = `repository:${repository}:pull`;
  if (parsed.get("service") !== expectedOciService(artifact.source.authority) || parsed.get("scope") !== expectedScope) fail("E_ACQUIRE_CHALLENGE", `OCI challenge service or scope differs from the lock for ${artifact.member_path}`);
  return { realm: realm.toString(), service: parsed.get("service"), scope: expectedScope };
}

function ociRequest(artifact) {
  const { repository, digest: locatorDigest } = parseOciLocator(artifact.source.locator, artifact.source.authority);
  if (locatorDigest !== artifact.sha256) fail("E_ACQUIRE_OCI_LOCATOR", `OCI locator digest does not equal ${artifact.member_path}`);
  const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
  const digestReference = `sha256:${artifact.sha256}`;
  const metadata = artifact.category === "oci_manifest";
  const path = metadata ? `/v2/${encodedRepository}/manifests/${digestReference}` : `/v2/${encodedRepository}/blobs/${digestReference}`;
  return { url: `https://${artifact.source.authority}${path}`, headers: { Accept: artifact.media_type, "Accept-Encoding": "identity" } };
}

async function boundedBody(response, maximum, label) {
  const contentLength = header(response, "content-length");
  if (contentLength !== null && (!/^0$|^[1-9][0-9]*$/.test(String(contentLength)) || Number(contentLength) > maximum)) fail("E_ACQUIRE_SIZE", `response content-length exceeds the bound for ${label}`);
  const contentEncoding = header(response, "content-encoding");
  if (contentEncoding !== null && String(contentEncoding).toLowerCase() !== "identity") fail("E_ACQUIRE_ENCODING", `response content encoding is not identity for ${label}`);
  const chunks = [], hash = createHash("sha256"); let received = 0; const add = (value) => { const chunk = Buffer.from(value); received += chunk.length; if (received > maximum) fail("E_ACQUIRE_SIZE", `response exceeds the bound for ${label}`); hash.update(chunk); chunks.push(chunk); };
  const body = response.body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) add(body);
  else if (body?.getReader) {
    const reader = body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        add(item.value);
      }
    } finally { reader.releaseLock(); }
  } else if (typeof response.arrayBuffer === "function") add(await response.arrayBuffer());
  else fail("E_ACQUIRE_TRANSPORT", "transport did not provide a readable response body");
  return { bytes: Buffer.concat(chunks), received, sha256: hash.digest("hex") };
}

function validateArtifactResponse(response, artifact) {
  if (REDIRECT_STATUS.has(response.status)) fail("E_ACQUIRE_REDIRECT", `redirect refused for ${artifact.member_path}`);
  if (response.status === 401 || response.status === 403) fail("E_ACQUIRE_AUTH", `authenticated registry/source is unsupported for ${artifact.member_path}`);
  if (response.status !== 200) fail("E_ACQUIRE_HTTP", `source returned HTTP ${response.status} for ${artifact.member_path}`);
  const contentLength = header(response, "content-length");
  if (contentLength !== null && (!/^0$|^[1-9][0-9]*$/.test(String(contentLength)) || Number(contentLength) !== artifact.bytes)) fail("E_ACQUIRE_SIZE", `response content-length differs for ${artifact.member_path}`);
  const contentEncoding = header(response, "content-encoding");
  if (contentEncoding !== null && String(contentEncoding).toLowerCase() !== "identity") fail("E_ACQUIRE_ENCODING", `response content encoding is not identity for ${artifact.member_path}`);
}

async function* artifactChunks(response, artifact) {
  validateArtifactResponse(response, artifact);
  const body = response.body;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) { yield body; return; }
  if (!body?.getReader) fail("E_ACQUIRE_TRANSPORT", "artifact transport must expose a byte stream; arrayBuffer fallback is forbidden");
  const reader = body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (!Buffer.isBuffer(item.value) && !(item.value instanceof Uint8Array)) fail("E_ACQUIRE_TRANSPORT", "artifact stream produced a non-byte chunk");
      yield item.value;
    }
  } finally { reader.releaseLock(); }
}

function tokenFromResponse(bytes, artifact) {
  if (bytes.length > MAX_TOKEN_RESPONSE_BYTES) fail("E_ACQUIRE_TOKEN", `OCI token response exceeds the bound for ${artifact.member_path}`);
  let value;
  try { value = parseStrictJson(bytes); } catch { fail("E_ACQUIRE_TOKEN", `OCI token response is not strict JSON for ${artifact.member_path}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("E_ACQUIRE_TOKEN", `OCI token response is not an object for ${artifact.member_path}`);
  const keys = Object.keys(value), tokenKeys = keys.filter((key) => key === "token" || key === "access_token");
  if (tokenKeys.length !== 1 || keys.some((key) => !["token", "access_token", "expires_in", "issued_at"].includes(key))) fail("E_ACQUIRE_TOKEN", `OCI token response fields are not strict for ${artifact.member_path}`);
  if (typeof value[tokenKeys[0]] !== "string" || Buffer.byteLength(value[tokenKeys[0]], "utf8") < 1 || Buffer.byteLength(value[tokenKeys[0]], "utf8") > MAX_TOKEN_BYTES || !/^[\x21-\x7e]+$/.test(value[tokenKeys[0]])) fail("E_ACQUIRE_TOKEN", `OCI token value is invalid for ${artifact.member_path}`);
  if (value.expires_in !== undefined && (!Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > MAX_TOKEN_LIFETIME_SECONDS)) fail("E_ACQUIRE_TOKEN", `OCI token expiry is outside the bound for ${artifact.member_path}`);
  if (value.issued_at !== undefined && (typeof value.issued_at !== "string" || !Number.isFinite(Date.parse(value.issued_at)))) fail("E_ACQUIRE_TOKEN", `OCI token issue time is invalid for ${artifact.member_path}`);
  return value[tokenKeys[0]];
}

async function fetchAnonymousToken(challenge, artifact, transport, controller) {
  const tokenUrl = new URL(challenge.realm);
  tokenUrl.searchParams.set("service", challenge.service); tokenUrl.searchParams.set("scope", challenge.scope);
  if (Buffer.byteLength(tokenUrl.toString(), "utf8") > 2048) fail("E_ACQUIRE_TOKEN", `OCI token URL exceeds the bound for ${artifact.member_path}`);
  let response;
  try { response = await transport({ url: tokenUrl.toString(), headers: { Accept: "application/json", "Accept-Encoding": "identity" }, signal: controller.signal, timeoutMs: MAX_TIMEOUT_MS }); }
  catch (error) { if (error.name === "AbortError") fail("E_ACQUIRE_TIMEOUT", `OCI token request timed out for ${artifact.member_path}`); throw error; }
  if (REDIRECT_STATUS.has(response.status)) fail("E_ACQUIRE_REDIRECT", `OCI token redirect refused for ${artifact.member_path}`);
  if (response.status !== 200) fail(response.status === 401 || response.status === 403 ? "E_ACQUIRE_AUTH" : "E_ACQUIRE_TOKEN", `OCI token request failed for ${artifact.member_path}`);
  return tokenFromResponse((await boundedBody(response, MAX_TOKEN_RESPONSE_BYTES, `OCI token for ${artifact.member_path}`)).bytes, artifact);
}

async function fetchArtifact(artifact, transport) {
  const request = artifact.source.kind === "https" ? { url: artifact.source.locator, headers: { Accept: artifact.media_type, "Accept-Encoding": "identity" } } : ociRequest(artifact);
  if (!request.url.startsWith("https://")) fail("E_ACQUIRE_TLS", `only HTTPS transport is supported for ${artifact.member_path}`);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
  try {
    let response;
    try { response = await transport({ ...request, signal: controller.signal, timeoutMs: MAX_TIMEOUT_MS }); }
    catch (error) { if (error.name === "AbortError") fail("E_ACQUIRE_TIMEOUT", `source timed out for ${artifact.member_path}`); throw error; }
    if (artifact.source.kind === "oci" && response.status === 401) {
      const { repository } = parseOciLocator(artifact.source.locator, artifact.source.authority), challenge = parseBearerChallenge(header(response, "www-authenticate"), artifact, repository), token = await fetchAnonymousToken(challenge, artifact, transport, controller);
      try { response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${token}` }, signal: controller.signal, timeoutMs: MAX_TIMEOUT_MS }); }
      catch (error) { if (error.name === "AbortError") fail("E_ACQUIRE_TIMEOUT", `source timed out for ${artifact.member_path}`); throw error; }
      if (response.status === 401) fail("E_ACQUIRE_AUTH", `OCI anonymous Bearer retry was rejected for ${artifact.member_path}`);
    }
    validateArtifactResponse(response, artifact);
    return { response, finish() { clearTimeout(timeout); controller.abort(); } };
  } catch (error) { clearTimeout(timeout); controller.abort(); throw error; }
}

function ensureDirectory(path, mode) {
  let created = false;
  try { mkdirSync(path, { mode }); created = true; } catch (error) { if (error.code !== "EEXIST") throw error; }
  try {
    if (created) chmodSync(path, mode);
    const metadata = lstatSync(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== BigInt(process.geteuid()) || Number(metadata.mode & 0o7777n) !== mode) fail("E_ACQUIRE_DESTINATION", `destination directory is not owned and exact ${mode.toString(8)}: ${path}`);
    chmodSync(path, mode);
  } catch (error) {
    if (created) { try { rmdirSync(path); syncDirectory(dirname(path)); } catch (cleanupError) { error.cleanupErrors = [cleanupError]; } }
    throw error;
  }
  return created;
}

async function writePortableImmutable(path, chunks, artifact) {
  const temp = `${path}.partial-${process.pid}-${Math.random().toString(16).slice(2)}`, fd = openSync(temp, "wx", 0o600);
  let closed = false, received = 0; const hash = createHash("sha256");
  try {
    for await (const value of chunks) {
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (received + bytes.length > artifact.bytes) fail("E_ACQUIRE_SIZE", `response exceeds the bound for ${artifact.member_path}`);
      let offset = 0;
      while (offset < bytes.length) { const count = writeSync(fd, bytes, offset, bytes.length - offset, received + offset); if (count <= 0) throw new Error("short acquisition write"); offset += count; }
      hash.update(bytes); received += bytes.length;
    }
    if (received !== artifact.bytes) fail("E_ACQUIRE_SIZE", `response is truncated for ${artifact.member_path}`);
    if (hash.digest("hex") !== artifact.sha256) fail("E_ACQUIRE_HASH", `response digest differs for ${artifact.member_path}`);
    fsyncSync(fd); chmodSync(temp, 0o444); fsyncSync(fd); closeSync(fd); closed = true;
    linkSyncNoReplace(temp, path); unlinkSync(temp); syncDirectory(dirname(path));
  } finally { if (!closed) closeSync(fd); try { unlinkSync(temp); } catch {} }
}

function closeAcquisitionCapabilities(cache, destination) {
  const handles = [...new Set([...cache.values()])].filter((handle) => handle !== destination);
  for (const handle of handles.reverse()) { try { closeRetainedHandle(handle); } catch {} }
  closeRetainedCapability(destination);
}

function acquisitionWriteError(error, artifact) {
  if (error.code === "E_PACKET3C_SIZE") fail("E_ACQUIRE_SIZE", `response size differs for ${artifact.member_path}`, error);
  if (error.code === "E_PACKET3C_HASH") fail("E_ACQUIRE_HASH", `response digest differs for ${artifact.member_path}`, error);
  throw error;
}

async function acquireLinux(parsed, destination, transport, trustedContext, { fault, observe } = {}) {
  const state = openOrCreateDestination(destination, 0o755, { label: "acquisition destination", fault, observe });
  const directories = new Map([["", state.directory]]), createdDirectories = [], createdFiles = [];
  const directoryFor = (relativePath) => {
    if (directories.has(relativePath)) return directories.get(relativePath);
    const parts = relativePath.split("/"), name = parts.pop(), parentPath = parts.join("/"), parent = directoryFor(parentPath);
    const child = openOrCreateChildDirectory(parent, name, 0o755, { created: createdDirectories, fault, observe, label: `acquired directory ${relativePath}` });
    directories.set(relativePath, child); return child;
  };
  try {
    for (const artifact of parsed.lock.artifacts) {
      const parts = artifact.member_path.split("/"), name = parts.pop(), parent = directoryFor(parts.join("/"));
      const request = await fetchArtifact(artifact, transport);
      let result;
      try { result = await writeImmutableAt(parent, name, artifactChunks(request.response, artifact), { mode: 0o444, maximumBytes: artifact.bytes, expectedBytes: artifact.bytes, expectedSha256: artifact.sha256, fault, observe }); }
      catch (error) { acquisitionWriteError(error, artifact); }
      finally { request.finish(); }
      createdFiles.push({ parent, name, identity: result.identity });
    }
    assertRetainedCapability(state.directory);
    verifyAcquiredDirectory(parsed.lock, destination, trustedContext);
    assertRetainedCapability(state.directory);
    fsyncSync(state.directory.fd);
    closeAcquisitionCapabilities(directories, state.directory);
    return { lockSha256: parsed.sha256, artifactCount: parsed.lock.artifacts.length, destination, verification: "descriptor_anchored_linux" };
  } catch (error) {
    const cleanupErrors = [...(error.cleanupErrors ?? []), ...cleanupFiles(createdFiles, fault), ...cleanupDirectories(createdDirectories, fault)];
    if (state.created) removeDirectoryIfIdentity(state.directory.parent, state.directory.name, state.directory.identity, cleanupErrors, fault);
    try { fsyncSync(state.directory.parent.fd); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    closeAcquisitionCapabilities(directories, state.directory);
    if (cleanupErrors.length > 0) error.cleanupErrors = cleanupErrors;
    throw error;
  }
}

async function acquirePortable(parsed, destination, transport) {
  let preexisting = true;
  try { const metadata = lstatSync(destination, { bigint: true }); if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== BigInt(process.geteuid()) || Number(metadata.mode & 0o7777n) !== 0o755 || readdirSync(destination).length !== 0) fail("E_ACQUIRE_DESTINATION", "acquisition destination must be an empty owner-owned 0755 directory"); }
  catch (error) { if (error.code !== "ENOENT") throw error; mkdirSync(destination, { mode: 0o755 }); chmodSync(destination, 0o755); syncDirectory(dirname(destination)); preexisting = false; }
  const created = [], createdDirectories = [];
  try {
    for (const artifact of parsed.lock.artifacts) {
      const path = join(destination, artifact.member_path), parts = artifact.member_path.split("/"); let directory = destination;
      for (const part of parts.slice(0, -1)) { directory = join(directory, part); if (ensureDirectory(directory, 0o755)) createdDirectories.push(directory); }
      const request = await fetchArtifact(artifact, transport);
      try { await writePortableImmutable(path, artifactChunks(request.response, artifact), artifact); }
      finally { request.finish(); }
      created.push(path);
    }
    syncDirectory(destination);
    return { lockSha256: parsed.sha256, artifactCount: parsed.lock.artifacts.length, destination, verification: "byte_only_non_linux" };
  } catch (error) {
    const cleanupErrors = [];
    for (const path of created.reverse()) { try { unlinkSync(path); } catch (item) { if (item.code !== "ENOENT") cleanupErrors.push(item); } }
    for (const path of createdDirectories.reverse()) { try { rmdirSync(path); } catch (item) { if (item.code !== "ENOENT") cleanupErrors.push(item); } }
    if (!preexisting) { try { rmdirSync(destination); } catch (item) { if (item.code !== "ENOENT") cleanupErrors.push(item); } }
    for (const directory of new Set([destination, dirname(destination)])) { try { lstatSync(directory); syncDirectory(directory); } catch (item) { if (item.code !== "ENOENT") cleanupErrors.push(item); } }
    if (cleanupErrors.length > 0) error.cleanupErrors = cleanupErrors;
    throw error;
  }
}

function linkSyncNoReplace(source, destination) {
  try { linkSync(source, destination); } catch (error) { if (error.code === "EEXIST") fail("E_ACQUIRE_DESTINATION", `destination member already exists: ${destination}`); throw error; }
}

export async function acquireInputs(lockPath, destinationDirectory, { transport = productionTransport, trustedContext, fault, observe } = {}) {
  const parsed = parseAndValidateInputLock(lockPath);
  if (process.platform === "linux" && (!trustedContext || trustedContext.source_commit !== parsed.lock.materializer.source_commit || trustedContext.source_tree_sha256 !== parsed.lock.materializer.source_tree_sha256)) fail("E_ACQUIRE_TRUST_CONTEXT", "Linux acquisition requires an independently supplied trusted materializer commit/tree");
  clearAmbientNetworkEnvironment();
  const destination = resolve(destinationDirectory);
  return process.platform === "linux" ? acquireLinux(parsed, destination, transport, trustedContext, { fault, observe }) : acquirePortable(parsed, destination, transport);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const [lockPath, destination, sourceCommit, sourceTree] = process.argv.slice(2);
  if (!lockPath || !destination || !sourceCommit || !sourceTree) fail("E_USAGE", "lock, acquisition destination, and trusted materializer commit/tree are required");
  acquireInputs(lockPath, destination, { trustedContext: { source_commit: sourceCommit, source_tree_sha256: sourceTree } }).then((result) => process.stdout.write(`${result.lockSha256}\t${result.verification}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
