import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rename,rm,stat,readdir,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {scanWorkspace} from '../src/index.ts'

test('v1 migration, physical SQLite rebuild, identity and recovery',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'秩笺-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const file=p=>join(dir,p)
  const source=Buffer.from('\ufeff---\r\nunknown: 保留\r\n---\r\n# 标题\r\n')
  const id=crypto.randomUUID()
  const v1=JSON.stringify({version:1,documents:[{id,path:'a.md'}]})
  await writeFile(file('documents.json'),v1)
  await writeFile(file('a.md'),source)
  await copyFile(file('a.md'),file('b.md'))
  let interrupt=false, indexFailure=false, keys=true
  const ws={
    loadManifest:()=>readFile(file('documents.json'),'utf8'),
    async files(){
      const files=[]
      for(const path of await readdir(dir)){
        if(!path.endsWith('.md'))continue
        const bytes=await readFile(file(path))
        if(interrupt)throw Error('interrupted')
        files.push({path,bytes,fileKey:keys ? String((await stat(file(path),{bigint:true})).ino):undefined})
      }
      return files
    },
    async commit(expected,next,records){
      assert.equal(await this.loadManifest(),expected)
      if(expected===v1)await writeFile(file('backup'),expected)
      await writeFile(file('documents.json'),next)
      const db=new DatabaseSync(file('index.sqlite'))
      try{
        db.exec('CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY,data TEXT); BEGIN; DELETE FROM docs')
        for(const r of records)db.prepare('INSERT INTO docs VALUES(?,?)').run(r.id,JSON.stringify(r))
        if(indexFailure)throw Error('index transaction failed')
        db.exec('COMMIT')
      }finally{db.close()}
    }
  }
  const readIndex=()=>{const db=new DatabaseSync(file('index.sqlite'));try{return db.prepare('SELECT * FROM docs ORDER BY id').all()}finally{db.close()}}
  const first=await scanWorkspace(ws)
  assert.equal(first[0].id,id)
  assert.notEqual(first[0].id,first[1].id)
  assert.equal(first[0].sha256,first[1].sha256)
  assert.deepEqual(await readFile(file('a.md')),source)
  assert.equal(await readFile(file('backup'),'utf8'),v1)
  const before=readIndex()
  await rm(file('index.sqlite'))
  assert.deepEqual(await scanWorkspace(ws),first)
  assert.deepEqual(readIndex(),before)
  interrupt=true
  await assert.rejects(scanWorkspace(ws),/interrupted/)
  interrupt=false
  await rename(file('a.md'),file('moved.md'))
  assert.equal((await scanWorkspace(ws)).find(r=>r.path==='moved.md').id,id)
  const stable=readIndex()
  await writeFile(file('moved.md'),'# edited')
  indexFailure=true
  await assert.rejects(scanWorkspace(ws),/transaction failed/)
  assert.deepEqual(readIndex(),stable)
  indexFailure=false
  assert.equal((await scanWorkspace(ws)).find(r=>r.id===id).title,'edited')
  keys=false
  await rename(file('moved.md'),file('unknown.md'))
  const manifest=await ws.loadManifest()
  await assert.rejects(scanWorkspace(ws),/Unconfirmed move/)
  assert.equal(await ws.loadManifest(),manifest)
  await writeFile(file('documents.json'),'{broken')
  await assert.rejects(scanWorkspace(ws),SyntaxError)
  assert.equal(await ws.loadManifest(),'{broken')
})
test('hard links, case collisions, path swaps and duplicate UUIDs stop publication',async()=>{
  const old=['a.md','b.md'].map((path,i)=>({path,id:crypto.randomUUID(),fileKey:String(i)}))
  for(const [entries,files] of [
    [old,[{path:'a.md',fileKey:'1'},{path:'b.md',fileKey:'0'}]],
    [[],[{path:'a.md',fileKey:'x'},{path:'b.md',fileKey:'x'}]],
    [[],[{path:'A.md'},{path:'a.md'}]],
    [[old[0],{...old[1],id:old[0].id}],[]]
  ]){
    let writes=0
    await assert.rejects(scanWorkspace({loadManifest:async()=>JSON.stringify({version:2,documents:entries}),files:async()=>files,commit:async()=>{writes++}}),/Conflicting|Duplicate/)
    assert.equal(writes,0)
  }
})
