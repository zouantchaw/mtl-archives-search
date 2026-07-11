import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { sha256, writeJson } from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  if (!values.root) throw new Error('--root is required');
  const root = path.isAbsolute(values.root) ? values.root : path.resolve(ROOT, values.root);
  const files = fs.readdirSync(root).filter((name) => name.endsWith('.jpg')).sort();
  const rows = [];
  for (const name of files) {
    const filePath = path.join(root, name); const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${name}: expected regular file`);
    const bytes = fs.readFileSync(filePath); const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || metadata.format !== 'jpeg' || bytes.subarray(0, 2).toString('hex') !== 'ffd8') throw new Error(`${name}: invalid JPEG derivative`);
    rows.push({ record_id: `${name.replace(/\.jpg$/, '')}.json`, path: name, sha256: sha256(bytes), bytes: bytes.length, width: metadata.width, height: metadata.height, format: metadata.format, magic: 'ffd8' });
  }
  const treeRows = rows.map((row) => `${row.path}\t${row.sha256}\t${row.bytes}\t${row.width}x${row.height}\t${row.format}\t${row.magic}`);
  writeJson(path.join(root, 'manifest-v1.json'), { schema_version: 'canonical_image_recovery_derivative_manifest_v1.0.0', tree_sha256: sha256(`${treeRows.join('\n')}\n`), rows });
  console.log(JSON.stringify({ status: 'ok', root, rows: rows.length, tree_sha256: sha256(`${treeRows.join('\n')}\n`) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
