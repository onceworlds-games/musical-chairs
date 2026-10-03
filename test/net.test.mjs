// What crosses the network: snapshots, batches, run records. A mirror fed the host's snapshot plays the zone the same
// way; anything malformed from another page is dropped or clamped, never trusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, PHASE } from '../game/src/sim/world.js';
import { Bot } from '../game/src/sim/bot.js';
import { spawnEnemy } from '../game/src/sim/enemies.js';
import { makeBoss } from '../game/src/sim/bosses.js';
import { zoneFor } from '../game/src/sim/run.js';
import { encode, clean, apply, batch, readBatch } from '../game/src/net/sync.js';
import { cleanHub, cleanRun } from '../game/src/net/session.js';
import { STEPS_PER_BAR, MODS } from '../game/src/sim/data.js';

const players = [
  { id: 'a', ship: 0, mods: { pierce: 1 }, kind: 'driven' },
  { id: 'b', ship: 2, mods: {}, kind: 'puppet' },
];

function pair(idx = 5) {
  const zone = zoneFor({ mode: 'run', seed: 77 }, idx);
  const host = new World({ zone: { ...zone }, players, auth: true });
  const mirror = new World({ zone: { ...zone }, players: players.map((p) => ({ ...p, kind: p.id === 'b' ? 'driven' : 'puppet' })), auth: false });
  return { host, mirror };
}

test('a snapshot survives the trip through JSON and the checks', () => {
  const { host } = pair();
  const bot = new Bot('expert', 1);
  for (let i = 0; i < 30 * 64; i++) {
    bot.drive(host, host.ships[0]);
    host.update();
  }
  const snap = JSON.parse(JSON.stringify(encode(host, 'm1', [[1, 'k', 5, 3, 40, 1, 0]])));
  const c = clean(snap, host.n);
  assert.ok(c);
  assert.equal(c.s, host.step);
  assert.equal(c.sc, Math.round(host.score));
  assert.equal(c.e.length % 17, 0);
  assert.ok(JSON.stringify(snap).length < 16000, 'well under a room value limit');
});

test('a mirror given the host snapshot plays the next beats the same way', () => {
  const { host, mirror } = pair(9);
  const bot = new Bot('average', 3);
  for (let i = 0; i < 12 * STEPS_PER_BAR; i++) {
    bot.drive(host, host.ships[0]);
    host.update();
  }
  host.drain();
  const snap = clean(JSON.parse(JSON.stringify(encode(host, 'm1', []))), host.n);
  mirror.step = host.step;
  apply(mirror, snap, 1, spawnEnemy, 48, makeBoss);
  // Same inputs from here on: nobody fires, the bolts already in flight are gone (each page's bolts are its own),
  // ships hold their lanes.
  host.bolts.length = 0;
  for (const s of [...host.ships, ...mirror.ships]) {
    s.in.fire = false;
    s.in.target = Math.round(s.u);
    s.echoes.length = 0;
  }
  mirror.ships[0].u = host.ships[0].u;
  mirror.ships[1].u = host.ships[1].u;
  for (let i = 0; i < 48; i++) {
    host.update();
    mirror.update();
  }
  const sig = (w) => w.enemies.filter((e) => !e.dead).map((e) => [e.id, e.type, e.lane.toFixed(3), e.z.toFixed(3)].join(':')).sort();
  assert.deepEqual(sig(mirror), sig(host));
});

test('hostile snapshots are rejected or clamped', () => {
  assert.equal(clean(null, 16), null);
  assert.equal(clean({ v: 2 }, 16), null);
  assert.equal(clean({ v: 1, m: 'x', s: 'soon' }, 16), null);
  assert.equal(clean({ v: 1, m: 'x', s: 10, e: [1, 2, 3] }, 16), null, 'ragged enemy array');
  assert.equal(clean({ v: 1, m: 'x', s: 10, e: new Array(17).fill(NaN) }, 16), null);
  const c = clean({ v: 1, m: 'x', s: 10, sc: -50, mu: 999, re: 1e9, lv: 1e9, sp: [5000, -3, 'x'], sh: 'nope', ev: 'x', pu: [[99, 9]] }, 16);
  assert.ok(c);
  assert.equal(c.sc, 0);
  assert.equal(c.mu, 12);
  assert.equal(c.re, 100);
  assert.equal(c.lv, 9);
  assert.deepEqual(c.sp, [0.86, 0, 0]);
  assert.deepEqual(c.sh, []);
  assert.deepEqual(c.ev, []);
  assert.deepEqual(c.pu, [[15, 9]]);
  // Applying a clamped snapshot never puts a number out of range.
  const { mirror } = pair();
  const evil = clean({ v: 1, m: 'x', s: 500, e: [1, 1, 1e9, -1e9, 1e9, 0, 0, 0, -1, 2, 1, 99999, 0, 0, 0, 0, 0], sp: [] }, mirror.n);
  apply(mirror, evil, 0, spawnEnemy);
  for (const e of mirror.enemies) {
    assert.ok(e.lane >= -1 && e.lane <= mirror.n + 1);
    assert.ok(e.z >= 0 && e.z <= 1);
  }
});

