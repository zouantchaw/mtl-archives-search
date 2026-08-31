import { readFileSync } from "node:fs";

const [candidate, expected] = process.argv.slice(2);
if (!candidate || !expected) throw new Error("candidate and expected SBOM paths are required");
if (!readFileSync(candidate).equals(readFileSync(expected))) throw new Error("independent Cargo metadata SBOM differs from Cargo tree SBOM");
