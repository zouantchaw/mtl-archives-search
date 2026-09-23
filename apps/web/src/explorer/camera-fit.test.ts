import { describe, expect, it } from 'vitest'
import { cameraBoundsForPoints, cameraFitForBounds, type CameraBounds } from './camera-fit'

const mapBounds: CameraBounds = {
  minX: 0,
  maxX: 1000,
  minY: 0,
  maxY: 1000,
  minZ: -48,
  maxZ: 168,
}

describe('camera fitting', () => {
  it('moves farther away for a narrow viewport so the horizontal extent remains visible', () => {
    const wide = cameraFitForBounds(mapBounds, { mode: '2d', aspect: 1.6, fov: 50 })
    const narrow = cameraFitForBounds(mapBounds, { mode: '2d', aspect: 390 / 668, fov: 50 })

    expect(narrow.distance).toBeGreaterThan(wide.distance * 1.5)
    expect(narrow.target.x).toBe(500)
    expect(narrow.target.y).toBe(500)
    expect(narrow.target.z).toBe(0)
  })

  it('includes depth in a 3d fit and centers the selected z range', () => {
    const shallow = cameraFitForBounds({ ...mapBounds, minZ: 0, maxZ: 0 }, { mode: '3d', aspect: 1, fov: 55 })
    const deep = cameraFitForBounds(mapBounds, { mode: '3d', aspect: 1, fov: 55 })

    expect(deep.distance).toBeGreaterThan(shallow.distance)
    expect(deep.target.z).toBe(60)
    expect(deep.position.z).toBeGreaterThan(deep.target.z)
  })

  it('derives finite bounds and ignores invalid trailing points', () => {
    expect(cameraBoundsForPoints([])).toBeNull()
    expect(cameraBoundsForPoints([
      { x: 10, y: 20, z: 30 },
      { x: -5, y: 40, z: 0 },
      { x: Number.NaN, y: 4, z: 3 },
    ])).toEqual({ minX: -5, maxX: 10, minY: 20, maxY: 40, minZ: 0, maxZ: 30 })
  })
})