test('client batches: well-formed parts pass, the rest is dropped', () => {
  const b = batch('m1', 900, [[3, 1, 4, 500]], [[1, 4, 1]], true, 2);
  assert.deepEqual(readBatch(JSON.parse(JSON.stringify(b)), 16), { m: 'm1', k: 900, claims: [[3, 1, 4, 0.5]], hops: [[1, 4, 1]], zap: true, down: 2 });
  assert.equal(readBatch(null, 16), null);
  assert.equal(readBatch({ t: 'x' }, 16), null);
  const bad = readBatch({ t: 'c', m: 'm1', h: [[1, 99, 2, 3], [1, 1, -4, 3], ['a', 1, 1, 1], [2, 1, 1], [5, 0.5, 15, 1000]], o: [[1, 2]], d: 'boom', Z: 'yes' }, 16);
  assert.deepEqual(bad.claims, [[5, 0.5, 15, 1]]);
  assert.deepEqual(bad.hops, []);
  assert.equal(bad.down, 0);
  assert.equal(bad.zap, false);
  const many = readBatch({ t: 'c', m: 'm', h: new Array(500).fill([1, 1, 1, 1]) }, 16);
  assert.ok(many.claims.length <= 48);
});

test('run records and hub settings from room state are checked', () => {
  assert.equal(cleanRun(null), null);
  assert.equal(cleanRun({ v: 1, rid: 'r', mode: 'party' }), null);
  const r = cleanRun({
    v: 1,
    rid: 'r1',
    mode: 'run',
    seed: -5,
    oc: 99,
    idx: 'x',
    status: 'weird',
    lives: 1e9,
    score: 1e12,
    roster: ['a', 'ghost', 7],
    players: { a: { n: 'Ann', ship: 99, mods: { pierce: 9, nope: 1 }, kills: -1 }, ['x'.repeat(200)]: { n: 'long' } },
    result: { cleared: 'yes', cause: 99, zone: 5 },
  });
  assert.equal(r.seed, 0);
  assert.equal(r.oc, 8);
  assert.equal(r.idx, 0);
  assert.equal(r.status, 'over');
  assert.ok(r.lives <= 8);
  assert.equal(r.score, 99_999_999);
  assert.deepEqual(r.roster, ['a']);
  assert.equal(r.players.a.ship, 5);
  assert.deepEqual(r.players.a.mods, { pierce: MODS.find((m) => m.key === 'pierce').max });
  assert.equal(r.players.a.kills, 0);
  assert.equal(Object.keys(r.players).length, 1);
  assert.equal(r.result.cleared, false);
  assert.equal(r.result.cause, 20);
  assert.equal(r.result.zone, '');
  const h = cleanHub({ mode: 'party', oc: -3, pw: 99, pl: 0, pt: 'fast' });
  assert.deepEqual(h, { mode: 'run', oc: 0, pw: 7, pl: 1, pt: 2 });
});

test('a mirror that joins mid-boss gets a bare boss and the host pieces', () => {
  const zone = zoneFor({ mode: 'run', seed: 3 }, 3);
  const host = new World({ zone: { ...zone }, players: [players[0]], auth: true });
  while (!host.boss || !host.boss.active) host.update();
  for (let i = 0; i < 200; i++) host.update();
  const mirror = new World({ zone: { ...zone }, players: [{ ...players[0], kind: 'puppet' }], auth: false });
  const snap = clean(JSON.parse(JSON.stringify(encode(host, 'm', []))), host.n);
  apply(mirror, snap, -1, spawnEnemy, 48, makeBoss);
  assert.ok(mirror.boss, 'the mirror has a boss');
  apply(mirror, snap, -1, spawnEnemy, 48, makeBoss);
  assert.equal(mirror.boss.parts.length, host.boss.parts.filter((p) => !p.dead).length);
  assert.equal(Math.round(mirror.boss.hp), Math.round(host.boss.hp));
  void PHASE;
});
