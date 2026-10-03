// The tunnel's geometry on every screen the game is played on: always fully visible, never a lane too thin to follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWeb, SHAPES } from '../game/src/sim/web.js';
import { View } from '../game/src/render/view.js';
import { WORLDS } from '../game/src/sim/data.js';

const SIZES = [[360, 640], [390, 844], [412, 915], [820, 1180], [844, 390], [667, 375], [932, 430], [1100, 760], [1920, 1080], [2560, 1080], [320, 480]];
const SHAPES_USED = [...new Set(WORLDS.flatMap((w) => [...w.shapes, w.bossShape]))];

function play(W, H, shape, spins = false) {
  const web = makeWeb(shape, SHAPES[shape].lanes);
  const v = new View(null, null);
  v.setWeb(web, '#fff', spins);
  const short = H < 520 && W > H;
  if (short) v.layout(W, H, 34, 52);
  else v.layout(W, H, W < 520 ? 92 : 64, 96);
  return { web, v };
}

test('the tunnel is always whole on the screen, at every size and for every shape', () => {
  const p = [0, 0];
  for (const [W, H] of SIZES) {
    for (const shape of SHAPES_USED) {
      for (const spins of [false, true]) {
        if (spins && !SHAPES[shape].closed) continue;
        const { web, v } = play(W, H, shape, spins);
        for (let j = 0; j <= web.n; j++) {
          for (const z of [0, 1]) {
            v.B(j, z, p);
            assert.ok(p[0] >= -1 && p[0] <= W + 1 && p[1] >= -1 && p[1] <= H + 1, `${shape} at ${W}x${H}: a point at (${p[0].toFixed(0)}, ${p[1].toFixed(0)})`);
          }
        }
        assert.ok(Number.isFinite(v.Sx) && Number.isFinite(v.Sy) && v.Sx > 0 && v.Sy > 0);
        const ratio = Math.max(v.Sx / v.Sy, v.Sy / v.Sx);
        assert.ok(ratio <= 1.61, `${shape} at ${W}x${H} is stretched ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('lanes stay wide enough to follow on a phone', () => {
  for (const [W, H] of SIZES) {
    if (Math.min(W, H) < 360 || W < 360) continue;
    for (const shape of SHAPES_USED) {
      const { web, v } = play(W, H, shape);
      let min = Infinity;
      for (let i = 0; i < web.n; i++) {
        const a = web.rim[i];
        const b = web.rim[web.closed ? (i + 1) % web.n : i + 1];
        min = Math.min(min, Math.hypot((a[0] - b[0]) * v.Sx, (a[1] - b[1]) * v.Sy));
      }
      assert.ok(min >= 24, `${shape} at ${W}x${H}: the narrowest lane at the rim is ${min.toFixed(1)} px`);
    }
  }
});

test('a tall phone gets a taller tunnel and a wide window a wider one, never more than the limit', () => {
  const tall = play(390, 844, 'circle');
  assert.ok(tall.v.Sy > tall.v.Sx * 1.3, 'taller than it is wide');
  const wide = play(1100, 760, 'circle');
  assert.ok(wide.v.Sx > wide.v.Sy, 'wider than it is tall');
  const web = makeWeb('circle', 16);
  const square = new View(null, null);
  square.setWeb(web, '#fff', false);
  square.layout(800, 800, 14, 14);
  assert.ok(Math.abs(square.Sx - square.Sy) < 1e-6, 'a square screen keeps the circle');
});
