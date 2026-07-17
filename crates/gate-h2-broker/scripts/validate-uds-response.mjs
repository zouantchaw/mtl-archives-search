import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const crateRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(crateRoot, "../..");
const require = createRequire(path.join(repositoryRoot, "packages/scripts/package.json"));
const Ajv2020 = require("ajv/dist/2020").default;
const schemaPath = path.join(
  repositoryRoot,
  "docs/dataset-factory/schemas/reviewed-metrics-v2/https-exchange-uds-protocol.schema.v1.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

if (!validate(value)) {
  process.stderr.write(`${JSON.stringify(validate.errors)}\n`);
  process.exitCode = 1;
}
