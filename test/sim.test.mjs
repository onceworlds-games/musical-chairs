import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H, RADIUS, OBSTACLES, rng } from '../game/rules.js';
import {
  MAX_SPEED, BUMP_CD, KNOCK_DIST, SIT_R, WOBBLE, makeActor, stepActor, tryBump, knock,
} from '../game/sim.js';
import { World, makeField, canSit, Practice, syncField } from '../game/world.js';
import { makeBrain, thinkBot } from '../game/bots.js';

const DT = 1 / 60;
const run = (a, mx, my, seconds, env = { list: [a], field: makeField() }) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepActor(a, mx, my, DT, env);
};

test('a character speeds up to 5.5 units a second and no faster, diagonals included', () => {
  const a = makeActor('a', 'me', 10, 6);
  let top = 0;
  for (let i = 0; i < 20; i++) {
    stepActor(a, 1, 1, DT, { list: [a], field: makeField() }); // asking for more than length 1
    top = Math.max(top, Math.hypot(a.vx, a.vy));
    assert.ok(Math.hypot(a.vx, a.vy) <= MAX_SPEED + 1e-9);
  }
  assert.ok(top > MAX_SPEED - 0.01);
  const b = makeActor('b', 'me', 2, 6);
  stepActor(b, 1, 0, DT, { list: [b], field: makeField() });
  assert.ok(b.vx > 0.5 && b.vx < 0.7, `35 units/s^2 for a sixtieth of a second: ${b.vx}`);
});

test('letting go stops quickly', () => {
  const a = makeActor('a', 'me', 5, 6);
  run(a, 1, 0, 0.5);
  assert.ok(a.vx > 5);
  run(a, 0, 0, 0.12);
  assert.equal(a.vx, 0);
});

test('walls keep everyone in the room, even when running at them for a long time', () => {
  for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    const a = makeActor('a', 'me', 10, 6);
    run(a, mx, my, 4);
    assert.ok(a.x >= RADIUS - 1e-9 && a.x <= W - RADIUS + 1e-9 && a.y >= RADIUS - 1e-9 && a.y <= H - RADIUS + 1e-9, `${mx},${my} ended at ${a.x},${a.y}`);
  }
});

test('the speaker and the cake table are solid', () => {
  const speaker = OBSTACLES[0];
  const a = makeActor('a', 'me', 8, 1);
  run(a, -1, 0, 3);
  assert.ok(a.x >= speaker.x1 + RADIUS - 1e-6, `stopped by the speaker at ${a.x}`);
  const cake = OBSTACLES[1];
  const b = makeActor('b', 'me', 12, 1);
  run(b, 1, 0, 3);
  assert.ok(b.x <= cake.x0 - RADIUS + 1e-6);
  const c = makeActor('c', 'me', 1, 6);
  run(c, 0, -1, 3);
  assert.ok(c.y >= speaker.y1 + RADIUS - 1e-6, `stopped below the speaker at ${c.y}`);
  // knocked into the middle of one: pushed out through an open side, never into the wall
  const d = makeActor('d', 'me', 1.3, 1.1);
  run(d, 0, 0, 0.2);
  assert.ok(d.x >= RADIUS && d.y >= RADIUS && !(d.x < speaker.x1 + RADIUS - 1e-6 && d.y < speaker.y1 + RADIUS - 1e-6 && Math.hypot(d.x - Math.min(Math.max(d.x, 0), speaker.x1), d.y - Math.min(Math.max(d.y, 0), speaker.y1)) < RADIUS - 1e-6));
});

test('a knock sends a standing character KNOCK_DIST units away and fades out', () => {
  const a = makeActor('a', 'me', 8, 6);
  assert.ok(knock(a, 1, 0));
  run(a, 0, 0, 1.5);
  assert.ok(Math.abs(a.x - 8 - KNOCK_DIST) < 0.06, `moved ${a.x - 8}`);
  assert.ok(Math.abs(a.kx) < 1e-3);
});

