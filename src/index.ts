import {extractKnowledge,resolveKnowledge,type Knowledge} from './knowledge.ts'
export {extractKnowledge,resolveKnowledge} from './knowledge.ts'
export type {Knowledge,Edge} from './knowledge.ts'
import {active,proposal,stateOf,undo,uuid,type Action} from './reconcile.ts'
export type {Action,Conflict,Decision,State} from './reconcile.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

export interface Entry { id: string; path: string; fileKey?: string; sha256?: string }
export interface DocumentRecord extends Entry { knowledge?:Knowledge; sha256: string; title: string; body: string }
export interface FileInput { path: string; bytes: Uint8Array<ArrayBuffer>; fileKey?: string }
export interface Workspace {
  previous?:DocumentRecord[]
  loadManifest(): Promise<string | null>
  files(): Promise<FileInput[]>
  // Adapter verifies the snapshot and expected manifest under its workspace lock.
  commit(expected: string | null, manifest: string, records: DocumentRecord[]): Promise<void>
}
export class ScanConflict extends Error {
  readonly diagnostics: {reason: string; paths: string[]}[]
  constructor(reason: string, paths: string[]) {
    super(reason + ': ' + paths.join(', '))
    this.diagnostics = [{reason, paths}]
  }
}
function validatePath(path: string) {
  if (typeof path !== 'string' || /[\\:\0]/.test(path) ||
      path.split('/').some(p => ['', '.', '..', '.git', '.collations'].includes(p.toLowerCase()))) {
    throw new ScanConflict('Invalid workspace path', [String(path)])
  }
}
function unique<T>(items: T[], key: (item: T) => string | undefined, path: (item: T) => string) {
  const seen = new Map<string,T>()
  for (const item of items) {
    const k = key(item)
    if (k === undefined) continue
    const prior = seen.get(k)
    if (prior) throw new ScanConflict('Duplicate identity or path', [path(prior), path(item)])
    seen.set(k,item)
  }
  return seen
}
function load(raw: string | null): Entry[] {
  if (raw === null) return []
  const m = JSON.parse(raw)
  if (![1,2,3].includes(m.version) || !Array.isArray(m.documents)) throw Error('Invalid Manifest version or documents')
  const entries: Entry[] = m.documents
  for (const e of entries) validateEntry(e)
  unique(entries,e=>e.id.toLowerCase(),e=>e.path)
  return entries
}
function validateEntry(e:Entry) {
    validatePath(e.path)
    if (!uuid(e.id) ||
        (e.fileKey !== undefined && (typeof e.fileKey !== 'string' || !e.fileKey)) ||
        (e.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(e.sha256))) {
      throw new ScanConflict('Invalid Manifest entry',[e.path])
    }
}
function indexTree(bytes:Uint8Array<ArrayBuffer>) {
  let text:string
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return undefined}
  return fromMarkdown(text)
}
function plain(node: Nodes): string {
  if ('value' in node) return node.value
  if (node.type === 'image') return node.alt ?? ''
  if ('children' in node) return node.children.map(plain).join(node.type === 'root' ? '\n' : '')
  return ''
}
const byPath = (a: {path:string},b: {path:string}) => a.path < b.path ? -1 : Number(a.path > b.path)

