import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ArchiveRecord } from './data';

type PresetName = 'threshold' | 'layers' | 'viewpoint' | 'horizon';

type Props = {
  records: ArchiveRecord[];
  selected: ArchiveRecord;
  onSelect: (record: ArchiveRecord) => void;
};

const presets: Record<PresetName, { position: [number, number, number]; target: [number, number, number]; fov: number }> = {
  threshold: { position: [10.8, 4.1, 15.8], target: [0, 4.15, -0.8], fov: 40 },
  layers: { position: [0.2, 5.8, 16.8], target: [0, 4.7, -1.1], fov: 38 },
  viewpoint: { position: [-7.2, 6.15, 8.5], target: [-1.4, 5.1, -0.6], fov: 35 },
  horizon: { position: [8.7, 10.4, 13.4], target: [0, 4.6, -2.1], fov: 42 },
};

const presetLabels: Array<{ name: PresetName; label: string }> = [
  { name: 'threshold', label: 'Arrival sightline' },
  { name: 'layers', label: 'Atrium sequence' },
  { name: 'viewpoint', label: 'Landing view' },
  { name: 'horizon', label: 'Upper horizon' },
];

export function SpatialScene({ records, selected, onSelect }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selected.id);
  const [activePreset, setActivePreset] = useState<PresetName>('threshold');
  const [sceneState, setSceneState] = useState<'ready' | 'fallback'>('ready');
  const cameraMoveRef = useRef<((preset: PresetName) => void) | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedIdRef.current = selected.id;
  }, [selected.id]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setSceneState('fallback');
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0e0d);
    scene.fog = new THREE.FogExp2(0x0d0e0d, 0.026);
    const camera = new THREE.PerspectiveCamera(presets.threshold.fov, 1, 0.1, 100);
    camera.position.set(...presets.threshold.position);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 23;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minAzimuthAngle = -Math.PI * 0.46;
    controls.maxAzimuthAngle = Math.PI * 0.46;
    controls.target.set(...presets.threshold.target);

    const root = new THREE.Group();
    scene.add(root);

    const materials = {
      limestone: new THREE.MeshStandardMaterial({ color: 0x867969, roughness: 0.92 }),
      brick: new THREE.MeshStandardMaterial({ color: 0x6f4030, roughness: 0.88 }),
      oak: new THREE.MeshStandardMaterial({ color: 0x251a15, roughness: 0.72 }),
      copper: new THREE.MeshStandardMaterial({ color: 0xa45f3f, metalness: 0.72, roughness: 0.42 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x332e29, roughness: 0.94 }),
      window: new THREE.MeshStandardMaterial({ color: 0x0a0d0e, metalness: 0.25, roughness: 0.28 }),
      warmGlass: new THREE.MeshStandardMaterial({ color: 0x6f4129, emissive: 0x7a3216, emissiveIntensity: 1.2, roughness: 0.4 }),
      verde: new THREE.MeshStandardMaterial({ color: 0x263c35, roughness: 0.55 }),
      textile: new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 0.92, transparent: true, opacity: 0.62, side: THREE.DoubleSide }),
    };

    const geometries: THREE.BufferGeometry[] = [];
    const makeBox = (
      size: [number, number, number],
      position: [number, number, number],
      material: THREE.Material,
    ) => {
      const geometry = new THREE.BoxGeometry(...size);
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    makeBox([15, 0.25, 11], [0, -0.2, 0], materials.floor);
    makeBox([0.45, 9.5, 10.5], [-7.2, 4.55, -0.2], materials.limestone);
    makeBox([14.8, 9.5, 0.45], [0, 4.55, -5.2], materials.oak);
    makeBox([0.52, 9.5, 0.52], [7, 4.55, -4.85], materials.brick);

    for (const z of [-3.25, 0, 3.25]) {
      for (let level = 0; level < 4; level += 1) {
        const y = 1.35 + level * 2.15;
        makeBox([0.08, 1.18, 1.05], [-6.94, y + 0.38, z], materials.window);
        makeBox([0.11, 0.16, 1.28], [-6.88, y + 1.03, z], materials.limestone);
        makeBox([0.11, 1.42, 0.14], [-6.88, y + 0.38, z - 0.61], materials.limestone);
        makeBox([0.11, 1.42, 0.14], [-6.88, y + 0.38, z + 0.61], materials.limestone);
      }
    }

    for (let level = 0; level < 4; level += 1) {
      const y = 1.38 + level * 2.15;
      for (const x of [-4.9, 4.9]) {
        makeBox([2.7, 1.45, 0.12], [x, y + 0.3, -4.93], materials.window);
        makeBox([0.42, 1.7, 0.18], [x - 1.35, y + 0.32, -4.83], materials.brick);
        makeBox([0.42, 1.7, 0.18], [x + 1.35, y + 0.32, -4.83], materials.brick);
        makeBox([2.9, 0.12, 0.18], [x, y + 1.16, -4.83], materials.copper);
        makeBox([0.55, 0.12, 0.08], [x, y + 0.42, -4.7], materials.warmGlass);
      }
    }

    for (const z of [-4.7, -2.2, 0.3, 2.8, 5]) {
      makeBox([14.6, 0.16, 0.18], [0, 9.24, z], materials.oak);
    }
    makeBox([2.4, 1.02, 0.72], [4.65, 0.34, 3.55], materials.verde);
    makeBox([4.4, 0.035, 2.7], [-1.1, -0.03, 2.45], materials.oak);

    for (let level = 0; level < 4; level += 1) {
      const y = 1.55 + level * 2.15;
      makeBox([4.4, 0.14, 2.4], [-4.8, y, -1.8], materials.oak);
      makeBox([4.4, 0.14, 2.4], [4.8, y, -1.8], materials.oak);
      makeBox([4.25, 0.06, 0.08], [-4.8, y + 0.82, -0.67], materials.copper);
      makeBox([4.25, 0.06, 0.08], [4.8, y + 0.82, -0.67], materials.copper);
      for (const x of [-6.75, -5.45, -4.15, -2.85, 2.85, 4.15, 5.45, 6.75]) {
        makeBox([0.035, 0.84, 0.035], [x, y + 0.42, -0.67], materials.copper);
      }
    }

    const stairMaterial = materials.oak;
    for (let i = 0; i < 15; i += 1) {
      makeBox([2.7, 0.13, 0.45], [4.1 - i * 0.13, 0.05 + i * 0.13, 2.3 - i * 0.32], stairMaterial);
    }
    for (let i = 0; i < 15; i += 1) {
      makeBox([2.7, 0.13, 0.45], [-2.25 + i * 0.13, 2.05 + i * 0.13, -2.2 + i * 0.32], stairMaterial);
    }

    const textureLoader = new THREE.TextureLoader();
    const planeMeshes: THREE.Mesh[] = [];
    const workPlacements = [
      { recordId: 11, position: [-2.85, 2.25, 1.1] as [number, number, number], size: [2.65, 1.95] as [number, number], rotationY: 0.08 },
      { recordId: 17, position: [-1.25, 5.55, 0.3] as [number, number, number], size: [2.3, 3.15] as [number, number], rotationY: -0.04 },
      { recordId: 54, position: [1.45, 6.35, -0.45] as [number, number, number], size: [1.9, 2.7] as [number, number], rotationY: 0.05 },
      { recordId: 88, position: [2.8, 2.75, -1.15] as [number, number, number], size: [2.55, 1.82] as [number, number], rotationY: -0.08 },
    ];
    const workMeshes: Array<{ recordId: number; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; frameMaterial: THREE.MeshStandardMaterial }> = [];
    workPlacements.forEach((placement) => {
      const record = records.find((item) => item.id === placement.recordId);
      if (!record) return;
      const texture = textureLoader.load(record.image);
      texture.colorSpace = THREE.SRGBColorSpace;
      const imageMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0x2c211b,
        emissiveIntensity: 0.18,
        color: 0xf1e8d8,
        transparent: true,
        opacity: 1,
        roughness: 0.76,
        side: THREE.DoubleSide,
      });
      const [width, height] = placement.size;
      const backingGeometry = new THREE.PlaneGeometry(width + 0.22, height + 0.22);
      geometries.push(backingGeometry);
      const backing = new THREE.Mesh(backingGeometry, materials.textile);
      backing.position.set(placement.position[0], placement.position[1], placement.position[2] - 0.07);
      backing.rotation.y = placement.rotationY;
      root.add(backing);

      const geometry = new THREE.PlaneGeometry(width, height);
      geometries.push(geometry);
      const plane = new THREE.Mesh(geometry, imageMaterial);
      plane.position.set(...placement.position);
      plane.rotation.y = placement.rotationY;
      plane.userData.recordId = record.id;
      plane.castShadow = true;
      root.add(plane);
      planeMeshes.push(plane);

      const frameMaterial = materials.copper.clone();
      frameMaterial.emissive = new THREE.Color(0x32140b);
      frameMaterial.emissiveIntensity = 0.25;
      makeBox([width + 0.18, 0.055, 0.07], [placement.position[0], placement.position[1] + height / 2 + 0.055, placement.position[2] + 0.01], frameMaterial).rotation.y = placement.rotationY;
      makeBox([width + 0.18, 0.055, 0.07], [placement.position[0], placement.position[1] - height / 2 - 0.055, placement.position[2] + 0.01], frameMaterial).rotation.y = placement.rotationY;
      workMeshes.push({ recordId: record.id, mesh: plane, material: imageMaterial, frameMaterial });

      for (const cableX of [placement.position[0] - width * 0.34, placement.position[0] + width * 0.34]) {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cableX, placement.position[1] + height / 2, placement.position[2]),
          new THREE.Vector3(cableX, 9.18, placement.position[2]),
        ]);
        geometries.push(lineGeometry);
        root.add(new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xb46f4a, transparent: true, opacity: 0.76 })));
      }
    });

    const ambient = new THREE.HemisphereLight(0xf0dec2, 0x241b17, 2.5);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffd3a3, 4.6);
    key.position.set(-4, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    for (const x of [-5.7, 5.7]) {
      for (const y of [1.5, 3.65, 5.8, 7.95]) {
        const light = new THREE.PointLight(0xffa759, 1.8, 5.4, 2);
        light.position.set(x, y, -2);
        scene.add(light);
      }
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerStart = new THREE.Vector2();
    const handlePointerDown = (event: PointerEvent) => {
      pointerStart.set(event.clientX, event.clientY);
    };
    const handlePointer = (event: PointerEvent) => {
      if (pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(planeMeshes, false)[0];
      if (!hit) return;
      const record = records.find((item) => item.id === hit.object.userData.recordId);
      if (record) onSelectRef.current(record);
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointer);

    let animationFrame = 0;
    let disposed = false;
    let documentVisible = document.visibilityState === 'visible';
    let inViewport = false;
    let tween: { start: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; fovFrom: number; fovTo: number } | null = null;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cameraMoveRef.current = (name) => {
      const next = presets[name];
      if (prefersReducedMotion) {
        camera.position.set(...next.position);
        controls.target.set(...next.target);
        camera.fov = next.fov;
        camera.updateProjectionMatrix();
        controls.update();
        return;
      }
      tween = {
        start: performance.now(),
        from: camera.position.clone(),
        to: new THREE.Vector3(...next.position),
        targetFrom: controls.target.clone(),
        targetTo: new THREE.Vector3(...next.target),
        fovFrom: camera.fov,
        fovTo: next.fov,
      };
    };

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const animate = (now: number) => {
      animationFrame = 0;
      if (disposed || !documentVisible || !inViewport) return;
      if (tween) {
        const progress = Math.min((now - tween.start) / 950, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(tween.from, tween.to, eased);
        controls.target.lerpVectors(tween.targetFrom, tween.targetTo, eased);
        camera.fov = THREE.MathUtils.lerp(tween.fovFrom, tween.fovTo, eased);
        camera.updateProjectionMatrix();
        if (progress === 1) tween = null;
      }
      workMeshes.forEach((work) => {
        const active = work.recordId === selectedIdRef.current;
        work.material.opacity = THREE.MathUtils.lerp(work.material.opacity, active ? 1 : 0.72, 0.08);
        work.material.emissiveIntensity = THREE.MathUtils.lerp(work.material.emissiveIntensity, active ? 0.48 : 0.12, 0.08);
        work.frameMaterial.emissiveIntensity = THREE.MathUtils.lerp(work.frameMaterial.emissiveIntensity, active ? 1.15 : 0.2, 0.08);
        const scale = THREE.MathUtils.lerp(work.mesh.scale.x, active ? 1.035 : 1, 0.08);
        work.mesh.scale.setScalar(scale);
      });
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };

    const requestRender = () => {
      if (!disposed && documentVisible && inViewport && !animationFrame) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry.isIntersecting;
        if (inViewport) requestRender();
        else if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
      },
      { rootMargin: '120px 0px' },
    );
    visibilityObserver.observe(mount);

    const onVisibility = () => {
      documentVisible = document.visibilityState === 'visible';
      if (documentVisible) requestRender();
      else if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      teardown();
      setSceneState('fallback');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    function teardown() {
      if (disposed) return;
      disposed = true;
      cameraMoveRef.current = null;
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointer);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.Line;
        if (!renderable.material) return;
        const mats = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        mats.forEach((material) => {
          if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
          material.dispose();
        });
      });
      geometries.forEach((geometry) => geometry.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    }

    return teardown;
  }, [records]);

  const changePreset = (name: PresetName) => {
    setActivePreset(name);
    cameraMoveRef.current?.(name);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const index = Number(event.key) - 1;
    if (index >= 0 && index < presetLabels.length) changePreset(presetLabels[index].name);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const current = presetLabels.findIndex((item) => item.name === activePreset);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = (current + delta + presetLabels.length) % presetLabels.length;
      changePreset(presetLabels[next].name);
    }
  };

  return (
    <div className="scene-shell" onKeyDown={handleKeyDown}>
      {sceneState === 'fallback' ? (
        <div className="scene-fallback" role="img" aria-label="Conceptual atrium with suspended archive works">
          <img src={selected.image} alt="" />
          <p>The spatial study is unavailable in this browser. The selected archive record remains available for review.</p>
        </div>
      ) : (
        <div ref={mountRef} className="scene-canvas" aria-hidden="true" />
      )}
      <div className="scene-heading">
        <h2>Read the street<br />through the<br />building</h2>
        <p>Arrival sightline. Atrium sequence. Landing view. Upper horizon.</p>
      </div>
      <div className="scene-disclaimer">Conceptual massing · not a measured survey</div>
      <div className="camera-rail" role="group" aria-label="Spatial study camera positions">
        {presetLabels.map((preset, index) => (
          <button
            key={preset.name}
            className={activePreset === preset.name ? 'active' : ''}
            onClick={() => changePreset(preset.name)}
            aria-pressed={activePreset === preset.name}
          >
            <span>0{index + 1}</span>{preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
