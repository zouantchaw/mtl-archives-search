import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { admitOciOutput } from "./admit-oci-output.mjs";
import { publishAdmittedCapability } from "./publish-oci-output.mjs";
import { configureVerifiedHelpers } from "./run-verified-helper.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [helperDirectory, helperManifestSha256, candidate, admitted, destination, sourceDescriptorPath, sourceDescriptorSha256, expectedSbomPath, expectedSbomSha256, toolchainLockSha256, cargoLockSha256, trustRootsSha256, builderImage, builderImageDigest] = process.argv.slice(2);
if (!helperDirectory || !candidate || !admitted || !destination) throw new Error("admission/publication inputs are required");
const readPinned = (path, expectedSha256, cap) => {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) throw new Error("invalid pinned host-input digest");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  try {
    const metadata = fstatSync(fd, { bigint: true });
    if (!metadata.isFile() || metadata.uid !== BigInt(process.geteuid()) || metadata.nlink !== 1n || metadata.size < 1n || metadata.size > BigInt(cap)) throw new Error("pinned host-input metadata/size rejected before read");
    const bytes = Buffer.alloc(Number(metadata.size)); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) throw new Error("pinned host-input short read"); offset += count; }
    if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("pinned host-input digest mismatch");
    return bytes;
  } finally { closeSync(fd); }
};
const sourceDescriptorBytes = readPinned(sourceDescriptorPath, sourceDescriptorSha256, 64 * 1024);
const expectedSbomBytes = readPinned(expectedSbomPath, expectedSbomSha256, 4 * 1024 * 1024);
const source = parseStrictJson(sourceDescriptorBytes);
configureVerifiedHelpers(helperDirectory, join(helperDirectory, "helper-manifest.v1.json"), helperManifestSha256, source.source_manifest_sha256, builderImageDigest);
const capability = admitOciOutput(candidate, admitted, sourceDescriptorPath, expectedSbomPath, toolchainLockSha256, cargoLockSha256, trustRootsSha256, builderImage, builderImageDigest, { retainPublicationCapability: true, publicationParent: dirname(destination), sourceDescriptorBytes, expectedSbomBytes });
try {
  const result = publishAdmittedCapability(capability, basename(destination));
  process.stdout.write(result.stdout);
} finally {
  for (const fd of capability.memberFds) closeSync(fd);
  closeSync(capability.descriptorFd);
  closeSync(capability.parentFd);
}
