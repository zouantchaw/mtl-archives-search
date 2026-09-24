import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadedSnapshot } from './artifacts'
import type { ProjectionIndex } from './projection'
import { buildProjection } from './projection'
import type { MapLayoutSettings } from './MapSettings'
import { canonicalLayout, layoutConfig, LAYOUT_VERSION, projectLayout, PUBLISHED_LAYOUT, readLayout } from './layout-state'

type Coordinates = { ids: string[]; coordinates: Float32Array }
type Progress = { phase: string; progress: number }
export function useMapLayout(snapshot: LoadedSnapshot | null, loadVectors: (snapshot: LoadedSnapshot) => Promise<{matrix:Float32Array; dimensions:number}>) {
  const initial = useRef(readLayout(window.location.search))
  const [active,setActive] = useState<MapLayoutSettings>({ ...PUBLISHED_LAYOUT, mode: initial.current.settings.mode === 'time' ? 'time' : '2d' })
  const [projection,setProjection] = useState<ProjectionIndex|null>(null)
  const [busy,setBusy] = useState(false)
  const [progress,setProgress] = useState<Progress|null>(null)
  const [error,setError] = useState<string|null>(null)
  const [bootPending,setBootPending] = useState(true)
  const generation = useRef(0)
  const job = useRef<Worker|null>(null)
  const rejectJob = useRef<(() => void)|null>(null)
  const controller = useRef<AbortController|null>(null)
  const cache = useRef(new Map<string,Coordinates>())
  const loaded = useRef(loadVectors); loaded.current = loadVectors
  const cancel = useCallback(() => {
    generation.current++
    rejectJob.current?.(); rejectJob.current=null
    job.current?.terminate(); job.current=null
    controller.current?.abort(); controller.current=null
    setBusy(false); setProgress(null); setBootPending(false)
  },[])
  const apply = useCallback(async (requested:MapLayoutSettings) => {
    if (!snapshot) return
    cancel()
    const token = generation.current
    setError(null)
    setBusy(true); setProgress({phase:'loading',progress:0})
    try {
      const settings = canonicalLayout(requested)
      const base = buildProjection(snapshot.points)
      if (settings.preset === 'published' && settings.mode !== '3d') {
        setProjection(base); setActive(settings); return
      }
      const config = layoutConfig(settings)
      const key = `${snapshot.vectorSha256}:${JSON.stringify(config)}:${settings.preset === 'published' ? 'published' : 'computed'}`
      let result = cache.current.get(key)
      if (!result && settings.preset !== 'custom') {
        const abort = new AbortController(); controller.current=abort
        const response = await fetch(`/layouts/${settings.preset}-${config.dimensions}d.json`,{signal:abort.signal})
        if (!response.ok) throw new Error('preset-unavailable')
        const data = await response.json()
        if (data.vectorSha256 !== snapshot.vectorSha256 || data.version !== '1.4.0' || data.algorithm !== 'umap-js' || data.engineVersion !== LAYOUT_VERSION || data.nEpochs !== 200 || !data.config || Object.entries(config).some(([key,value]) => data.config[key] !== value) || !Array.isArray(data.ids) || !Array.isArray(data.coordinates) || data.coordinates.some((value:unknown) => typeof value !== 'number' || !Number.isFinite(value)) || data.ids.length !== snapshot.embeddingIds?.length || data.ids.some((id:string,i:number) => id !== snapshot.embeddingIds?.[i])) throw new Error('preset-mismatch')
        result={ids:data.ids,coordinates:new Float32Array(data.coordinates)}
      }
      if (!result) {
        const vectors=await loaded.current(snapshot)
        if(token!==generation.current)return
        const worker=new Worker(new URL('./layout.worker.ts',import.meta.url),{type:'module'}); job.current=worker
        result=await new Promise<Coordinates>((resolve,reject) => {
          rejectJob.current=()=>reject(new Error('cancelled'))
          worker.onmessage=(event) => {
            if(token!==generation.current)return
            const data=event.data
            if(data.type==='progress')setProgress({phase:data.phase,progress:data.progress})
            else if(data.type==='complete')resolve({ids:snapshot.embeddingIds ?? [],coordinates:data.coordinates})
            else if(data.type==='error')reject(new Error(data.message ?? 'layout-failed'))
          }
          worker.onerror=()=>reject(new Error('worker-failed'))
          // Copy preserves the shared matrix used by snapshot similarity and search webs.
          const matrix=vectors.matrix.slice()
          worker.postMessage({matrix,dimensions:vectors.dimensions,config},[matrix.buffer])
        })
      }
      if(token!==generation.current)return
      const next=projectLayout(base,result.ids,result.coordinates,settings)
      cache.current.set(key,result)
      if(cache.current.size>8)cache.current.delete(cache.current.keys().next().value!)
      setProjection(next); setActive(settings)
    } catch(failure) {
      if(token===generation.current) setError(failure instanceof Error ? failure.message : 'layout-failed')
    } finally {
      if(token===generation.current) {
        job.current?.terminate(); job.current=null; rejectJob.current=null
        setBusy(false);setProgress(null);setBootPending(false)
      }
    }
  },[snapshot,cancel])
  useEffect(() => {
    if(!snapshot)return
    setProjection(buildProjection(snapshot.points))
    if ((initial.current.snapshot && initial.current.snapshot!==snapshot.vectorSha256) || (initial.current.version && initial.current.version!==LAYOUT_VERSION)) {
      setError('shared-layout-mismatch');setBootPending(false);return
    }
    void apply(initial.current.settings)
    return cancel
  },[snapshot,apply,cancel])
  useEffect(()=>()=>{generation.current++;rejectJob.current?.();job.current?.terminate();controller.current?.abort()},[])
  return {active,projection,busy,progress,error,apply,cancel,urlSettings:bootPending?initial.current.settings:active,reset:()=>apply({...PUBLISHED_LAYOUT})}
}
