import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDurableDirectory } from "./secure-files.mjs";

const [layerPath, layoutPath, archivePath, mode] = process.argv.slice(2);
if (!layerPath || !layoutPath || !archivePath) throw new Error("layer, layout, and archive paths are required");
if (mode && mode !== "--layout-only") throw new Error("unknown OCI assembly mode");
process.umask(0o022);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writeBlob = (bytes) => {
  const digest = sha256(bytes);
  const path = join(layoutPath, "blobs", "sha256", digest);
  writeFileSync(path, bytes, { mode: 0o444, flag: "wx" });
  chmodSync(path, 0o444);
  return { digest: `sha256:${digest}`, size: bytes.length };
};

createDurableDirectory(layoutPath, 0o755);
createDurableDirectory(join(layoutPath, "blobs"), 0o755);
createDurableDirectory(join(layoutPath, "blobs", "sha256"), 0o755);
for (const directory of [layoutPath, join(layoutPath, "blobs"), join(layoutPath, "blobs", "sha256")]) chmodSync(directory, 0o755);
const layerBytes = readFileSync(layerPath);
const layer = writeBlob(layerBytes);
const configBytes = Buffer.from(JSON.stringify({
  architecture: "amd64",
  os: "linux",
  config: { User: "65532:65532", Entrypoint: ["/usr/local/bin/gate-h2-stage-runtime"] },
  rootfs: { type: "layers", diff_ids: [layer.digest] },
  history: [{ created_by: "gate-h2-hermetic-builder-v2" }],
}));
const config = writeBlob(configBytes);
const manifestBytes = Buffer.from(JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { mediaType: "application/vnd.oci.image.config.v1+json", ...config },
  layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", ...layer }],
}));
const manifest = writeBlob(manifestBytes);
writeFileSync(join(layoutPath, "oci-layout"), `${JSON.stringify({ imageLayoutVersion: "1.0.0" })}\n`, { mode: 0o444, flag: "wx" });
writeFileSync(join(layoutPath, "index.json"), `${JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    ...manifest,
    platform: { architecture: "amd64", os: "linux" },
  }],
})}\n`, { mode: 0o444, flag: "wx" });
chmodSync(join(layoutPath, "oci-layout"), 0o444);
chmodSync(join(layoutPath, "index.json"), 0o444);
if (mode !== "--layout-only") execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "create-canonical-tar.mjs"), layoutPath, archivePath]);
process.stdout.write(`${manifest.digest}\n`);
