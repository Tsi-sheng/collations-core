import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePreview,extractKnowledge,resolveKnowledge} from '../src/index.ts'
const note=(id,path,text)=>({id,path,knowledge:extractKnowledge(parsePreview(text))})
test('saved links resolve against current identities and ignore literal examples',()=>{
 const a=note('a','笔记.md','[证明][p] [[定义|别名]] `[[代码]]`\n\n[p]: A/证明.md#结果\n\n~~~\n[[忽略]]\n~~~')
 const b=note('b','A/证明.md','# 结果'),c=note('c','A/定义.md',''),d=note('d','B/定义.md','')
 const docs=[a,b,c,d];resolveKnowledge(docs)
 assert.deepEqual(a.knowledge.links.map(e=>e.status),['resolved','ambiguous'])
 const prior=structuredClone(docs);b.path='B/证明.md';resolveKnowledge(docs,prior)
 assert.equal(a.knowledge.links[0].previous,'b')
 b.path='A/证明.md';b.knowledge.anchors=[];resolveKnowledge(docs);assert.equal(a.knowledge.links[0].status,'anchor')
})
