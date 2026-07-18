import { runVerifiedHelper } from "./run-verified-helper.mjs";

export function publishAdmittedCapability(capability, destinationName) {
  if (!capability || !Number.isInteger(capability.descriptorFd) || !Number.isInteger(capability.parentFd) || !Array.isArray(capability.memberFds) || capability.memberFds.length !== 6 || !capability.memberFds.every(Number.isInteger) || !/^[a-f0-9]{64}$/.test(capability.descriptorSha256 ?? "")) throw new Error("retained admission capability required");
  if (!/^[A-Za-z0-9._-]+$/.test(destinationName ?? "") || [".", ".."].includes(destinationName)) throw new Error("unsafe publication destination name");
  return runVerifiedHelper("gate-h2-publish-noreplace", [destinationName, capability.descriptorSha256], { inheritedFds: [capability.descriptorFd, capability.parentFd, ...capability.memberFds] });
}

if (process.argv[1] === new URL(import.meta.url).pathname) throw new Error("publication has no pathname CLI; use retained admission capability");
