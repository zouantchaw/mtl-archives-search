import { describe, expect, it } from 'vitest'
import { canonicalLayout, LAYOUT_VERSION, projectLayout, PUBLISHED_LAYOUT, readLayout, writeLayout } from './layout-state'
import { buildProjection } from './projection'

const base = buildProjection(['a','b','c'].map((id,i)=>({id,x:i/3,y:i/4,name:id,date:'1930',imageUrl:null,caption:null})))
describe('research layouts',()=>{
  it('round trips custom layout settings with the snapshot and ordinary search state',()=>{
    const settings={preset:'custom' as const,mode:'3d' as const,nNeighbors:27,minDist:.35,seed:109}
    const search=writeLayout('?q=tramway&selected=a',settings,'sha256')
    expect(readLayout(search)).toEqual({settings,snapshot:'sha256',version:LAYOUT_VERSION})
    expect(new URLSearchParams(search).get('selected')).toBe('a')
  })
  it('keeps old 3d links as date depth and rejects invalid or spoofed preset parameters',()=>{
    expect(readLayout('?view=3d').settings.mode).toBe('time')
    expect(readLayout('?layout=custom&neighbors=999999').settings).toEqual(PUBLISHED_LAYOUT)
    expect(canonicalLayout({...PUBLISHED_LAYOUT,preset:'broad',nNeighbors:12,seed:99})).toEqual({...PUBLISHED_LAYOUT,preset:'broad',nNeighbors:40,minDist:.3})
  })
  it('keeps id association and uses uniform scale across three dimensions',()=>{
    const result=projectLayout(base,['c','a','b'],new Float32Array([0,0,0, 2,4,8, 1,2,4]),{...PUBLISHED_LAYOUT,mode:'3d'})
    expect(result.byId.get('a')!.z-result.byId.get('c')!.z).toBe(1000)
    expect(result.byId.get('a')!.x-result.byId.get('c')!.x).toBe(250)
    expect(result.byId.get('a')!.name).toBe('a')
    expect(base.byId.get('a')!.x).toBe(0)
  })
  it('retains date depth for time mode and fails closed on invalid artifacts',()=>{
    const coords=new Float32Array([0,0,1,1,2,2])
    const settings={...PUBLISHED_LAYOUT,mode:'time' as const}
    expect(projectLayout(base,['a','b','c'],coords,settings).byId.get('a')!.z).toBe(base.byId.get('a')!.z)
    expect(()=>projectLayout(base,['a','a','c'],coords,settings)).toThrow()
    expect(()=>projectLayout(base,['a','b','c'],new Float32Array([NaN,0,1,1,2,2]),settings)).toThrow()
    expect(()=>projectLayout(base,['a','b'],coords,settings)).toThrow()
  })
})

import { resultsToCsv, resultsToJson } from './export-results'
it('includes reproducible layout metadata in exports',()=>{
  const context={snapshot:'hash',layout:{...PUBLISHED_LAYOUT,version:LAYOUT_VERSION},viewUrl:'https://example.test/?layout=published'}
  const csv=resultsToCsv([],context)
  expect(csv).toContain('snapshot_sha256,layout_json,view_url')
  expect(JSON.parse(resultsToJson({exportedAt:'today',query:'',searchMode:'smart',returnedCount:0,snapshotCount:3,rows:[],...context}))).toMatchObject(context)
})