export async function scanWorkspace(workspace: Workspace, action?:Action, cache?:ReadonlyMap<string,DocumentRecord>): Promise<DocumentRecord[]> {
  const raw = await workspace.loadManifest()
  const old = load(raw)
  const state=stateOf(raw,validateEntry)
  if(action && action.generation!==state.generation)throw Error('Manifest changed; review again')
  const files = (await workspace.files()).sort(byPath)
  for (const f of files) validatePath(f.path)
  const pathKey = (f: {path:string}) => f.path.toLowerCase()
  const path = (f: {path:string}) => f.path
  const current = unique(files,pathKey,path)
  unique(files,f=>f.fileKey,path)
  const facts=new Map<string,{sha256:string;fileKey?:string}>()
  for(const f of files){
    const cached=cache?.get(f.path)
    const hash=cached?.sha256 ?? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',f.bytes)),b=>b.toString(16).padStart(2,'0')).join('')
    facts.set(f.path,{sha256:hash,fileKey:f.fileKey})
  }
  if(action?.kind==='undo')undo(state,action,old,facts)
  const oldPaths = unique(old,pathKey,path)
  const oldKeys = unique(old,e=>e.fileKey,path)
  const missing = old.filter(e=>!current.has(pathKey(e)))
  const matched = new Map<string,Entry>()
  const used = new Set<string>()
  for (const f of files) {
    const same = oldPaths.get(pathKey(f))
    const moved = f.fileKey ? oldKeys.get(f.fileKey) : undefined
    if (same && moved && same.id !== moved.id || moved && moved.path !== f.path && files.some(g=>g.path===moved.path)) {
      throw new ScanConflict('Conflicting file identity',[f.path,moved!.path])
    }
    if (same && same.path !== f.path && moved !== same) throw new ScanConflict('Ambiguous case change',[same.path,f.path])
    const e = same ?? moved
    if (e) {
      if (used.has(e.id)) throw new ScanConflict('Identity already matched',[e.path,f.path])
      used.add(e.id)
      matched.set(f.path,e)
    }
  }
  const unresolved = missing.filter(e=>!used.has(e.id))
  const reviewed=new Set<string>()
  const pending=new Map<string,ReturnType<typeof proposal>>()
  for(const f of files.filter(f=>!matched.has(f.path))){
    if(unresolved.length||state.conflicts.some(c=>active(c)&&c.path===f.path)){
      const c=proposal(state,f.path,facts.get(f.path)!.sha256,f.fileKey,[...unresolved].sort(byPath))
      reviewed.add(c.id);pending.set(f.path,c)
    }
  }
  for(const c of state.conflicts)if(active(c)&&!reviewed.has(c.id))c.status='stale'
  if(action && action.kind!=='undo'){
    const c=state.conflicts.find(c=>c.id===action.conflict && active(c))
    if(!c)throw Error('Conflict changed; review again')
    let prior:Entry|undefined
    let id:string|undefined
    if(action.kind==='defer')c.status='deferred'
    else{
      if(action.kind==='bind'){
        prior=c.candidates.find(e=>e.id===action.document)
        if(!prior || used.has(prior.id))throw Error('Unavailable candidate')
      }else if(action.kind!=='new')throw Error('Invalid decision')
      id=prior?.id??crypto.randomUUID()
      matched.set(c.path,{id,path:c.path});used.add(id)
      pending.delete(c.path);c.status='resolved'
      if(prior){
        for(const other of pending.values()){
          if(other.candidates.some(e=>e.id===id)){
            other.status='stale'
            proposal(state,other.path,other.sha256,other.fileKey,other.candidates.filter(e=>e.id!==id))
          }
        }
      }
    }
    state.history.push({generation:state.generation+1,kind:action.kind,conflict:c.id,document:id,before:prior})
  }
  const entries: Entry[] = unresolved.filter(e=>!used.has(e.id))
  const records: DocumentRecord[] = []
  for (const f of files) {
    if(pending.has(f.path))continue
    const cached=cache?.get(f.path)
    const tree = cached ? undefined : indexTree(f.bytes)
    const heading = tree?.children.find(n=>n.type === 'heading')
    const e = {id: matched.get(f.path)?.id ?? crypto.randomUUID(),path:f.path,fileKey:f.fileKey,
      sha256:facts.get(f.path)!.sha256}
    entries.push(e)
    records.push({...e,knowledge:cached?.knowledge ? structuredClone(cached.knowledge) : tree ? extractKnowledge(tree) : undefined,title:cached?.title ?? (heading ? plain(heading) : f.path.split('/').at(-1)!),body:cached?.body ?? (tree ? plain(tree) : '')})
  }
  resolveKnowledge(records,workspace.previous)
  const next={version:3,...state,documents:entries.sort(byPath)}
  if(JSON.stringify(next)!==JSON.stringify(raw ? JSON.parse(raw) : null))next.generation++
  const manifest=JSON.stringify(next,null,2)+'\n'
  await workspace.commit(raw,manifest,records)
  return records
}

export {parsePreview} from './preview.ts'

/** Caller creates the file exclusively and publishes this manifest under the workspace lock. */
export function registerCreatedDocument(raw:string,path:string) {
  validatePath(path)
  const docs=load(raw), state=stateOf(raw,validateEntry)
  if(JSON.parse(raw).version!==3 || !path.toLowerCase().endsWith('.md') ||
     docs.some(e=>e.path.toLowerCase()===path.toLowerCase()) ||
     state.conflicts.some(c=>active(c)&&c.path.toLowerCase()===path.toLowerCase()))throw Error('Unavailable document path')
  const id=crypto.randomUUID()
  docs.push({id,path})
  return {id,manifest:JSON.stringify({version:3,...state,generation:state.generation+1,documents:docs.sort(byPath)},null,2)+'\n'}
}
