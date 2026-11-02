import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

export interface Entry { id: string; path: string; fileKey?: string; sha256?: string }
export interface DocumentRecord extends Entry { sha256: string; title: string; body: string }
export interface FileInput { path: string; bytes: Uint8Array<ArrayBuffer>; fileKey?: string }
export interface Workspace {
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
  if (![1,2].includes(m.version) || !Array.isArray(m.documents)) throw Error('Invalid Manifest version or documents')
  const entries: Entry[] = m.documents
  for (const e of entries) {
    validatePath(e.path)
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(e.id) ||
        (e.fileKey !== undefined && (typeof e.fileKey !== 'string' || !e.fileKey)) ||
        (e.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(e.sha256))) {
      throw new ScanConflict('Invalid Manifest entry',[e.path])
    }
  }
  unique(entries,e=>e.id.toLowerCase(),e=>e.path)
  return entries
}
function plain(node: Nodes): string {
  if ('value' in node) return node.value
  if (node.type === 'image') return node.alt ?? ''
  if ('children' in node) return node.children.map(plain).join(node.type === 'root' ? '\n' : '')
  return ''
}
const byPath = (a: {path:string},b: {path:string}) => a.path < b.path ? -1 : Number(a.path > b.path)

export async function scanWorkspace(workspace: Workspace): Promise<DocumentRecord[]> {
  const raw = await workspace.loadManifest()
  const old = load(raw)
  const files = (await workspace.files()).sort(byPath)
  for (const f of files) validatePath(f.path)
  const pathKey = (f: {path:string}) => f.path.toLowerCase()
  const path = (f: {path:string}) => f.path
  const current = unique(files,pathKey,path)
  unique(files,f=>f.fileKey,path)
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
  const unknown = files.filter(f=>!matched.has(f.path))
  if (unresolved.length && unknown.length) throw new ScanConflict('Unconfirmed move',[...unresolved,...unknown].map(path))
  const entries: Entry[] = [...unresolved]
  const records: DocumentRecord[] = []
  for (const f of files) {
    const tree = fromMarkdown(new TextDecoder('utf-8',{fatal:true}).decode(f.bytes))
    const heading = tree.children.find(n=>n.type === 'heading')
    const hash = await crypto.subtle.digest('SHA-256',f.bytes)
    const e = {id: matched.get(f.path)?.id ?? crypto.randomUUID(),path:f.path,fileKey:f.fileKey,
      sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}
    entries.push(e)
    records.push({...e,title:heading ? plain(heading) : f.path.split('/').at(-1)!,body:plain(tree)})
  }
  const manifest = JSON.stringify({version:2,documents:entries.sort(byPath)},null,2)+'\n'
  await workspace.commit(raw,manifest,records)
  return records
}
