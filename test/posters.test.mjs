// The store pictures: main.js with ?poster=<name> draws one frame with the real renderer and no room, and says when it is done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, newPage } from './fake-dom.mjs';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512], 'badge-first-win': [256, 256], 'badge-quick-sit': [256, 256], 'badge-chair-thief': [256, 256], 'badge-party-guest': [256, 256] };
let n = 0;

async function draw(name) {
  installGlobals();
  globalThis.location = { search: `?poster=${name}` };
  delete globalThis.document.body.dataset.ready;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const page = newPage(undefined, { hash: true });
  try {
    await import(`../game/main.js?poster${n++}`);
  } finally {
    console.error = orig;
    globalThis.location = { search: '' };
  }
  assert.deepEqual(errors, []);
  return page;
}

for (const [name, [w, h]] of Object.entries(SIZES)) {
  test(`poster ${name}: ${w}x${h}, drawn without a room or the SDK, ready, and the same every time`, async () => {
    const a = await draw(name);
    assert.equal(a.canvas.width, w);
    assert.equal(a.canvas.height, h);
    assert.equal(globalThis.document.body.dataset.ready, '1');
    assert.equal(a.canvas.ctx.depth, 0);
    const b = await draw(name);
    assert.equal(b.canvas.ctx.hash, a.canvas.ctx.hash, 'a fixed frame');
    assert.equal(globalThis.window.onceworlds, undefined);
  });
}

test('different pictures are different', async () => {
  const hashes = new Set();
  for (const name of Object.keys(SIZES)) hashes.add((await draw(name)).canvas.ctx.hash);
  assert.equal(hashes.size, Object.keys(SIZES).length);
});
