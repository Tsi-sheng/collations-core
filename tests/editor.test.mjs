import assert from 'node:assert/strict'
import test from 'node:test'
import {parsePreview,registerCreatedDocument} from '../src/index.ts'
test('preview distinguishes math, literal code and GFM',()=>{
  const ast=parsePreview('# A\n\n$x$ and `$y$`\n\n$$\nx^2\n$$\n\n| a |\n|---|\n| b |\n\n- [x] ~~ok~~\n\nhttps://example.org')
  const types=[]
  function visit(n){types.push(n.type);n.children?.forEach(visit)}
  visit(ast)
  for(const t of ['heading','inlineMath','inlineCode','math','table','delete','link'])assert.ok(types.includes(t),t)
})
test('save as creates an independent registration while retaining conflicts and history',()=>{
 const raw=JSON.stringify({version:3,generation:1,conflicts:[],history:[],documents:[{path:'a.md',id:crypto.randomUUID()}]})
 const {manifest,id}=registerCreatedDocument(raw,'数学/二.md')
 const next=JSON.parse(manifest)
 assert.equal(next.generation,2);assert.equal(next.documents.length,2)
 assert.notEqual(id,next.documents[0].id)
 assert.throws(()=>registerCreatedDocument(manifest,'数学/二.md'))
 assert.throws(()=>registerCreatedDocument(raw,'../escape.md'))
})
test('an invalid UTF-8 note retains its identity without blocking other notes',async()=>{
 const {scanWorkspace}=await import('../src/index.ts')
 const records=await scanWorkspace({loadManifest:async()=>null,files:async()=>[{path:'legacy.md',bytes:Uint8Array.of(255)},{path:'ok.md',bytes:new TextEncoder().encode('# Valid')}],commit:async()=>{}})
 assert.equal(records.length,2);assert.equal(records[0].body,'');assert.equal(records[1].title,'Valid')
})
