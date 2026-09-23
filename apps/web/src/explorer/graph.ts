export type GraphEdge = {
  source: string
  target: string
  score: number
}

type VectorRow = {
  id: string
  vector: Float32Array
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index]
    const r = right[index]
    if (!Number.isFinite(l) || !Number.isFinite(r)) return Number.NaN
    dot += l * r
    leftNorm += l * l
    rightNorm += r * r
  }
  if (leftNorm <= 0 || rightNorm <= 0) return Number.NaN
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function canonicalEdge(source: string, target: string, score: number): GraphEdge {
  return source < target ? { source, target, score } : { source: target, target: source, score }
}

/** Build a sparse, deterministic graph from the published snapshot vectors. */
export function buildSearchGraph(
  ids: string[],
  matrix: Float32Array,
  embeddingIds: string[],
  dimensions: number,
): GraphEdge[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) return []
  const rows = new Map<string, VectorRow>()
  const maxRows = Math.min(embeddingIds.length, Math.floor(matrix.length / dimensions))
  for (let index = 0; index < maxRows; index += 1) {
    const id = embeddingIds[index]
    if (!id || rows.has(id)) continue
    const vector = matrix.subarray(index * dimensions, (index + 1) * dimensions)
    if (vector.some((value) => !Number.isFinite(value)) || vector.every((value) => value === 0)) continue
    rows.set(id, { id, vector })
  }

  const validIds = [...new Set(ids)].filter((id) => rows.has(id)).slice(0, 50)
  const edges = new Map<string, GraphEdge>()
  for (const source of validIds) {
    const sourceRow = rows.get(source)
    if (!sourceRow) continue
    const candidates: GraphEdge[] = []
    for (const target of validIds) {
      if (target === source) continue
      const targetRow = rows.get(target)
      if (!targetRow) continue
      const score = cosine(sourceRow.vector, targetRow.vector)
      if (!Number.isFinite(score) || score < 0.2) continue
      candidates.push(canonicalEdge(source, target, score))
    }
    candidates.sort((left, right) => right.score - left.score || left.target.localeCompare(right.target))
    for (const edge of candidates.slice(0, 2)) {
      const key = `${edge.source}\u0000${edge.target}`
      const existing = edges.get(key)
      if (!existing || edge.score > existing.score) edges.set(key, edge)
    }
  }
  return [...edges.values()]
    .sort((left, right) => right.score - left.score || left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
    .slice(0, 80)
}

/** Build the star used by the selected photograph's snapshot-neighbor view. */
export function buildNeighborGraph(anchorId: string, neighbors: Array<{ id: string; score?: number }>): GraphEdge[] {
  if (!anchorId) return []
  const edges = new Map<string, GraphEdge>()
  for (const neighbor of neighbors) {
    if (!neighbor.id || neighbor.id === anchorId) continue
    const score = neighbor.score ?? 1
    if (!Number.isFinite(score) || score <= 0) continue
    const edge = canonicalEdge(anchorId, neighbor.id, score)
    const key = `${edge.source}\u0000${edge.target}`
    const existing = edges.get(key)
    if (!existing || score > existing.score) edges.set(key, edge)
  }
  return [...edges.values()].sort((left, right) => right.score - left.score || left.target.localeCompare(right.target))
}