test('a bump hits whoever is in reach, once, and only when it is allowed', () => {
  const a = makeActor('a', 'me', 8, 6);
  const o = makeActor('o', 'remote', 8.9, 6);
  a.fx = 1;
  a.fy = 0;
  const hits = [];
  const env = { list: [a, o], field: makeField(), hit: (x, y, nx, ny) => hits.push([x.id, y.id, nx, ny]) };
  assert.equal(tryBump(a), true);
  assert.equal(tryBump(a), false, 'cooling down');
  run(a, 0, 0, 0.3, env);
  assert.equal(hits.length, 1);
  assert.equal(hits[0][1], 'o');
  assert.ok(hits[0][2] > 0.9);
  // the cooldown is 1.2 s
  run(a, 0, 0, BUMP_CD - 0.3 - 0.05, env);
  assert.equal(tryBump(a), false);
  run(a, 0, 0, 0.1, env);
  assert.equal(tryBump(a), true);
});

test('a seated, a ghost and a wobbling character can neither bump nor be bumped', () => {
  const a = makeActor('a', 'me', 8, 6);
  a.chair = 0;
  assert.equal(tryBump(a), false);
  a.chair = -1;
  a.ghost = true;
  assert.equal(tryBump(a), false);
  a.ghost = false;
  a.wob = WOBBLE;
  assert.equal(tryBump(a), false);
  const o = makeActor('o', 'me', 5, 5);
  o.chair = 2;
  assert.equal(knock(o, 1, 0), false);
  assert.equal(o.kx, 0);
  const g = makeActor('g', 'me', 5, 5);
  g.ghost = true;
  assert.equal(knock(g, 1, 0), false);
  assert.equal(knock(makeActor('n', 'me', 1, 1), NaN, 0), false);
  // the bump passes through a seated character without hitting
  const b = makeActor('b', 'me', 8, 6);
  const s = makeActor('s', 'remote', 8.8, 6);
  s.chair = 1;
  b.fx = 1;
  b.fy = 0;
  let n = 0;
  tryBump(b);
  run(b, 0, 0, 0.3, { list: [b, s], field: makeField(), hit: () => n++ });
  assert.equal(n, 0);
  const s2 = makeActor('s2', 'remote', 8.8, 6);
  s2.sitFlag = true;
  const b2 = makeActor('b2', 'me', 8, 6);
  b2.fx = 1;
  tryBump(b2);
  run(b2, 0, 0, 0.3, { list: [b2, s2], field: makeField(), hit: () => n++ });
  assert.equal(n, 0, 'a sit the page announces counts too');
});

test('characters that overlap are pushed apart, even exactly on top of each other', () => {
  const a = makeActor('a', 'me', 8, 6);
  const b = makeActor('b', 'me', 8, 6);
  const env = { list: [a, b], field: makeField() };
  for (let i = 0; i < 60; i++) {
    stepActor(a, 0, 0, DT, env);
    stepActor(b, 0, 0, DT, env);
  }
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > RADIUS * 2 * 0.95 && Number.isFinite(d), `apart by ${d}`);
});

test('touching a free chair sits you down and asks for it; a taken one bonks you away', () => {
  const field = makeField();
  field.ph = 'race';
  field.chairs = [[8, 6], [12, 6]];
  field.seats = [null, null];
  field.now = 1000;
  field.dropAt = 0;
  field.alive.add('a');
  const claims = [];
  const bonks = [];
  const a = makeActor('a', 'me', 7, 6);
  a.fx = 1;
  a.fy = 0;
  const env = { list: [a], field, canSit: true, claim: (x, i) => claims.push(i), bonk: (x) => bonks.push(x.id) };
  for (let i = 0; i < 30 && a.chair < 0; i++) stepActor(a, 1, 0, DT, env);
  assert.equal(a.chair, 0);
  assert.deepEqual(claims, [0]);
  assert.ok(Math.hypot(a.x - 8, a.y - 6) < SIT_R + 0.01);
  // nobody answers for a while: given up quietly
  env.canSit = false;
  for (let i = 0; i < 120; i++) stepActor(a, 0, 0, DT, env);
  assert.equal(a.chair, -1);
  assert.deepEqual(bonks, []);
  // sits again, and now someone else is given the chair
  a.x = 7.4;
  a.y = 6;
  env.canSit = true;
  stepActor(a, 1, 0, DT, env);
  assert.equal(a.chair, 0);
  field.seats[0] = 'z';
  stepActor(a, 0, 0, DT, env);
  assert.equal(a.chair, -1);
  assert.deepEqual(bonks, ['a']);
  assert.ok(Math.hypot(a.kx, a.ky) > 5, 'pushed off');
  // confirmed: stays and settles on the chair
  a.x = 7.6;
  field.seats[0] = null;
  env.canSit = true;
  stepActor(a, 1, 0, DT, env);
  field.seats[0] = 'a';
  for (let i = 0; i < 40; i++) stepActor(a, 1, 0, DT, env);
  assert.equal(a.chair, 0);
  assert.ok(a.sat);
  assert.ok(Math.hypot(a.x - 8, a.y - 6) < 0.01);
  // the chairs go away: stands up
  field.chairs = [];
  field.seats = [];
  stepActor(a, 0, 0, DT, env);
  assert.equal(a.chair, -1);
});

