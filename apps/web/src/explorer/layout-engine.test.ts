import { describe, expect, it } from 'vitest'
import {
  computeLayout,
  computeLayoutAsync,
  LAYOUT_PRESETS,
  normalizeEmbeddings,
  type LayoutConfig,
} from './layout-engine'

function fixtureMatrix(rows = 10, dimensions = 4): Float32Array {
  const matrix = new Float32Array(rows * dimensions)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < dimensions; column += 1) {
      matrix[row * dimensions + column] = Math.sin((row + 1) * (column + 2)) + (column === 0 ? row * 0.1 : 0)
    }
  }
  return matrix
}

const config: LayoutConfig = { dimensions: 2, nNeighbors: 3, minDist: 0.1, seed: 42 }

describe('layout engine', () => {
  it('normalizes each embedding row for cosine distance without mutating the matrix', () => {
    const matrix = new Float32Array([3, 4, 0, -2])
    const copy = matrix.slice()
    const rows = normalizeEmbeddings(matrix, 2)
    expect(rows[0]?.[0]).toBeCloseTo(0.6)
    expect(rows[0]?.[1]).toBeCloseTo(0.8)
    expect(rows[1]).toEqual([0, -1])
    expect(matrix).toEqual(copy)
  })

  it('returns deterministic interleaved 2D and 3D coordinates', () => {
    const matrix = fixtureMatrix()
    const first = computeLayout(matrix, 4, config)
    const second = computeLayout(matrix, 4, config)
    expect(first).toEqual(second)
    expect(first).toHaveLength(20)
    expect([...first].every(Number.isFinite)).toBe(true)

    const threeD = computeLayout(matrix, 4, { ...config, dimensions: 3 })
    expect(threeD).toHaveLength(30)
    expect([...threeD].every(Number.isFinite)).toBe(true)
    expect(threeD).not.toEqual(first)
  })

  it('reports async optimization progress and matches the synchronous result', async () => {
    const matrix = fixtureMatrix()
    const progress: Array<{ value: number; phase: string }> = []
    const result = await computeLayoutAsync(matrix, 4, config, (value, phase) => progress.push({ value, phase }))
    expect(result).toEqual(computeLayout(matrix, 4, config))
    expect(progress[0]?.phase).toBe('normalizing')
    expect(progress.some((item) => item.phase === 'optimizing')).toBe(true)
    expect(progress.at(-1)).toEqual({ value: 1, phase: 'complete' })
  })

  it('rejects malformed or unbounded requests', () => {
    expect(() => computeLayout(new Float32Array([1, 0, 0, 1]), 2, config)).toThrow(/at least 3/)
    expect(() => computeLayout(fixtureMatrix(), 4, { ...config, nNeighbors: 99_999 })).toThrow(/nNeighbors/)
    expect(() => computeLayout(fixtureMatrix(), 4, { ...config, minDist: -1 })).toThrow(/minDist/)
    expect(() => computeLayout(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]), 4, config)).toThrow(/zero length/)
  })

  it('publishes the five bounded preset contracts', () => {
    expect(LAYOUT_PRESETS['published-3d']).toEqual({ dimensions: 3, nNeighbors: 15, minDist: 0.1, seed: 42 })
    expect(LAYOUT_PRESETS['local-2d']).toEqual({ dimensions: 2, nNeighbors: 8, minDist: 0.05, seed: 42 })
    expect(LAYOUT_PRESETS['local-3d']).toEqual({ dimensions: 3, nNeighbors: 8, minDist: 0.05, seed: 42 })
    expect(LAYOUT_PRESETS['broad-2d']).toEqual({ dimensions: 2, nNeighbors: 40, minDist: 0.3, seed: 42 })
    expect(LAYOUT_PRESETS['broad-3d']).toEqual({ dimensions: 3, nNeighbors: 40, minDist: 0.3, seed: 42 })
  })
})
