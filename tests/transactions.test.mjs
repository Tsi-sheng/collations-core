import assert from 'node:assert/strict'
import test from 'node:test'
import {scanWorkspace} from '../src/index.ts'

test('only one decision commits against a shared generation; changed evidence invalidates review',async()=>{
  const old={id:crypto.randomUUID(),path:'笔记.md'}
  let raw=JSON.stringify({version:2,documents:[old]})
  let bytes=new TextEncoder().encode('v1')
  const workspace={loadManifest:async()=>raw,files:async()=>[{path:'外部/更新.md',bytes}],commit:async(expected,next)=>{
    if(expected!==raw)throw Error('Compare-and-swap rejected');raw=next
  }}
  await scanWorkspace(workspace)
  const proposal=JSON.parse(raw)
  const action={conflict:proposal.conflicts[0].id,generation:proposal.generation,kind:'bind',document:old.id}
  bytes=new TextEncoder().encode('v2')
  await assert.rejects(scanWorkspace(workspace,action),/review again/)
  await scanWorkspace(workspace)
  const updated=JSON.parse(raw)
  assert.equal(updated.conflicts[0].status,'stale');assert.equal(updated.conflicts[1].status,'pending')
  const fresh={...action,conflict:updated.conflicts[1].id,generation:updated.generation}
  const results=await Promise.allSettled([scanWorkspace(workspace,fresh),scanWorkspace(workspace,{...fresh,kind:'new'})])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(JSON.parse(raw).history.length,1)
})

test('incremental records converge with a full scan after repeated dirty hints and batch moves',async()=>{
  let raw=null
  const input=(path,text,fileKey)=>({path,fileKey,bytes:new TextEncoder().encode(text)})
  let files=[input('a.md','# Alpha','1'),input('b.md','# Beta','2')]
  const ws={loadManifest:async()=>raw,files:async()=>files,commit:async(expected,next)=>{assert.equal(raw,expected);raw=next}}
  const initial=await scanWorkspace(ws)
  files[0]=input('a.md','# Edited','1')
  const incremental=await scanWorkspace(ws,undefined,new Map([['b.md',initial[1]]]))
  assert.deepEqual(await scanWorkspace(ws),incremental)
  files=[input('第二/二.md','# Beta','2'),input('第一/一.md','# Edited','1')]
  const moved=await scanWorkspace(ws)
  assert.deepEqual(new Set(moved.map(r=>r.id)),new Set(initial.map(r=>r.id)))
  assert.deepEqual(await scanWorkspace(ws),moved)
})
