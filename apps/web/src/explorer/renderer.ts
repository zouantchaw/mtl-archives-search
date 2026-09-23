import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MOUSE, TOUCH } from 'three'
import { cameraBoundsForPoints, cameraFitForBounds, type CameraBounds } from './camera-fit'
import type { GraphEdge } from './graph'
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

const FOV_BY_MODE: Record<ViewMode, number> = { '2d': 50, '3d': 55 }

function defaultBounds(mode: ViewMode): CameraBounds {
  return {
    minX: 0,
    maxX: MAP_SCALE,
    minY: 0,
    maxY: MAP_SCALE,
    minZ: mode === '3d' ? -66 : 0,
    maxZ: mode === '3d' ? 168 : 0,
  }
}

function poseFor(mode: ViewMode, aspect = 1, bounds = defaultBounds(mode)): CameraPose {
  const fov = FOV_BY_MODE[mode]
  const fit = cameraFitForBounds(bounds, {
    mode,
    aspect,
    fov,
    padding: 1.14,
    minDistance: bounds.minX === bounds.maxX && bounds.minY === bounds.maxY
      ? (mode === '2d' ? 110 : 130) : (mode === '2d' ? 220 : 260),
  })
  return { position: fit.position, target: fit.target, fov }
}

function sameBounds(left: CameraBounds | null, right: CameraBounds | null): boolean {
  if (!left || !right) return left === right
  return left.minX === right.minX && left.maxX === right.maxX
    && left.minY === right.minY && left.maxY === right.maxY
    && left.minZ === right.minZ && left.maxZ === right.maxZ
}

