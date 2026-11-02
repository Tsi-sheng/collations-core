import type {Entry} from './index.ts'

type Status = 'pending'|'deferred'|'resolved'|'stale'
export interface Conflict {
  id:string; path:string; sha256:string; fileKey?:string; candidates:Entry[]; status:Status
}
export interface Decision {
  generation:number; conflict:string; kind:'bind'|'new'|'defer'|'undo'
  document?:string; before?:Entry
}
export interface Action { generation:number; conflict:string; kind:Decision['kind']; document?:string }
export interface State { generation:number; conflicts:Conflict[]; history:Decision[] }
export const active=(c:Conflict)=>c.status==='pending'||c.status==='deferred'
export const uuid=(s:unknown)=>typeof s==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)

export function stateOf(raw:string|null,validateEntry:(e:Entry)=>void):State {
  const m=raw ? JSON.parse(raw) : null
  if(m?.version!==3)return {generation:0,conflicts:[],history:[]}
  const {generation,conflicts,history}=m as State
  if(!Number.isSafeInteger(generation)||generation<1||!Array.isArray(conflicts)||!Array.isArray(history))throw Error('Invalid Manifest v3 state')
  const ids=new Set<string>(),paths=new Set<string>()
  for(const c of conflicts){
    validateEntry({id:c.id,path:c.path,fileKey:c.fileKey,sha256:c.sha256})
    if(!c.sha256||ids.has(c.id)||!['pending','deferred','resolved','stale'].includes(c.status)||!Array.isArray(c.candidates))throw Error('Invalid conflict')
    ids.add(c.id)
    if(active(c)&&paths.has(c.path.toLowerCase()))throw Error('Duplicate pending path')
    if(active(c))paths.add(c.path.toLowerCase())
    const candidates=new Set<string>()
    for(const e of c.candidates){validateEntry(e);if(candidates.has(e.id))throw Error('Duplicate candidate');candidates.add(e.id)}
  }
  let last=0
  for(const d of history){
    if(!ids.has(d.conflict)||!Number.isSafeInteger(d.generation)||d.generation<=last||d.generation>generation||
       !['bind','new','defer','undo'].includes(d.kind))throw Error('Invalid decision record')
    if(d.kind==='bind'||d.kind==='new'){if(!uuid(d.document))throw Error('Invalid decision identity')}
    if(d.before)validateEntry(d.before)
    if(d.kind==='bind' && (!d.before || d.before.id!==d.document))throw Error('Missing prior registration')
    last=d.generation
  }
  return {generation,conflicts,history}
}
export function proposal(state:State,path:string,sha256:string,fileKey:string|undefined,candidates:Entry[]):Conflict {
  const prior=state.conflicts.find(c=>active(c)&&c.path===path)
  if(prior && prior.sha256===sha256 && prior.fileKey===fileKey &&
     JSON.stringify(prior.candidates)===JSON.stringify(candidates))return prior
  if(prior)prior.status='stale'
  const c:Conflict={id:crypto.randomUUID(),path,sha256,fileKey,candidates,status:'pending'}
  state.conflicts.push(c)
  return c
}
export function undo(state:State,action:Action,entries:Entry[],files:Map<string,{sha256:string;fileKey?:string}>) {
  const c=state.conflicts.find(c=>c.id===action.conflict)
  const last=state.history.filter(d=>d.conflict===action.conflict).at(-1)
  if(!c||!last||last.kind==='undo'||c.status==='stale')throw Error('Decision cannot be undone')
  const f=files.get(c.path)
  if(!f||f.sha256!==c.sha256||f.fileKey!==c.fileKey)throw Error('Source changed; review again')
  if(last.document){
    const deps=state.history.filter(d=>d.generation>last.generation && d.document===last.document)
    if(deps.length)throw Error('Dependent decisions: '+deps.map(d=>d.generation).join(', '))
    const i=entries.findIndex(e=>e.id===last.document&&e.path===c.path)
    if(i<0 || last.before && (files.has(last.before.path)||entries.some(e=>e.path===last.before!.path)))throw Error('Prior identity unavailable')
    entries.splice(i,1)
    if(last.before)entries.push(last.before)
  }
  c.status='pending'
  state.history.push({generation:state.generation+1,kind:'undo',conflict:c.id,document:last.document})
}
