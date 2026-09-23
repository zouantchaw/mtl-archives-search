export type Neighbor = {
  id: string
  cosine: number
}

export function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export function nearestInSnapshot(args: {
  matrix: Float32Array
  dimensions: number
  ids: string[]
  sourceId: string
  limit: number
}): Neighbor[] {
  const sourceIndex = args.ids.indexOf(args.sourceId)
  if (sourceIndex < 0) return []
  const width = args.dimensions
  if (args.matrix.length < args.ids.length * width) return []
  const source = args.matrix.subarray(sourceIndex * width, (sourceIndex + 1) * width)
  const scored: Neighbor[] = []
  for (let index = 0; index < args.ids.length; index += 1) {
    if (index === sourceIndex) continue
    const cosineValue = cosine(source, args.matrix.subarray(index * width, (index + 1) * width))
    if (!Number.isFinite(cosineValue)) continue
    scored.push({ id: args.ids[index], cosine: cosineValue })
  }
  scored.sort((left, right) => right.cosine - left.cosine)
  return scored.slice(0, args.limit)
}
