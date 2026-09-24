import { describe, expect, it } from 'vitest'
import { layoutCacheKey, readLayoutCache, validateCachedLayout, MAX_LAYOUT_CACHE_ENTRIES } from './layout-cache'
import { LAYOUT_VERSION } from './layout-state'

const config = { dimensions: 2 as const, nNeighbors: 15, minDist: 0.1, seed: 42 }

describe('persistent layout cache records', () => {
  it('builds a stable key from the vector, engine version, and canonical config', () => {
    expect(layoutCacheKey('vectors-a', config)).toBe(`vectors-a:${LAYOUT_VERSION}:{"dimensions":2,"nNeighbors":15,"minDist":0.1,"seed":42}`)
    expect(layoutCacheKey('vectors-a', { ...config, seed: 43 })).not.toBe(layoutCacheKey('vectors-a', config))
    expect(layoutCacheKey('vectors-b', config)).not.toBe(layoutCacheKey('vectors-a', config))
    expect(MAX_LAYOUT_CACHE_ENTRIES).toBeGreaterThan(0)
  })

  it('accepts typed coordinates and enforces ID order, uniqueness, shape, and finite values', () => {
    const ids = ['a', 'b']
    const valid = validateCachedLayout({ ids, coordinates: new Float32Array([0, 1, 2, 3]) }, ids, 2)
    expect(valid).toEqual({ ids, coordinates: new Float32Array([0, 1, 2, 3]) })
    expect(validateCachedLayout({ ids: ['b', 'a'], coordinates: [0, 1, 2, 3] }, ids, 2)).toBeNull()
    expect(validateCachedLayout({ ids: ['a', 'a'], coordinates: [0, 1, 2, 3] }, null, 2)).toBeNull()
    expect(validateCachedLayout({ ids, coordinates: [0, Number.NaN, 2, 3] }, ids, 2)).toBeNull()
    expect(validateCachedLayout({ ids, coordinates: [0, 1, 2] }, ids, 2)).toBeNull()
    expect(validateCachedLayout({ ids, coordinates: [0, 1, Number.POSITIVE_INFINITY, 3] }, ids, 2)).toBeNull()
  })

  it('treats missing IndexedDB as an empty cache', async () => {
    await expect(readLayoutCache('vectors-a', config, ['a'])).resolves.toBeNull()
  })
})

