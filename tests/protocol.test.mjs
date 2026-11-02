import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../examples/analysis/', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('both compositions resolve every source and share the anchored proof', async () => {
  const { documents } = JSON.parse(await read('.collations/documents.json'));
  const sources = new Map();
  for (const { id, path } of documents) sources.set(id, await read(path));
  assert.equal(sources.size, documents.length);
  for (const title of ['讲义', '证明选编']) {
    const manifest = await read(title + '.yaml');
    const chapters = [...manifest.matchAll(/^  - document: (.+)(?:\n    block: (.+))?/gm)];
    assert.equal(chapters.length, title === '讲义' ? 2 : 1);
    for (const [, id, block] of chapters) {
      assert.ok(sources.has(id));
      if (block) assert.ok(sources.get(id).includes('<a id="' + block + '"></a>'));
    }
    assert.equal(chapters.at(-1)[2], 'sup-proof');
  }
});

test('relative references resolve except the intentional migration diagnostic', async () => {
  const { documents } = JSON.parse(await read('.collations/documents.json'));
  const missing = [];
  for (const { path } of documents) {
    const source = new URL(path, root);
    for (const [, href] of (await read(path)).matchAll(/\]\(([^)]+)\)/g)) {
      const target = new URL(href, source);
      const fragment = target.hash.slice(1);
      target.hash = '';
      const body = await readFile(target, 'utf8');
      if (fragment && !body.includes('id="' + fragment + '"')) missing.push(href);
    }
  }
  assert.deepEqual(missing, ['证明/上确界.md#obsolete']);
});
