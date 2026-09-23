import * as THREE from 'three'

export type CameraFitMode = '2d' | '3d'

export type CameraBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export type CameraFit = {
  position: THREE.Vector3
  target: THREE.Vector3
  distance: number
}

type FitOptions = {
  mode: CameraFitMode
  aspect: number
  fov: number
  padding?: number
  minDistance?: number
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TWO_D_OFFSET = new THREE.Vector3(0, -0.45, 1).normalize()
const THREE_D_OFFSET = new THREE.Vector3(0.92, -0.34, 0.86).normalize()

/**
 * Return a perspective camera pose that contains every corner of a bounds box.
 * The distance is solved in camera space, so a narrow viewport gets farther
 * away to preserve the complete horizontal extent.
 */
export function cameraFitForBounds(bounds: CameraBounds, options: FitOptions): CameraFit {
  const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1
  const fov = Math.min(170, Math.max(1, options.fov))
  const padding = Math.max(1, options.padding ?? 1.14)
  const minDistance = Math.max(1, options.minDistance ?? 180)
  const offset = (options.mode === '3d' ? THREE_D_OFFSET : TWO_D_OFFSET).clone()
  const target = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    options.mode === '3d' ? (bounds.minZ + bounds.maxZ) / 2 : 0,
  )
  const minZ = options.mode === '3d' ? bounds.minZ : 0
  const maxZ = options.mode === '3d' ? bounds.maxZ : 0
  const forward = offset.clone().negate()
  const right = forward.clone().cross(WORLD_UP).normalize()
  const up = right.clone().cross(forward).normalize()
  const tangent = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  let distance = minDistance

  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [minZ, maxZ]) {
        const delta = new THREE.Vector3(x, y, z).sub(target)
        // For a camera at target + offset * distance, this is the point's
        // depth toward the camera. It must be included in the perspective
        // fit because farther-forward corners have a larger projected size.
        const towardCamera = delta.dot(offset)
        const horizontal = Math.abs(delta.dot(right)) * padding / (tangent * aspect)
        const vertical = Math.abs(delta.dot(up)) * padding / tangent
        distance = Math.max(distance, towardCamera + horizontal, towardCamera + vertical)
      }
    }
  }

  return {
    target,
    distance,
    position: target.clone().addScaledVector(offset, distance),
  }
}

export function cameraBoundsForPoints(points: Array<{ x: number; y: number; z: number }>): CameraBounds | null {
  if (points.length === 0) return null
  const first = points[0]
  if (!first || !Number.isFinite(first.x) || !Number.isFinite(first.y) || !Number.isFinite(first.z)) return null
  const bounds: CameraBounds = {
    minX: first.x,
    maxX: first.x,
    minY: first.y,
    maxY: first.y,
    minZ: first.z,
    maxZ: first.z,
  }
  for (const point of points.slice(1)) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxY = Math.max(bounds.maxY, point.y)
    bounds.minZ = Math.min(bounds.minZ, point.z)
    bounds.maxZ = Math.max(bounds.maxZ, point.z)
  }
  return bounds
}
