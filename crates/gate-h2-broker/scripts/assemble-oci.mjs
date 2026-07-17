import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [layerPath, layoutPath, archivePath] = process.argv.slice(2);
if (!layerPath || !layoutPath || !archivePath) throw new Error("layer, layout, and archive paths are required");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writeBlob = (bytes) => {
  const digest = sha256(bytes);
  const path = join(layoutPath, "blobs", "sha256", digest);
  writeFileSync(path, bytes, { mode: 0o444, flag: "wx" });
  return { digest: `sha256:${digest}`, size: bytes.length };
};

mkdirSync(join(layoutPath, "blobs", "sha256"), { recursive: true, mode: 0o755 });
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
writeFileSync(join(layoutPath, "oci-layout"), `${JSON.stringify({ imageLayoutVersion: "1.0.0" })}\n`);
writeFileSync(join(layoutPath, "index.json"), `${JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    ...manifest,
    platform: { architecture: "amd64", os: "linux" },
  }],
})}\n`);
execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", layoutPath, "-cf", archivePath, "."]);
process.stdout.write(`${manifest.digest}\n`);
