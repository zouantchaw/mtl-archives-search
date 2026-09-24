import { computeLayoutAsync, type LayoutWorkerInput, type LayoutWorkerOutput } from './layout-engine'

type WorkerScope = {
  onmessage: ((event: MessageEvent<LayoutWorkerInput>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  addEventListener: (type: string, listener: (event: MessageEvent<{ type?: string }>) => void) => void
}

const scope = self as unknown as WorkerScope
let canceled = false

scope.onmessage = async (event: MessageEvent<LayoutWorkerInput>) => {
  canceled = false
  try {
    const input = event.data
    const coordinates = await computeLayoutAsync(
      input.matrix,
      input.dimensions,
      input.config,
      (progress, phase) => scope.postMessage({ type: 'progress', progress, phase } satisfies LayoutWorkerOutput),
      () => canceled,
    )
    if (coordinates == null || canceled) return
    scope.postMessage({ type: 'complete', coordinates } satisfies LayoutWorkerOutput, [coordinates.buffer])
  } catch (error) {
    if (canceled) return
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    scope.postMessage({ type: 'error', message, stack } satisfies LayoutWorkerOutput)
  }
}

// A caller normally cancels by terminating this worker. This handler also
// makes an explicit cancel message useful for embedding the worker directly.
scope.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type === 'cancel') canceled = true
})