test('canSit: only after the chairs landed, for players still in', () => {
  const F = makeField();
  const a = makeActor('a', 'me', 1, 1);
  F.alive.add('a');
  F.ph = 'race';
  F.dropAt = 1000;
  F.now = 999;
  assert.equal(canSit(F, a), false);
  F.now = 1000;
  assert.equal(canSit(F, a), true);
  a.ghost = true;
  assert.equal(canSit(F, a), false);
  a.ghost = false;
  F.alive.clear();
  assert.equal(canSit(F, a), false);
});

test('practice: a chair for everyone and a spare, the same chairs for every page, away again at the end', () => {
  const p1 = new Practice(7);
  const p2 = new Practice(7);
  const F1 = makeField();
  const F2 = makeField();
  p1.fill(F1, 5 * 14000 + 100, 4, ['a', 'b', 'c']);
  assert.equal(F1.ph, 'music');
  assert.equal(F1.chairs.length, 0);
  p1.fill(F1, 5 * 14000 + 9100, 4, ['a', 'b', 'c']);
  p2.fill(F2, 5 * 14000 + 9150, 5, ['a', 'b', 'c', 'd']);
  assert.equal(F1.ph, 'race');
  assert.equal(F1.chairs.length, 4, 'people plus one');
  assert.equal(F2.chairs.length, 5);
  assert.deepEqual(F1.chairs, F2.chairs.slice(0, 4));
  assert.ok(F1.dropAt > F1.now);
  p1.fill(F1, 5 * 14000 + 9500, 4, ['a', 'b', 'c']);
  assert.ok(F1.now >= F1.dropAt);
});

test('bots only ever ask for legal moves', () => {
  const world = new World();
  world.seed = 3;
  const F = world.field;
  F.ph = 'race';
  F.chairs = [[5, 5], [9, 6], [13, 8]];
  F.seats = [null, null, null];
  F.dropAt = 0;
  F.now = 1;
  F.rid = 'r';
  for (const id of ['x', 'y', 'z', 'w']) F.alive.add(id);
  const r = rng(11);
  for (const id of ['x', 'y', 'z', 'w']) world.add(id, 'bot', 1 + r() * 18, 1 + r() * 10);
  for (let i = 0; i < 600; i++) {
    for (const a of world.list) {
      const B = world.brains.get(a.id);
      thinkBot(a, B, { mode: i % 300 < 100 ? 'dance' : i % 300 < 140 ? 'dip' : 'race', field: F, list: world.list, alive: F.alive }, DT);
      assert.ok(Number.isFinite(B.mx) && Number.isFinite(B.my), 'finite');
      assert.ok(Math.hypot(B.mx, B.my) <= 1 + 1e-9, `length ${Math.hypot(B.mx, B.my)}`);
      stepActor(a, B.mx, B.my, DT, world.env);
      assert.ok(a.x >= RADIUS - 1e-9 && a.x <= W - RADIUS + 1e-9 && a.y >= RADIUS - 1e-9 && a.y <= H - RADIUS + 1e-9);
    }
  }
  assert.ok(makeBrain('q', 1).speedMul >= 0.9 && makeBrain('q', 1).speedMul <= 1);
  void syncField;
});