function srgbByteToLinear(value: number): number {
  const srgb = Math.min(255, Math.max(0, value)) / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
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
  private readonly pointAlphaTexture: THREE.DataTexture
  private readonly material: THREE.PointsMaterial
  private readonly cloud: THREE.Points
  private readonly selectionMarkerElement: HTMLDivElement
  private readonly selectionMarkerLabel: HTMLButtonElement
  private lines: THREE.LineSegments | null = null
  private connectionEdges: GraphEdge[] = []
  private connectionVisible = false
  private connectionTheme: 'light' | 'dark' = 'light'
  private renderedConnectionEdges: GraphEdge[] = []
  private renderedConnectionNodeIds: string[] = []
  private connectionNodes: THREE.Points | null = null
  private ids: string[] = []
  private indexById = new Map<string, number>()
  private positions = new Float32Array()
  private zValues = new Float32Array()
  private pointBounds: CameraBounds | null = null
  private focusedBounds: CameraBounds | null = null
  private overviewFit = true
  private cameraManuallyControlled = false
  private selectedId: string | null = null
  private dragDistance = 0
  private activePointerId: number | null = null
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
    this.activePointerId = event.pointerId
    this.dragDistance = 0
    this.lastPointerX = event.clientX
    this.lastPointerY = event.clientY
  }
  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.activePointerId != null && event.pointerId === this.activePointerId) {
      this.dragDistance += Math.hypot(event.clientX - this.lastPointerX, event.clientY - this.lastPointerY)
      this.lastPointerX = event.clientX
      this.lastPointerY = event.clientY
      if (this.dragDistance > 8) {
        if (this.finePointer) this.onHover(null)
        return
      }
    }
    if (!this.finePointer) return
    const id = this.pick(event)
    this.onHover(id)
  }
  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === this.activePointerId) this.activePointerId = null
  }
  private readonly onPointerLeave = () => {
    this.onHover(null)
  }
  private readonly onControlStart = () => {
    this.overviewFit = false
    this.focusedBounds = null
    this.cameraManuallyControlled = true
    this.cameraAnim = null
  }
  private readonly onClick = (event: MouseEvent) => {
    if (this.dragDistance > 8) return
    const id = this.pick(event)
    if (id) this.onSelect(id)
  }
  private readonly onDoubleClick = (event: MouseEvent) => {
    if (this.dragDistance > 8) return
    const id = this.pick(event)
    if (id) this.focus([id])
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
    this.controls.zoomToCursor = true
    this.controls.maxDistance = MAP_SCALE * 4
    this.controls.minDistance = 40
    this.controls.addEventListener('start', this.onControlStart)
    const pointMaskSize = 32
    const pointMask = new Uint8Array(pointMaskSize * pointMaskSize * 4)
    for (let y = 0; y < pointMaskSize; y += 1) {
      for (let x = 0; x < pointMaskSize; x += 1) {
        const dx = (x + 0.5) / pointMaskSize - 0.5
        const dy = (y + 0.5) / pointMaskSize - 0.5
        const distance = Math.hypot(dx, dy)
        const alpha = Math.round(255 * THREE.MathUtils.clamp((0.5 - distance) / 0.025 + 0.5, 0, 1))
        const offset = (y * pointMaskSize + x) * 4
        pointMask.set([alpha, alpha, alpha, 255], offset)
      }
    }
    this.pointAlphaTexture = new THREE.DataTexture(pointMask, pointMaskSize, pointMaskSize, THREE.RGBAFormat)
    this.pointAlphaTexture.magFilter = THREE.LinearFilter
    this.pointAlphaTexture.minFilter = THREE.LinearFilter
    this.pointAlphaTexture.needsUpdate = true
    this.material = new THREE.PointsMaterial({
      size: 6,
      vertexColors: true,
      sizeAttenuation: true,
      alphaMap: this.pointAlphaTexture,
      alphaTest: 0.1,
      transparent: true,
      opacity: 0.92,
    })
    this.cloud = new THREE.Points(this.geometry, this.material)
    this.scene.add(this.cloud)
    const selectionMarker = document.createElement('div')
    selectionMarker.className = 'map-selection-marker'
    selectionMarker.style.position = 'absolute'
    selectionMarker.style.display = 'none'
    selectionMarker.style.pointerEvents = 'none'
    selectionMarker.style.zIndex = '1'
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'map-selection-label'
    label.textContent = 'Selected'
    label.setAttribute('aria-label', 'Selected')
    label.hidden = true
    label.style.pointerEvents = 'auto'
    label.addEventListener('click', () => {
      if (!this.selectedId) return
      label.blur()
      this.focus([this.selectedId])
    })
    selectionMarker.append(label)
    this.selectionMarkerElement = selectionMarker
    this.selectionMarkerLabel = label
    this.container.append(selectionMarker)
    this.setInteractionMode('2d')
    this.raycaster.params.Points ??= { threshold: 12 }
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('resize', this.resize)
    window.addEventListener('orientationchange', this.resize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClick)
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

  /** Keep the selected item visually anchored to its projected point. */
  setSelected(id: string | null): void {
    this.selectedId = id
    this.updateSelectedMarker()
  }

  setSelectionLabel(label: string): void {
    const text = label.trim() || 'Selected'
    this.selectionMarkerLabel.textContent = text
    this.selectionMarkerLabel.setAttribute('aria-label', text)
  }

  setPoints(points: CloudPoint[]): void {
    const previousBounds = this.pointBounds
    const nextBounds = cameraBoundsForPoints(points)
    const hadPoints = previousBounds !== null
    this.pointBounds = nextBounds
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
      colors[index * 3] = srgbByteToLinear(point.color[0])
      colors[index * 3 + 1] = srgbByteToLinear(point.color[1])
      colors[index * 3 + 2] = srgbByteToLinear(point.color[2])
    })
    this.geometry.dispose()
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.cloud.geometry = this.geometry
    this.rebuildConnectionLines()
    this.updateSelectedMarker()
    if (this.pointBounds && (!hadPoints || (this.overviewFit && !sameBounds(previousBounds, this.pointBounds)))) {
      this.overviewFit = true
      this.fitOverview()
    }
  }

  setColors(colors: Array<[number, number, number]>): void {
    if (colors.length !== this.ids.length) return
    const buffer = new Float32Array(colors.length * 3)
    colors.forEach((color, index) => {
      buffer[index * 3] = srgbByteToLinear(color[0])
      buffer[index * 3 + 1] = srgbByteToLinear(color[1])
      buffer[index * 3 + 2] = srgbByteToLinear(color[2])
    })
    this.geometry.setAttribute('color', new THREE.BufferAttribute(buffer, 3))
    this.updateConnectionNodeColors()
  }

  setView(mode: ViewMode): void {
    if (mode === this.mode && !this.transition) return
    const from = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    }
    const index = this.selectedId && !this.cameraManuallyControlled
      ? this.indexById.get(this.selectedId) : undefined
    let targetBounds = this.pointBounds ?? defaultBounds(mode)
    if (index != null) {
      const x = this.positions[index * 3]
      const y = this.positions[index * 3 + 1]
      const z = mode === '3d' ? this.zValues[index] : 0
      targetBounds = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z }
    }
    const to = poseFor(mode, this.camera.aspect, targetBounds)
    this.overviewFit = index == null
    this.focusedBounds = index == null ? null : targetBounds
    this.cameraManuallyControlled = false
    this.cameraAnim = null
    if (this.reducedMotion) {
      this.applyPose(to)
      this.mode = mode
      this.transition = null
      this.writeZ(mode === '3d' ? 1 : 0)
      this.setInteractionMode(mode)
      return
    }
    this.transition = { start: performance.now(), from, to, fromMode: this.mode, toMode: mode }
    this.mode = mode
    this.setInteractionMode(mode)
  }

  setLines(ids: string[], visible: boolean): void {
    const edges: GraphEdge[] = []
    for (let index = 0; index < ids.length - 1; index += 1) {
      const source = ids[index]
      const target = ids[index + 1]
      if (source && target) edges.push({ source, target, score: 1 })
    }
    this.setConnectionGraph(edges, visible, this.connectionTheme)
  }

  /** Render snapshot similarity connections whose endpoints are present in the cloud. */
  setConnectionGraph(edges: GraphEdge[], visible: boolean, theme: 'light' | 'dark'): void {
    this.connectionEdges = edges.filter((edge) => edge.source && edge.target && edge.source !== edge.target && Number.isFinite(edge.score))
    this.connectionVisible = visible
    this.connectionTheme = theme
    this.material.size = (this.container.clientWidth < 700 ? 9 : 5.5) * (visible && edges.length > 0 ? 0.5 : 1)
    this.rebuildConnectionLines()
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
    let minZ = Infinity
    let maxZ = -Infinity
    for (const index of indexes) {
      minX = Math.min(minX, this.positions[index * 3])
      maxX = Math.max(maxX, this.positions[index * 3])
      minY = Math.min(minY, this.positions[index * 3 + 1])
      maxY = Math.max(maxY, this.positions[index * 3 + 1])
      const z = this.mode === '3d' ? this.zValues[index] ?? 0 : 0
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    const fit = cameraFitForBounds({ minX, maxX, minY, maxY, minZ, maxZ }, {
      mode: this.mode,
      aspect: this.camera.aspect,
      fov: FOV_BY_MODE[this.mode],
      padding: 1.24,
      minDistance: this.mode === '2d' ? 110 : 130,
    })
    this.overviewFit = false
    this.focusedBounds = { minX, maxX, minY, maxY, minZ, maxZ }
    this.cameraManuallyControlled = false
    this.moveCamera(fit.position, fit.target)
  }

  reset(): void {
    this.overviewFit = true
    this.focusedBounds = null
    this.cameraManuallyControlled = false
    this.fitOverview()
  }

  /** Move the camera along its current view axis. factor < 1 zooms in. */
  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    )
    if (offset.lengthSq() < 1e-8) return
    this.overviewFit = false
    this.focusedBounds = null
    this.cameraManuallyControlled = true
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance))
    this.controls.update()
  }

  zoomIn(): void {
    this.zoomBy(0.8)
  }

  zoomOut(): void {
    this.zoomBy(1.25)
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
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.removeEventListener('click', this.onClick)
    this.renderer.domElement.removeEventListener('dblclick', this.onDoubleClick)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost)
    this.clearLines()
    this.controls.removeEventListener('start', this.onControlStart)
    this.controls.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.pointAlphaTexture.dispose()
    this.selectionMarkerElement.remove()
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
    this.material.size = (width < 700 ? 9 : 5.5) * (this.connectionVisible && this.connectionEdges.length > 0 ? 0.5 : 1)
    this.raycaster.params.Points.threshold = width < 700 ? 18 : 12
    const fitBounds = this.overviewFit
      ? this.pointBounds ?? defaultBounds(this.mode)
      : !this.cameraManuallyControlled ? this.focusedBounds : null
    if (fitBounds) {
      const pose = poseFor(this.mode, this.camera.aspect, fitBounds)
      if (this.transition) {
        this.transition.to = pose
      } else if (this.cameraAnim) {
        this.cameraAnim.toPosition = pose.position
        this.cameraAnim.toTarget = pose.target
      } else {
        this.applyPose(pose)
      }
    }
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
    // Project after damping and mode-transition depth writes so the DOM marker
    // remains anchored to the selected point during every camera movement.
    this.updateSelectedMarker()
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

  private fitOverview(): void {
    const pose = poseFor(this.mode, this.camera.aspect, this.pointBounds ?? defaultBounds(this.mode))
    this.moveCamera(pose.position, pose.target)
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.copy(pose.position)
    this.controls.target.copy(pose.target)
    this.camera.fov = pose.fov
    this.camera.updateProjectionMatrix()
  }

  private setInteractionMode(mode: ViewMode): void {
    const is3d = mode === '3d'
    this.controls.enableRotate = is3d
    this.controls.mouseButtons.LEFT = is3d ? MOUSE.ROTATE : MOUSE.PAN
    this.controls.mouseButtons.RIGHT = MOUSE.PAN
    this.controls.touches.ONE = is3d ? TOUCH.ROTATE : TOUCH.PAN
    this.controls.touches.TWO = TOUCH.DOLLY_PAN
  }

  private updateSelectedMarker(): void {
    const index = this.selectedId == null ? undefined : this.indexById.get(this.selectedId)
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (index == null || !position) {
      this.selectionMarkerElement.style.display = 'none'
      this.selectionMarkerLabel.hidden = true
      return
    }
    const source = position.array as Float32Array
    this.camera.updateMatrixWorld()
    const selectedWorld = new THREE.Vector3(
      source[index * 3] ?? 0,
      source[index * 3 + 1] ?? 0,
      source[index * 3 + 2] ?? 0,
    )
    const projected = new THREE.Vector3(
      selectedWorld.x,
      selectedWorld.y,
      selectedWorld.z,
    ).project(this.camera)
    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const containerRect = this.container.getBoundingClientRect()
    const inFrame = projected.z >= -1 && projected.z <= 1
      && projected.x >= -1 && projected.x <= 1
      && projected.y >= -1 && projected.y <= 1
    const directionX = Number.isFinite(projected.x) ? (projected.z > 1 ? -projected.x : projected.x) : 0
    const directionY = Number.isFinite(projected.y) ? (projected.z > 1 ? -projected.y : projected.y) : 0
    const inset = 20
    const minX = inset / Math.max(1, canvasRect.width) * 2 - 1
    const maxX = 1 - inset / Math.max(1, canvasRect.width) * 2
    const minY = inset / Math.max(1, canvasRect.height) * 2 - 1
    const maxY = 1 - inset / Math.max(1, canvasRect.height) * 2
    const anchorX = inFrame ? projected.x : THREE.MathUtils.clamp(directionX, minX, maxX)
    const anchorY = inFrame ? projected.y : THREE.MathUtils.clamp(directionY, minY, maxY)
    const left = canvasRect.left - containerRect.left + ((anchorX + 1) / 2) * canvasRect.width
    const top = canvasRect.top - containerRect.top + ((1 - anchorY) / 2) * canvasRect.height
    const distance = this.camera.position.distanceTo(selectedWorld)
    const showLabel = !inFrame || distance > 350
    const direction = !inFrame
      ? projected.x < -1 ? 'left' : projected.x > 1 ? 'right' : projected.y < -1 ? 'up' : projected.y > 1 ? 'down' : directionX < 0 ? 'left' : 'right'
      : ''
    this.selectionMarkerElement.style.left = `${left}px`
    this.selectionMarkerElement.style.top = `${top}px`
    this.selectionMarkerElement.dataset.offscreen = String(!inFrame)
    this.selectionMarkerElement.dataset.side = anchorX > 0.62 ? 'left' : 'right'
    this.selectionMarkerElement.dataset.direction = direction
    this.selectionMarkerLabel.hidden = !showLabel
    this.selectionMarkerElement.style.display = 'flex'
  }

  private writeZ(blend: number): void {
    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return
    const array = attribute.array as Float32Array
    for (let index = 0; index < this.zValues.length; index += 1) {
      array[index * 3 + 2] = this.zValues[index] * blend
    }
    attribute.needsUpdate = true
    this.updateConnectionLinePositions()
  }

  private rebuildConnectionLines(): void {
    this.clearLines()
    if (!this.connectionVisible || this.connectionEdges.length === 0) return
    const cloudPosition = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!cloudPosition) return
    const cloudArray = cloudPosition.array as Float32Array
    const present = this.connectionEdges.filter((edge) => {
      const source = this.indexById.get(edge.source)
      const target = this.indexById.get(edge.target)
      if (source == null || target == null) return false
      return [source, target].every((index) => [0, 1, 2].every((component) => Number.isFinite(cloudArray[index * 3 + component])))
    })
    if (present.length === 0) return
    const positions = new Float32Array(present.length * 6)
    const colors = new Float32Array(present.length * 6)
    const base = new THREE.Color(this.connectionTheme === 'dark' ? 0x86b9f2 : 0x1f67a7)
    const muted = new THREE.Color(this.connectionTheme === 'dark' ? 0x304b69 : 0x8ba8bd)
    present.forEach((edge, index) => {
      const source = this.indexById.get(edge.source)
      const target = this.indexById.get(edge.target)
      if (source == null || target == null) return
      const lineOffset = index * 6
      const sourceOffset = source * 3
      const targetOffset = target * 3
      positions[lineOffset] = cloudArray[sourceOffset] ?? 0
      positions[lineOffset + 1] = cloudArray[sourceOffset + 1] ?? 0
      positions[lineOffset + 2] = cloudArray[sourceOffset + 2] ?? 0
      positions[lineOffset + 3] = cloudArray[targetOffset] ?? 0
      positions[lineOffset + 4] = cloudArray[targetOffset + 1] ?? 0
      positions[lineOffset + 5] = cloudArray[targetOffset + 2] ?? 0
      const strength = THREE.MathUtils.clamp((edge.score - 0.2) / 0.8, 0, 1)
      const color = base.clone().lerp(muted, 0.45 * (1 - strength))
      colors[lineOffset] = color.r
      colors[lineOffset + 1] = color.g
      colors[lineOffset + 2] = color.b
      colors[lineOffset + 3] = color.r
      colors[lineOffset + 4] = color.g
      colors[lineOffset + 5] = color.b
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.56,
      depthTest: false,
      depthWrite: false,
    })
    this.lines = new THREE.LineSegments(geometry, material)
    this.lines.renderOrder = 1
    this.renderedConnectionEdges = present
    this.scene.add(this.lines)

    const nodeIds = [...new Set(present.flatMap((edge) => [edge.source, edge.target]))]
    const nodePositions = new Float32Array(nodeIds.length * 3)
    const nodeColors = new Float32Array(nodeIds.length * 3)
    const cloudColors = this.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (cloudColors) {
      const cloudColorArray = cloudColors.array as Float32Array
      nodeIds.forEach((id, index) => {
        const pointIndex = this.indexById.get(id)
        if (pointIndex == null) return
        const pointOffset = pointIndex * 3
        const nodeOffset = index * 3
        nodePositions[nodeOffset] = cloudArray[pointOffset] ?? 0
        nodePositions[nodeOffset + 1] = cloudArray[pointOffset + 1] ?? 0
        nodePositions[nodeOffset + 2] = cloudArray[pointOffset + 2] ?? 0
        nodeColors[nodeOffset] = cloudColorArray[pointOffset] ?? 1
        nodeColors[nodeOffset + 1] = cloudColorArray[pointOffset + 1] ?? 1
        nodeColors[nodeOffset + 2] = cloudColorArray[pointOffset + 2] ?? 1
      })
    }
    const nodeGeometry = new THREE.BufferGeometry()
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3))
    nodeGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3))
    const nodeMaterial = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: false,
      vertexColors: true,
      alphaMap: this.pointAlphaTexture,
      alphaTest: 0.1,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    })
    this.connectionNodes = new THREE.Points(nodeGeometry, nodeMaterial)
    this.connectionNodes.renderOrder = 2
    this.renderedConnectionNodeIds = nodeIds
    this.scene.add(this.connectionNodes)
  }

  private updateConnectionLinePositions(): void {
    if (!this.lines || this.renderedConnectionEdges.length === 0) return
    const linePosition = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const cloudPosition = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!linePosition || !cloudPosition) return
    const lineArray = linePosition.array as Float32Array
    const cloudArray = cloudPosition.array as Float32Array
    this.renderedConnectionEdges.forEach((edge, index) => {
      const source = this.indexById.get(edge.source)
      const target = this.indexById.get(edge.target)
      if (source == null || target == null) return
      const lineOffset = index * 6
      const sourceOffset = source * 3
      const targetOffset = target * 3
      lineArray[lineOffset] = cloudArray[sourceOffset] ?? 0
      lineArray[lineOffset + 1] = cloudArray[sourceOffset + 1] ?? 0
      lineArray[lineOffset + 2] = cloudArray[sourceOffset + 2] ?? 0
      lineArray[lineOffset + 3] = cloudArray[targetOffset] ?? 0
      lineArray[lineOffset + 4] = cloudArray[targetOffset + 1] ?? 0
      lineArray[lineOffset + 5] = cloudArray[targetOffset + 2] ?? 0
    })
    linePosition.needsUpdate = true
    if (this.connectionNodes && this.renderedConnectionNodeIds.length > 0) {
      const nodePosition = this.connectionNodes.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      if (!nodePosition) return
      const nodeArray = nodePosition.array as Float32Array
      this.renderedConnectionNodeIds.forEach((id, index) => {
        const pointIndex = this.indexById.get(id)
        if (pointIndex == null) return
        const pointOffset = pointIndex * 3
        const nodeOffset = index * 3
        nodeArray[nodeOffset] = cloudArray[pointOffset] ?? 0
        nodeArray[nodeOffset + 1] = cloudArray[pointOffset + 1] ?? 0
        nodeArray[nodeOffset + 2] = cloudArray[pointOffset + 2] ?? 0
      })
      nodePosition.needsUpdate = true
    }
  }

  private updateConnectionNodeColors(): void {
    if (!this.connectionNodes || this.renderedConnectionNodeIds.length === 0) return
    const nodeColor = this.connectionNodes.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    const cloudColor = this.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!nodeColor || !cloudColor) return
    const nodeArray = nodeColor.array as Float32Array
    const cloudArray = cloudColor.array as Float32Array
    this.renderedConnectionNodeIds.forEach((id, index) => {
      const pointIndex = this.indexById.get(id)
      if (pointIndex == null) return
      const pointOffset = pointIndex * 3
      const nodeOffset = index * 3
      nodeArray[nodeOffset] = cloudArray[pointOffset] ?? 1
      nodeArray[nodeOffset + 1] = cloudArray[pointOffset + 1] ?? 1
      nodeArray[nodeOffset + 2] = cloudArray[pointOffset + 2] ?? 1
    })
    nodeColor.needsUpdate = true
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
    const pickRadiusPixels = this.finePointer ? 12 : 18
    const distance = this.camera.position.distanceTo(this.controls.target)
    const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / rect.height
    this.raycaster.params.Points.threshold = THREE.MathUtils.clamp(worldPerPixel * pickRadiusPixels, 2, 24)
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObject(this.cloud)
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attribute) return null
    const positions = attribute.array as Float32Array
    let bestId: string | null = null
    let bestDistance = pickRadiusPixels * pickRadiusPixels
    for (const hit of hits) {
      if (hit.index == null) continue
      const projected = new THREE.Vector3(
        positions[hit.index * 3] ?? 0,
        positions[hit.index * 3 + 1] ?? 0,
        positions[hit.index * 3 + 2] ?? 0,
      ).project(this.camera)
      const screenX = ((projected.x + 1) / 2) * rect.width
      const screenY = ((1 - projected.y) / 2) * rect.height
      const screenDistance = (screenX - pointerX) ** 2 + (screenY - pointerY) ** 2
      if (screenDistance < bestDistance) {
        bestDistance = screenDistance
        bestId = this.ids[hit.index] ?? null
      }
    }
    return bestId
  }

  private clearLines(): void {
    this.renderedConnectionEdges = []
    this.renderedConnectionNodeIds = []
    if (this.lines) {
      this.scene.remove(this.lines)
      this.lines.geometry.dispose()
      ;(this.lines.material as THREE.Material).dispose()
      this.lines = null
    }
    if (this.connectionNodes) {
      this.scene.remove(this.connectionNodes)
      this.connectionNodes.geometry.dispose()
      ;(this.connectionNodes.material as THREE.Material).dispose()
      this.connectionNodes = null
    }
  }
}
