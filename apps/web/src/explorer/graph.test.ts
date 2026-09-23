import { describe, expect, it } from 'vitest'
import { buildNeighborGraph, buildSearchGraph } from './graph'

describe('snapshot graph construction', () => {
  it('connects each valid vector to its strongest positive neighbors and deduplicates edges', () => {
    const ids = ['a', 'b', 'c', 'missing']
    const embeddingIds = ['a', 'b', 'c']
    const matrix = new Float32Array([
      1, 0,
      0.9, 0.1,
      0.8, 0.2,
    ])
    const edges = buildSearchGraph(ids, matrix, embeddingIds, 2)

    expect(edges).toEqual([
      { source: 'a', target: 'b', score: expect.closeTo(0.9938837347, 8) },
      { source: 'b', target: 'c', score: expect.closeTo(0.9909924304, 8) },
      { source: 'a', target: 'c', score: expect.closeTo(0.9701425001, 8) },
    ])
    expect(edges.every((edge) => edge.source < edge.target)).toBe(true)
    expect(edges.some((edge) => edge.source === 'missing' || edge.target === 'missing')).toBe(false)
    expect(buildSearchGraph(
      ['a', 'opposite'],
      new Float32Array([1, 0, -1, 0]),
      ['a', 'opposite'],
      2,
    )).toEqual([])
  })

  it('ignores invalid vectors, applies the 50 node and 80 edge bounds, and keeps strongest duplicate scores', () => {
    const ids = Array.from({ length: 55 }, (_, index) => `id-${index}`)
    const embeddingIds = [...ids, 'bad']
    const matrix = new Float32Array((embeddingIds.length) * 2)
    for (let index = 0; index < ids.length; index += 1) {
      matrix[index * 2] = 1
      matrix[index * 2 + 1] = index < 50 ? 0 : Number.NaN
    }
    const edges = buildSearchGraph(ids, matrix, embeddingIds, 2)

    expect(edges).toHaveLength(80)
    expect(edges.every((edge) => edge.source.startsWith('id-') && edge.target.startsWith('id-'))).toBe(true)
    expect(buildSearchGraph(['a'], new Float32Array([1, 2]), ['a'], 0)).toEqual([])
  })

  it('builds a sorted star for snapshot neighbors and filters invalid entries', () => {
    expect(buildNeighborGraph('anchor', [
      { id: 'near', score: 0.9 },
      { id: 'far', score: 0.4 },
      { id: 'near', score: 0.95 },
      { id: 'anchor', score: 1 },
      { id: 'bad', score: Number.NaN },
    ])).toEqual([
      { source: 'anchor', target: 'near', score: 0.95 },
      { source: 'anchor', target: 'far', score: 0.4 },
    ])
  })
})
