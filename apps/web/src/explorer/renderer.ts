import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MAP_SCALE } from './projection'
import type { ViewMode } from './url-state'

export type CloudPoint = {
  id: string
  x: number
  y: number
  z: number
  color: [number, number, number]
}

type CameraPose = {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

function poseFor(mode: ViewMode): CameraPose {
  if (mode === '2d') {
    return {
      position: new THREE.Vector3(MAP_SCALE / 2, -MAP_SCALE * 0.1, MAP_SCALE * 1.2),
      target: new THREE.Vector3(MAP_SCALE / 2, MAP_SCALE / 2, 0),
      fov: 50,
    }
  }
  return {
    position: new THREE.Vector3(MAP_SCALE * 1.15, -MAP_SCALE * 0.15, MAP_SCALE * 0.85),
    target: new THREE.Vector3(MAP_SCALE / 2, MAP_SCALE / 2, 40),
    fov: 55,
  }
}

function ease(value: number): number {
  return 1 - (1 - value) ** 3
}

export class PointCloudRenderer {
  private disposed = false
  private hidden = document.hidden
  private looping = false
  private frame = 0
  private reducedMotion: boolean
  private autoRotate = false
  private mode: ViewMode = '2d'
  private transition: { start: number; from: CameraPose; to: CameraPose; fromMode: ViewMode; toMode: ViewMode } | null = null
  private cameraAnim: { start: number; fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 } | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
  private geometry = new THREE.BufferGeometry()
  private readonly material: THREE.PointsMaterial
  private readonly cloud: THREE.Points
  private lines: THREE.LineSegments | null = null
  private ids: string[] = []
  private indexById = new Map<string, number>()
  private positions = new Float32Array()
  private zValues = new Float32Array()
  private dragDistance = 0
  private lastPointerX = 0
  private lastPointerY = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly resizeObserver: ResizeObserver
  private readonly finePointer: boolean
  private readonly onSelect: (id: string) => void
  private readonly onHover: (id: string | null) => void
  private readonly onContextLost: () => void
  private readonly onVisibility = () => {
    this.hidden = document.hidden
    if (!this.hidden && !this.disposed) this.start()
  }
  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragDistance = 0
    this.lastPointerX = event.clientX
    this.lastPointerY = event.clientY
  }
  private readonly onPointerMove = (event: PointerEvent) => {
    this.dragDistance += Math.hypot(event.clientX - this.lastPointerX, event.clientY - this.lastPointerY)
    this.lastPointerX = event.clientX
    this.lastPointerY = event.clientY
    if (!this.finePointer) return
    const id = this.pick(event)
    this.onHover(id)
  }
  private readonly onPointerLeave = () => {
    this.onHover(null)
  }
  private readonly onClick = (event: MouseEvent) => {
    if (this.dragDistance > 8) return
    const id = this.pick(event)
    if (id) this.onSelect(id)
  }
  private readonly onLost = (event: Event) => {
    event.preventDefault()
    this.onContextLost()
  }

  constructor(private readonly container: HTMLElement, options: {
    background: number
    reducedMotion: boolean
    onSelect: (id: string) => void
    onHover: (id: string | null) => void
    onContextLost: () => void
  }) {
    this.reducedMotion = options.reducedMotion
    this.onSelect = options.onSelect
    this.onHover = options.onHover
    this.onContextLost = options.onContextLost
    this.finePointer = window.matchMedia('(pointer: fine)').matches
    const initial = poseFor('2d')
    this.camera = new THREE.PerspectiveCamera(initial.fov, 1, 1, 12000)
    this.camera.position.copy(initial.position)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, failIfMajorPerformanceCaveat: false })
    } catch {
      throw new Error('webgl')
    }
    if (!renderer.getContext()) {
      renderer.dispose()
      throw new Error('webgl')
    }
    this.renderer = renderer
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.domElement.className = 'explorer-canvas-el'
    this.container.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(options.background)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(initial.target)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enableRotate = false
    this.controls.maxDistance = MAP_SCALE * 4
    this.controls.minDistance = 40
    this.material = new THREE.PointsMaterial({
      size: 6,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
    })
    this.cloud = new THREE.Points(this.geometry, this.material)
    this.scene.add(this.cloud)
    this.raycaster.params.Points ??= { threshold: 12 }
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('resize', this.resize)
    window.addEventListener('orientationchange', this.resize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost)
    this.resize()
    this.start()
  }

  setBackground(color: number): void {
    this.scene.background = new THREE.Color(color)
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    if (value) this.autoRotate = false
  }

  setAutoRotate(value: boolean): void {
    this.autoRotate = value && !this.reducedMotion && this.mode === '3d'
  }

  setPoints(points: CloudPoint[]): void {
    this.ids = points.map((point) => point.id)
    this.indexById = new Map(this.ids.map((id, index) => [id, index]))
    this.positions = new Float32Array(points.length * 3)
    this.zValues = new Float32Array(points.length)
    const colors = new Float32Array(points.length * 3)
    points.forEach((point, index) => {
      this.positions[index * 3] = point.x
      this.positions[index * 3 + 1] = point.y
      this.positions[index * 3 + 2] = this.mode === '3d' && !this.transition ? point.z : 0
      this.zValues[index] = point.z
      colors[index * 3] = point.color[0] / 255
      colors[index * 3 + 1] = point.color[1] / 255
      colors[index * 3 + 2] = point.color[2] / 255
    })
    this.geometry.dispose()
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.cloud.geometry = this.geometry
  }

  setColors(colors: Array<[number, number, number]>): void {
    if (colors.length !== this.ids.length) return
    const buffer = new Float32Array(colors.length * 3)
    colors.forEach((color, index) => {
      buffer[index * 3] = color[0] / 255
      buffer[index * 3 + 1] = color[1] / 255
      buffer[index * 3 + 2] = color[2] / 255
    })
    this.geometry.setAttribute('color', new THREE.BufferAttribute(buffer, 3))
  }

  setView(mode: ViewMode): void {
    if (mode === this.mode && !this.transition) return
    const from = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    }
    const to = poseFor(mode)
    this.cameraAnim = null
    if (this.reducedMotion) {
      this.applyPose(to)
      this.mode = mode
      this.transition = null
      this.writeZ(mode === '3d' ? 1 : 0)
      this.controls.enableRotate = mode === '3d'
      return
    }
    this.transition = { start: performance.now(), from, to, fromMode: this.mode, toMode: mode }
    this.mode = mode
    this.controls.enableRotate = mode === '3d'
  }

  setLines(ids: string[], visible: boolean): void {
    this.clearLines()
    if (!visible || ids.length < 2) return
    const present = ids.filter((id) => this.indexById.has(id))
    if (present.length < 2) return
    const positions: number[] = []
    for (let index = 0; index < present.length - 1; index += 1) {
      const from = this.coordinates(present[index])
      const to = this.coordinates(present[index + 1])
      if (!from || !to) continue
      positions.push(from[0], from[1], from[2], to[0], to[1], to[2])
    }
    if (positions.length === 0) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.LineBasicMaterial({ color: 0x0f5ea8, transparent: true, opacity: 0.7 })
    this.lines = new THREE.LineSegments(geometry, material)
    this.scene.add(this.lines)
  }

  focus(ids: string[]): void {
    const indexes = ids.flatMap((id) => {
      const index = this.indexById.get(id)
      return index == null ? [] : [index]
    })
    if (indexes.length === 0) return
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const index of indexes) {
      minX = Math.min(minX, this.positions[index * 3])
      maxX = Math.max(maxX, this.positions[index * 3])
      minY = Math.min(minY, this.positions[index * 3 + 1])
      maxY = Math.max(maxY, this.positions[index * 3 + 1])
    }
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const span = Math.max(maxX - minX, maxY - minY, 160)
    const target = new THREE.Vector3(centerX, centerY, this.mode === '3d' ? 30 : 0)
    const position = this.mode === '2d'
      ? new THREE.Vector3(centerX, centerY - span * 0.12, Math.max(span * 1.15, 220))
      : new THREE.Vector3(centerX + span * 0.35, centerY - span * 0.2, Math.max(span * 0.75, 180))
    this.moveCamera(position, target)
  }

  reset(): void {
    const pose = poseFor(this.mode)
    this.moveCamera(pose.position, pose.target)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('orientationchange', this.resize)
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.removeEventListener('click', this.onClick)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost)
    this.clearLines()
    this.controls.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  private resize = (): void => {
    if (this.disposed) return
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width < 2 || height < 2) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
    this.material.size = width < 700 ? 9 : 5.5
    this.raycaster.params.Points.threshold = width < 700 ? 18 : 12
  }

  private start(): void {
    if (this.looping || this.disposed || this.hidden) return
    this.looping = true
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (): void => {
    if (this.disposed) return
    if (this.hidden) {
      this.looping = false
      return
    }
    this.frame = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (this.transition) {
      const elapsed = (now - this.transition.start) / 600
      const t = ease(Math.min(1, elapsed))
      this.camera.position.lerpVectors(this.transition.from.position, this.transition.to.position, t)
      this.controls.target.lerpVectors(this.transition.from.target, this.transition.to.target, t)
      this.camera.fov = this.transition.from.fov + (this.transition.to.fov - this.transition.from.fov) * t
      this.camera.updateProjectionMatrix()
      this.writeZ(this.transition.toMode === '3d' ? t : 1 - t)
      if (elapsed >= 1) this.transition = null
    } else if (this.cameraAnim) {
      const elapsed = (now - this.cameraAnim.start) / 500
      const t = this.reducedMotion ? 1 : ease(Math.min(1, elapsed))
      this.camera.position.lerpVectors(this.cameraAnim.fromPosition, this.cameraAnim.toPosition, t)
      this.controls.target.lerpVectors(this.cameraAnim.fromTarget, this.cameraAnim.toTarget, t)
      if (elapsed >= 1 || this.reducedMotion) this.cameraAnim = null
    } else if (this.autoRotate && this.mode === '3d' && !this.reducedMotion) {
      const radius = this.camera.position.distanceTo(this.controls.target)
      const angle = now * 0.00008
      this.camera.position.x = this.controls.target.x + Math.sin(angle) * radius * 0.7
      this.camera.position.z = this.controls.target.z + Math.cos(angle) * radius * 0.7
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3): void {
    if (this.reducedMotion) {
      this.camera.position.copy(position)
      this.controls.target.copy(target)
      this.cameraAnim = null
      return
    }
    this.cameraAnim = {
      start: performance.now(),
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    }
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.copy(pose.position)
    this.controls.target.copy(pose.target)
    this.camera.fov = pose.fov
    this.camera.updateProjectionMatrix()
  }

  private writeZ(blend: number): void {
    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return
    const array = attribute.array as Float32Array
    for (let index = 0; index < this.zValues.length; index += 1) {
      array[index * 3 + 2] = this.zValues[index] * blend
    }
    attribute.needsUpdate = true
  }

  private coordinates(id: string): [number, number, number] | null {
    const index = this.indexById.get(id)
    if (index == null) return null
    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return null
    const array = attribute.array as Float32Array
    const z = this.mode === '3d' ? this.zValues[index] ?? 0 : 0
    return [array[index * 3], array[index * 3 + 1], z]
  }

  private pick(event: { clientX: number; clientY: number }): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return null
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.cloud)[0]
    if (hit?.index == null) return null
    return this.ids[hit.index] ?? null
  }

  private clearLines(): void {
    if (!this.lines) return
    this.scene.remove(this.lines)
    this.lines.geometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
    this.lines = null
  }
}
