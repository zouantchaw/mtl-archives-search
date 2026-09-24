import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeLayout, LAYOUT_ENGINE_VERSION, layoutEpochs, LAYOUT_PRESETS, type LayoutConfig, type LayoutPreset } from '../src/explorer/layout-engine.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const defaultInput = path.join(repositoryRoot, 'tmp/explorer-refresh/published/v1/20260924T101335Z')
const outputDirectory = path.join(repositoryRoot, 'apps/web/public/layouts')

type Manifest = {
  artifacts?: { embeddings?: { sha256?: string } | null }
}

function parseArgs(): { inputDirectory: string; outputDirectory: string; parallel: number; presets: LayoutPreset[] } {
  const args = process.argv.slice(2)
  let inputDirectory = defaultInput
  let out = outputDirectory
  let parallel = 1
  let presets = Object.keys(LAYOUT_PRESETS) as LayoutPreset[]
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--input' && args[index + 1]) inputDirectory = path.resolve(args[++index])
    else if (argument === '--out' && args[index + 1]) out = path.resolve(args[++index])
    else if (argument === '--parallel' && args[index + 1]) parallel = Math.max(1, Math.min(2, Number(args[++index]) || 1))
    else if (argument === '--preset' && args[index + 1]) presets = args[++index].split(',').map((name) => {
      if (!(name in LAYOUT_PRESETS)) throw new Error(`Unknown preset: ${name}`)
      return name as LayoutPreset
    })
    else if (argument === '--help') {
      console.log('Usage: tsx scripts/generate-layout-presets.ts [--input DIR] [--out DIR] [--parallel 1|2] [--preset NAME,...]')
      process.exit(0)
    }
  }
  return { inputDirectory, outputDirectory: out, parallel, presets }
}

function readInput(inputDirectory: string): { matrix: Float32Array; embeddingDimensions: number; ids: string[]; vectorSha256: string } {
  const ids = JSON.parse(readFileSync(path.join(inputDirectory, 'ids.json'), 'utf8')) as unknown
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('ids.json must contain an array of strings.')
  if (new Set(ids).size !== ids.length) throw new Error('ids.json contains duplicate IDs.')
  const bytes = new Uint8Array(readFileSync(path.join(inputDirectory, 'embeddings.bin')))
  if (bytes.byteLength < 8) throw new Error('embeddings.bin is missing its 8-byte header.')
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = header.getUint32(0, true)
  const dimensions = header.getUint32(4, true)
  if (count !== ids.length || dimensions < 1 || bytes.byteLength !== 8 + count * dimensions * 4) {
    throw new Error(`Embedding header does not match ids (${count} rows × ${dimensions} dimensions).`)
  }
  const manifest = JSON.parse(readFileSync(path.join(inputDirectory, 'manifest.json'), 'utf8')) as Manifest
  const vectorSha256 = manifest.artifacts?.embeddings?.sha256
  if (!vectorSha256) throw new Error('manifest.json is missing artifacts.embeddings.sha256.')
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== vectorSha256) throw new Error('embeddings.bin does not match manifest artifacts.embeddings.sha256.')
  const matrix = new Float32Array(bytes.buffer, bytes.byteOffset + 8, count * dimensions)
  return { matrix, embeddingDimensions: dimensions, ids: ids as string[], vectorSha256 }
}

function writePreset(
  name: LayoutPreset,
  config: LayoutConfig,
  input: ReturnType<typeof readInput>,
  out: string,
): void {
  const started = Date.now()
  let lastReport = 0
  console.log(`[${name}] starting ${input.ids.length} rows × ${input.embeddingDimensions} dimensions`)
  const coordinates = computeLayout(input.matrix, input.embeddingDimensions, config, (progress, phase) => {
    if (phase !== 'complete' && progress - lastReport < 0.1) return
    lastReport = progress
    console.log(`[${name}] ${phase} ${Math.round(progress * 100)}%`)
  })
  const values = Array.from(coordinates)
  if (values.length !== input.ids.length * config.dimensions || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`[${name}] UMAP returned an invalid coordinate buffer.`)
  }
  const payload = {
    vectorSha256: input.vectorSha256,
    ids: input.ids,
    config,
    coordinates: values,
    algorithm: 'umap-js',
    version: '1.4.0',
    engineVersion: LAYOUT_ENGINE_VERSION,
    nEpochs: layoutEpochs(input.ids.length),
  }
  const destination = path.join(out, `${name}.json`)
  writeFileSync(destination, JSON.stringify(payload))
  console.log(`[${name}] wrote ${destination} (${values.length} coordinates) in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

function main(): void {
  const options = parseArgs()
  const input = readInput(options.inputDirectory)
  mkdirSync(options.outputDirectory, { recursive: true })
  // Keep generation sequential by default. A future worker-thread runner may
  // use two jobs, but more than two UMAP graphs would waste memory on this host.
  if (options.parallel > 1) console.log(`--parallel ${options.parallel} requested; using one bounded job at a time.`)
  for (const name of options.presets) writePreset(name, LAYOUT_PRESETS[name], input, options.outputDirectory)
}

main()
