declare module 'umap-js' {
  export class UMAP {
    constructor(options?: {
      nComponents?: number
      nNeighbors?: number
      minDist?: number
      spread?: number
      distanceFn?: (left: number[], right: number[]) => number
      random?: () => number
    })
    fit(data: number[][]): number[][]
  }
}
