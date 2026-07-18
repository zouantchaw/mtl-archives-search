import { dirname } from "node:path";
import { createDurableDirectory, syncDirectory, validateOwnedDirectory } from "./secure-files.mjs";

const [path, modeText = "700", existing = ""] = process.argv.slice(2);
if (!path || !/^[0-7]{3,4}$/.test(modeText)) throw new Error("directory path and octal mode are required");
const mode = Number.parseInt(modeText, 8);
if (existing === "--existing") { validateOwnedDirectory(path, mode); syncDirectory(dirname(path)); }
else if (existing) throw new Error("unknown durable directory option");
else createDurableDirectory(path, mode);
