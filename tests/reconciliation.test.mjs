import {test} from 'node:test'
import assert from 'node:assert/strict'
import {scanWorkspace} from '../src/index.ts'

for(const kind of ['bind','new'])test('durable '+kind+' and compensating undo',async()=>{
  const id=crypto.randomUUID(), bytes=new TextEncoder().encode('\ufeff---\r\ncustom: 留\r\n---\r\n# 数学 🧮')
  const saved=bytes.slice()
  let manifest=JSON.stringify({version:2,documents:[{id,path:'old.md'}]})
  const files=[{path:'新/🧮.md',bytes}]
  const adapter=()=>({loadManifest:async()=>manifest,files:async()=>files,commit:async(expected,next)=>{assert.equal(expected,manifest);manifest=next}})
  const scan=action=>scanWorkspace(adapter(),action)
  const decision=(kind,document)=>{const m=JSON.parse(manifest);return {generation:m.generation,conflict:m.conflicts.at(-1).id,kind,document}}
  assert.deepEqual(await scan(),[])
  const stale=decision('new')
  await scan(decision('defer'))
  const deferred=manifest
  await scan()
  assert.equal(manifest,deferred)
  await assert.rejects(scan(stale),/review again/)
  await assert.rejects(scan(decision('bind',crypto.randomUUID())),/Unavailable/)
  const [record]=await scan(decision(kind,id))
  assert.equal(record.id===id,kind==='bind')
  assert.deepEqual(await scan(),[record])
  assert.deepEqual(await scan(decision('undo')),[])
  const m=JSON.parse(manifest)
  assert.equal(m.documents.length,1);assert.equal(m.documents[0].id,id)
  assert.equal(m.conflicts.at(-1).status,'pending')
  assert.deepEqual(m.history.map(d=>d.kind),['defer',kind,'undo'])
  assert.deepEqual(bytes,saved)
})
