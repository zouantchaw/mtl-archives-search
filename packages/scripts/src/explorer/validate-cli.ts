import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  modelCompatibility,
  parseIdList,
  parseManifest,
  parsePointRecords,
  validatePublishedSet,
  verifyChecksum,
  type Issue,
} from './artifact-contract.js'

type CliArgs = Record<string, string | boolean>

function parseCli(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next == null || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function resolveInside(dir: string, relativePath: string): string {
  const root = path.resolve(dir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact path escapes the version folder: ${relativePath}`)
  }
  return resolved
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function printIssues(issues: Issue[]): void {
  for (const item of issues) console.error(`${item.level}\t${item.code}\t${item.message}`)
}

function main(): void {
  const args = parseCli(process.argv.slice(2))
  if (typeof args.dir !== 'string') {
    console.error('Usage: validate-cli --dir version-folder [--expect-model MODEL_ID]')
    process.exit(1)
  }
  const dir = args.dir
  const manifestBytes = readFileSync(resolveInside(dir, 'manifest.json'))
  const parsedManifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestBytes)))
  if (!parsedManifest.manifest) {
    printIssues(parsedManifest.issues)
    process.exit(1)
  }
  const manifest = parsedManifest.manifest
  const pointsBytes = readFileSync(resolveInside(dir, manifest.artifacts.points.path))
  const idsBytes = readFileSync(resolveInside(dir, manifest.artifacts.ids.path))
  if (!manifest.artifacts.embeddings) {
    console.error('error\tembeddings-missing\tManifest has no embeddings artifact.')
    process.exit(1)
  }
  const embeddingBytes = readFileSync(resolveInside(dir, manifest.artifacts.embeddings.path))
  const points = parsePointRecords(JSON.parse(new TextDecoder().decode(pointsBytes)))
  const ids = parseIdList(JSON.parse(new TextDecoder().decode(idsBytes)))
  const issues = [
    ...parsedManifest.issues,
    ...points.issues,
    ...ids.issues,
    ...verifyChecksum(manifest.artifacts.points, sha256(pointsBytes), pointsBytes.byteLength),
    ...verifyChecksum(manifest.artifacts.ids, sha256(idsBytes), idsBytes.byteLength),
    ...verifyChecksum(manifest.artifacts.embeddings, sha256(embeddingBytes), embeddingBytes.byteLength),
    ...validatePublishedSet({
      manifest,
      points: points.points,
      ids: ids.ids,
      embeddings: embeddingBytes,
    }).issues,
    ...modelCompatibility(manifest.modelId, typeof args['expect-model'] === 'string' ? args['expect-model'] : null),
  ]
  printIssues(issues)
  if (issues.some((item) => item.level === 'error')) process.exit(1)
  console.log(JSON.stringify({
    ok: true,
    count: manifest.count,
    modelId: manifest.modelId,
    indexId: manifest.indexId,
    embeddingDimension: manifest.embeddingDimension,
    generatedAt: manifest.generatedAt,
    legacy: manifest.legacy,
  }))
}

main()
