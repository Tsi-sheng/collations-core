import type {Nodes,Root} from 'mdast'
export interface Heading {label:string;anchor:string;offset:number;depth:number}
export interface Edge {raw:string;offset:number;wiki:boolean;target?:string;anchor?:string;status?:'resolved'|'missing'|'anchor'|'ambiguous';previous?:string}
export interface Knowledge {headings:Heading[];anchors:string[];links:Edge[]}
function label(n:Nodes):string{return 'value' in n?n.value:'children' in n?n.children.map(label).join(''):''}
export function extractKnowledge(tree:Root):Knowledge{
 const headings:Heading[]=[],anchors:string[]=[],links:Edge[]=[]
 const defs=new Map(tree.children.filter(n=>n.type==='definition').map(n=>[n.identifier,n.url]))
 function visit(n:Nodes){
  const offset=n.position?.start.offset??0
  if(n.type==='heading'){
   const text=label(n),base=text.trim().toLowerCase().replace(/\s+/g,'-')
   let anchor=base,i=0;while(anchors.includes(anchor))anchor=base+'-'+(++i)
   headings.push({label:text,anchor,offset,depth:n.depth});anchors.push(anchor)
  }
  if(n.type==='html'){const a=/<a\s+id=["']([^"']+)["']/i.exec(n.value);if(a)anchors.push(a[1])}
  if(n.type==='link'||n.type==='linkReference'){
   const raw=n.type==='link'?n.url:defs.get(n.identifier)
   if(raw&&!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw))links.push({raw,offset,wiki:false})
   return
  }
  if(n.type==='text'){
   for(const match of n.value.matchAll(/\[\[([^\]\n]+)\]\]/g))links.push({raw:match[1].split('|')[0],offset:offset+match.index!,wiki:true})
   const block=/\s\^([\w-]+)$/.exec(n.value);if(block)anchors.push(block[1])
  }
  if('children' in n)n.children.forEach(visit)
 }
 visit(tree);return {headings,anchors,links}
}
type Doc={id:string;path:string;knowledge?:Knowledge}
export function resolveKnowledge(docs:Doc[],prior:Doc[]=[]){
 const paths=new Map(docs.map(d=>[d.path.toLowerCase(),d])),old=new Map(prior.map(d=>[d.id,d]))
 const names=new Map<string,Doc[]>()
 for(const d of docs){const n=d.path.split('/').at(-1)!.toLowerCase();names.set(n,[...(names.get(n)??[]),d])}
 for(const d of docs)for(const link of d.knowledge?.links??[]){
  const [file,fragment]=link.raw.split('#');let candidates:Doc[]=[]
  try{
   let name=decodeURIComponent(file)
   if(link.wiki&&name&&!name.toLowerCase().endsWith('.md'))name+='.md'
   const url=new URL(name||'','https://workspace.invalid/'+d.path.split('/').map(encodeURIComponent).join('/'))
   const exact=paths.get(decodeURIComponent(url.pathname.slice(1)).toLowerCase())
   candidates=exact?[exact]:link.wiki&&!name.includes('/')?names.get(name.toLowerCase())??[]:[]
   link.anchor=decodeURIComponent(fragment??'').replace(/^\^/,'')
  }catch{link.status='missing';continue}
  const previous=old.get(d.id)?.knowledge?.links.find(e=>e.offset===link.offset&&e.raw===link.raw)
  link.target=candidates.length===1?candidates[0].id:undefined
  link.status=!candidates.length?'missing':candidates.length>1?'ambiguous':link.anchor&&!candidates[0].knowledge?.anchors.includes(link.anchor)?'anchor':'resolved'
  const was=previous?.target??previous?.previous
  link.previous=link.status==='missing'&&was&&docs.some(x=>x.id===was)?was:undefined
 }
}
