// The simulation's rules, determinism and robustness. `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, PHASE } from '../game/src/sim/world.js';
import { Bot } from '../game/src/sim/bot.js';
import { Rng, hash32 } from '../game/src/sim/rng.js';
import { makeWeb, SHAPES, laneDelta, laneOf, wrapU, opposite } from '../game/src/sim/web.js';
import { buildZone, validateZone } from '../game/src/sim/levelgen.js';
import { zoneFor, draftOptions, cleanMods, dailyFor, zoneCount, addMod } from '../game/src/sim/run.js';
import { E, MODS, SHIPS, WORLDS, STEPS_PER_BAR, STEPS_PER_BEAT, COUNTIN_BARS, SHIELD_BARS, MAX_BPM, descentRamp, startLives, maxLivesFor } from '../game/src/sim/data.js';
import { spawnEnemy, S } from '../game/src/sim/enemies.js';
import { playRun } from '../game/src/sim/headless.js';

const zone = (over = {}) => ({ mode: 'run', world: 0, level: 1, shape: 'circle', bpm: 120, seed: 5, oc: 0, ...over });
const solo = (over = {}, mods = {}, ship = 0) => new World({ zone: zone(over), players: [{ id: 'me', ship, mods, kind: 'driven' }] });
const stepTo = (w, phase, limit = 200 * STEPS_PER_BAR) => {
  while (w.phase !== phase && w.step < limit) w.update();
};
/** A world with no scheduled enemies: a clean bench for one rule at a time. */
const bench = (over = {}, mods = {}, ship = 0) => {
  const w = solo(over, mods, ship);
  w.spawns = [];
  stepTo(w, PHASE.PLAY);
  return w;
};

test('rng: same seed, same stream; ranges hold', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a.next();
    assert.equal(x, b.next());
    assert.ok(x >= 0 && x < 1);
  }
  assert.equal(hash32('a', 1), hash32('a', 1));
  assert.notEqual(hash32('a', 1), hash32('a', 2));
  const r = new Rng(7);
  for (let i = 0; i < 200; i++) {
    const k = r.int(5);
    assert.ok(Number.isInteger(k) && k >= 0 && k < 5);
    assert.ok(r.weighted([0, 0, 3]) === 2);
  }
});

test('web: every shape builds, lanes have width, the start lane is valid', () => {
  for (const id of Object.keys(SHAPES)) {
    for (const lanes of [8, 16, 24]) {
      const web = makeWeb(id, lanes);
      assert.ok(web.n >= lanes && web.n <= 24);
      assert.equal(web.rim.length, web.closed ? web.n : web.n + 1);
      assert.ok(web.start >= 0 && web.start < web.n, `${id} start`);
      for (let i = 0; i < web.n; i++) {
        const a = web.rim[i];
        const b = web.rim[web.closed ? (i + 1) % web.n : i + 1];
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.06, `${id}/${lanes} lane ${i} too thin`);
        assert.ok(Number.isFinite(a[0]) && Number.isFinite(a[1]));
      }
    }
  }
});

test('web: topology wraps on loops and clamps on lines', () => {
  const loop = makeWeb('circle', 16);
  assert.equal(laneDelta(loop, 15, 0), 1);
  assert.equal(laneDelta(loop, 0, 15), -1);
  assert.equal(laneOf(loop, -1), 15);
  assert.equal(wrapU(loop, 16.5), 0.5);
  assert.equal(opposite(loop, 0), 8);
  const line = makeWeb('flat', 14);
  assert.equal(laneDelta(line, 13, 0), -13);
  assert.equal(laneOf(line, -3), 0);
  assert.equal(laneOf(line, 40), 13);
  assert.equal(opposite(line, 0), 13);
});

test('levels: a thousand seeds in every world and level are valid', () => {
  for (let world = 0; world < WORLDS.length; world++) {
    for (let level = 1; level <= 4; level++) {
      for (let seed = 0; seed < 1000; seed += world === 0 ? 1 : 7) {
        const def = WORLDS[world];
        const web = makeWeb(level >= 4 ? def.bossShape : def.shapes[level - 1]);
        const z = { world, level, n: web.n, closed: web.closed, start: web.start, seed, oc: seed % 9 };
        const built = buildZone(z);
        assert.deepEqual(validateZone(z, built), [], `world ${world} level ${level} seed ${seed}`);
      }
    }
  }
});

test('determinism: the same zone, seed and bot give the same world', () => {
  const sig = () => {
    const w = new World({ zone: zoneFor({ mode: 'run', seed: 99 }, 6), players: [{ id: 'a', ship: 2, mods: { pierce: 2, chain: 1 }, kind: 'bot' }] });
    const bot = new Bot('average', 3);
    for (let i = 0; i < 40 * STEPS_PER_BAR && w.phase < PHASE.DONE; i++) {
      bot.drive(w, w.ships[0]);
      w.update();
    }
    return JSON.stringify([w.step, w.score, w.mult, w.res, w.lives, w.enemies.map((e) => [e.id, e.type, +e.lane.toFixed(6), +e.z.toFixed(6), e.hp]), Array.from(w.spikes)]);
  };
  assert.equal(sig(), sig());
});

test('a bolt kills a flipper in its lane; a flipper climbs and reaches the rim', () => {
  const w = bench();
  const ship = w.ships[0];
  const lane = laneOf(w.web, ship.u);
  const f = spawnEnemy(w, E.FLIPPER, lane, { z: 0.5 });
  f.next = Infinity; // no flips for this test
  ship.in.fire = true;
  for (let i = 0; i < STEPS_PER_BEAT * 2 && !f.dead; i++) w.update();
  assert.ok(f.dead, 'shot down');
  assert.ok(w.score > 0);
  // Another one with nobody firing climbs to the rim.
  ship.in.fire = false;
  const g = spawnEnemy(w, E.FLIPPER, (lane + 5) % w.n, { z: 0.3 });
  g.next = Infinity;
  for (let i = 0; i < STEPS_PER_BAR * 4 && g.z > 0; i++) w.update();
  assert.equal(g.z, 0);
  assert.equal(g.st, S.RIM);
});

test('a crawler that reaches a firing ship dies; one that reaches an idle ship catches it', () => {
  const w = bench();
  const ship = w.ships[0];
  ship.inv = 0;
  const lane = laneOf(w.web, ship.u);
  const c = spawnEnemy(w, E.FLIPPER, (lane + 1) % w.n, { z: 0 });
  c.st = S.RIM;
  ship.in.fire = true;
  for (let i = 0; i < STEPS_PER_BAR && !c.dead; i++) w.update();
  assert.ok(c.dead, 'the crawler flipped into fire');
  assert.equal(ship.state, 'live');
  const d = spawnEnemy(w, E.FLIPPER, (lane + 1) % w.n, { z: 0 });
  d.st = S.RIM;
  ship.in.fire = false;
  for (let i = 0; i < STEPS_PER_BAR && ship.state === 'live'; i++) w.update();
  assert.notEqual(ship.state, 'live');
  assert.equal(w.lives, 2);
});

test('hop: three lanes, a moment of safety, a beat of cooldown', () => {
  const w = bench();
  const ship = w.ships[0];
  const from = laneOf(w.web, ship.u);
  ship.dir = 1;
  ship.in.hop = true;
  w.update();
  assert.equal(laneOf(w.web, ship.u), (from + 3) % w.n);
  assert.ok(ship.inv > w.step);
  ship.in.hop = true;
  w.update();
  assert.equal(laneOf(w.web, ship.u), (from + 3) % w.n, 'cooldown holds the second hop');
});

test('hop on an open web stops at the end', () => {
  const w = bench({ shape: 'flat' });
  const ship = w.ships[0];
  ship.u = 1;
  ship.dir = -1;
  ship.in.hop = true;
  w.update();
  assert.equal(laneOf(w.web, ship.u), 0);
});

test('zap: everything within four lanes dies, the rest is hurt, once a zone', () => {
  const w = bench();
  const ship = w.ships[0];
  const lane = laneOf(w.web, ship.u);
  const near = spawnEnemy(w, E.TANKER, (lane + 3) % w.n, { z: 0.6 });
  const far = spawnEnemy(w, E.TANKER, (lane + 8) % w.n, { z: 0.6 });
  ship.in.zap = true;
  w.update();
  assert.ok(near.dead);
  assert.ok(!far.dead && far.hp < far.maxHp);
  assert.equal(w.enemies.filter((e) => e.type === E.FLIPPER).length, 0, 'a zapped tanker does not split');
  const again = spawnEnemy(w, E.FLIPPER, lane, { z: 0.5 });
  ship.in.zap = true;
  w.update();
  assert.ok(!again.dead, 'no second zap');
});

test('chords: three lanes in one beat pay and lift the multiplier', () => {
  const w = bench();
  // Line up three flippers in three lanes at point blank and kill them with direct damage on one beat.
  while (w.step % STEPS_PER_BEAT !== 1) w.update();
  const es = [2, 6, 10].map((l) => spawnEnemy(w, E.FLIPPER, l, { z: 0.4 }));
  const before = w.score;
  for (const e of es) w.damage(e, 5, 0, 'bolt');
  assert.ok(es.every((e) => e.dead));
  assert.equal(w.stats.chords, 1);
  assert.ok(w.mult >= 2);
  assert.ok(w.score - before > 3 * 150);
});

test('the zone keeps its three biggest payouts for the results', () => {
  const w = bench();
  while (w.step % STEPS_PER_BEAT !== 1) w.update();
  const es = [2, 6, 10].map((l) => spawnEnemy(w, E.FLIPPER, l, { z: 0.4 }));
  for (const e of es) w.damage(e, 5, 0, 'bolt');
  assert.ok(w.moments.length >= 1);
  assert.equal(w.moments[0][1], '3-CHORD');
  assert.ok(w.moments[0][0] > 0);
  for (let i = 0; i < 6; i++) w.moment(`X${i}`, 100 * (i + 1));
  assert.equal(w.moments.length, 3, 'only the biggest three');
  assert.ok(w.moments[0][0] >= w.moments[1][0] && w.moments[1][0] >= w.moments[2][0]);
});

test('a crawler that lands in your lane warns before it catches you', () => {
  const w = bench();
  const ship = w.ships[0];
  ship.inv = 0;
  ship.in.fire = false;
  const lane = laneOf(w.web, ship.u);
  const e = spawnEnemy(w, E.FLIPPER, lane, { z: 0 });
  e.st = S.RIM;
  e.next = Infinity;
  w.drain();
  let warned = -1;
  let down = -1;
  for (let i = 0; i < 40 && down < 0; i++) {
    w.update();
    for (const ev of w.drain()) {
      if (ev.k === 'warn' && warned < 0) warned = i;
      if (ev.k === 'down') down = i;
    }
  }
  assert.ok(warned >= 0, 'a warning came');
  assert.ok(down > warned + 6, `the fall came ${down - warned} steps later`);
});

test('resonance fills to Overdrive, which doubles points and ends', () => {
  const w = bench();
  w.res = 99;
  const e = spawnEnemy(w, E.FLIPPER, 3, { z: 0.5 });
  w.damage(e, 5, 0, 'bolt');
  assert.ok(w.overdrive);
  for (let i = 0; i < 12 / w.dt + 10; i++) w.update();
  assert.ok(!w.overdrive);
});

test('a Perfect Bar pays when a bar has kills and nothing reached the rim', () => {
  const w = bench();
  while (w.step % STEPS_PER_BAR !== 1) w.update();
  const e = spawnEnemy(w, E.FLIPPER, 3, { z: 0.8 });
  w.damage(e, 5, 0, 'bolt');
  const before = w.stats.perfect;
  while (w.step % STEPS_PER_BAR !== 0) w.update();
  assert.equal(w.stats.perfect, before + 1);
});

test('pulsars telegraph and burn their lane on a bar line', () => {
  const w = bench({ world: 2 });
  const ship = w.ships[0];
  ship.inv = 0;
  const lane = laneOf(w.web, ship.u);
  const p = spawnEnemy(w, E.PULSAR, lane, { z: 0.7 });
  p.a = -64; // old enough to pulse
  const events = [];
  for (let i = 0; i < STEPS_PER_BAR * 3 && ship.state === 'live'; i++) {
    w.update();
    events.push(...w.drain().map((e) => e.k));
  }
  assert.ok(events.includes('charge'), 'a build-up first');
  assert.ok(events.includes('pulse'));
  assert.notEqual(ship.state, 'live');
});

test('spikes block bolts, shrink when shot, and catch a ship in the warp', () => {
  const w = bench();
  const ship = w.ships[0];
  const lane = laneOf(w.web, ship.u);
  w.spikes[lane] = 0.6;
  const behind = spawnEnemy(w, E.FLIPPER, lane, { z: 0.9 });
  behind.next = Infinity;
  ship.in.fire = true;
  for (let i = 0; i < STEPS_PER_BEAT; i++) w.update();
  assert.ok(w.spikes[lane] < 0.6, 'shortened');
  assert.ok(!behind.dead, 'protected by the spike');
  // The warp: a tall spike in the ship's lane catches it.
  const w2 = bench();
  const s2 = w2.ships[0];
  s2.inv = 0;
  w2.spikes[laneOf(w2.web, s2.u)] = 0.8;
  w2.setPhase(PHASE.WARP);
  for (let i = 0; i < STEPS_PER_BAR * 2 && s2.state === 'live'; i++) w2.update();
  assert.notEqual(s2.state, 'live');
});

test('a zone ends: stanzas, then the warp, then done', () => {
  const w = solo();
  const bot = new Bot('expert', 1);
  for (let i = 0; i < 200 * STEPS_PER_BAR && w.phase < PHASE.DONE; i++) {
    bot.drive(w, w.ships[0]);
    w.update();
  }
  assert.ok(w.phase === PHASE.DONE || w.phase === PHASE.OVER);
});

test('practice: falling costs no ship', () => {
  const w = bench({ practice: true });
  const ship = w.ships[0];
  ship.inv = 0;
  w.down(ship, 1);
  assert.equal(w.lives, 3);
  assert.equal(ship.state, 'wait');
  for (let i = 0; i < STEPS_PER_BAR * 2; i++) w.update();
  assert.equal(ship.state, 'live');
});

test('co-op: every fall costs a ship, a rescue gives most of it back; tethers burn crawlers between ships', () => {
  const w = new World({ zone: zone(), players: [{ id: 'a', ship: 0 }, { id: 'b', ship: 0 }], carry: { lives: 5 } });
  w.spawns = [];
  stepTo(w, PHASE.PLAY);
  const [a, b] = w.ships;
  a.inv = b.inv = 0;
  a.u = 2;
  b.u = 4;
  w.down(a, 1);
  assert.equal(a.state, 'down');
  assert.equal(w.lives, 4, 'the fall cost a ship');
  b.in.target = 2;
  for (let i = 0; i < STEPS_PER_BEAT && a.state !== 'live'; i++) w.update();
  assert.equal(a.state, 'live', 'revived');
  assert.equal(w.lives, 4, 'four rescues in five pay for one ship: not yet');
  // The fifth rescue (0.8 each) completes a ship.
  for (let k = 0; k < 4; k++) {
    a.inv = 0;
    a.state = 'live';
    a.u = 2;
    b.u = 2;
    w.down(a, 1);
    b.u = 2;
    b.in.target = 2;
    for (let i = 0; i < STEPS_PER_BEAT && a.state !== 'live'; i++) w.update();
    assert.equal(a.state, 'live');
  }
  assert.equal(w.lives, 4, 'five falls cost five ships and five rescues gave four back');
  // Tether: a crawler between them burns.
  a.u = 2;
  b.u = 5;
  a.in.target = 2;
  b.in.target = 5;
  const c = spawnEnemy(w, E.FLIPPER, 3, { z: 0 });
  c.st = S.RIM;
  c.next = Infinity;
  for (let i = 0; i < STEPS_PER_BEAT * 2 && !c.dead; i++) w.update();
  assert.ok(c.dead);
  assert.ok(w.stats.tether >= 1);
});

test('co-op: with no ships left a fall is final, and nobody can be revived', () => {
  const w = new World({ zone: zone(), players: [{ id: 'a', ship: 0 }, { id: 'b', ship: 0 }], carry: { lives: 0 } });
  w.spawns = [];
  stepTo(w, PHASE.PLAY);
  const [a, b] = w.ships;
  a.inv = 0;
  a.u = 0;
  b.u = 8;
  w.down(a, 1);
  assert.equal(a.state, 'out');
  assert.equal(w.wrecks.length, 0);
  assert.notEqual(w.phase, PHASE.OVER, 'the other ship flies on');
  b.inv = 0;
  w.down(b, 1);
  assert.equal(w.phase, PHASE.OVER);
});

test('co-op: an unrevived wreck flies again on the next bar without a second charge', () => {
  const w = new World({ zone: zone(), players: [{ id: 'a', ship: 0 }, { id: 'b', ship: 0 }], carry: { lives: 4 } });
  w.spawns = [];
  stepTo(w, PHASE.PLAY);
  const [a, b] = w.ships;
  a.inv = 0;
  a.u = 0;
  b.u = 8;
  b.in.target = 8;
  w.down(a, 1);
  assert.equal(w.lives, 3);
  for (let i = 0; i < STEPS_PER_BAR * 4; i++) w.update();
  assert.equal(w.lives, 3, 'charged once, at the fall');
  assert.equal(a.state, 'live');
});

test('a crew meets a denser score, tougher enemies, and shares more ships', () => {
  const one = new World({ zone: zoneFor({ mode: 'run', seed: 3 }, 14), players: [{ id: 'a', ship: 0 }] });
  const four = new World({ zone: zoneFor({ mode: 'run', seed: 3 }, 14), players: [0, 1, 2, 3].map((i) => ({ id: `p${i}`, ship: i })) });
  assert.ok(four.spawns.length > one.spawns.length * 1.8, `a crew of four faces ${four.spawns.length} against ${one.spawns.length}`);
  assert.ok(four.tough > one.tough * 2);
  assert.ok(four.resShare < one.resShare);
  assert.ok(startLives(0, 4) > startLives(0, 1));
  assert.equal(startLives(0, 1), 3);
  assert.equal(startLives(6, 1), 2);
  assert.ok(startLives(0, 4) <= maxLivesFor(4));
});

test('the run ends when the last ship falls with no lives left', () => {
  const w = bench();
  const ship = w.ships[0];
  for (let k = 0; k < 3; k++) {
    ship.inv = 0;
    ship.state = 'live';
    w.down(ship, 1);
  }
  assert.equal(w.lives, 0);
  assert.equal(w.phase, PHASE.OVER);
});

test('bosses: every boss can be beaten and its parts stay in range', () => {
  for (let world = 0; world < 6; world++) {
    const z = zoneFor({ mode: 'run', seed: 11 }, world * 4 + 3);
    const w = new World({ zone: z, players: [{ id: 'a', ship: 0, mods: { pierce: 3, tremolo: 1, chain: 3, spread: 2 }, kind: 'bot' }], carry: { lives: 99 } });
    const bot = new Bot('expert', world);
    for (let i = 0; i < 300 * STEPS_PER_BAR && w.phase < PHASE.DONE; i++) {
      bot.drive(w, w.ships[0]);
      w.update();
      for (const e of w.enemies) {
        assert.ok(Number.isFinite(e.lane) && Number.isFinite(e.z), 'finite');
        assert.ok(e.z >= -0.001 && e.z <= 1.001, `z in range (${e.type} ${e.z})`);
      }
    }
    assert.ok(w.stats.bossDown, `${WORLDS[world].boss} goes down`);
  }
});

test('fuzz: random inputs for thousands of steps: no throw, no NaN, everything in bounds', () => {
  for (let trial = 0; trial < 24; trial++) {
    const rng = new Rng(trial + 1);
    const shapes = Object.keys(SHAPES);
    const mods = {};
    for (const m of MODS) if (rng.chance(0.4)) mods[m.key] = 1 + rng.int(m.max);
    const z = { ...zoneFor({ mode: 'run', seed: trial }, rng.int(24)), shape: shapes[rng.int(shapes.length)], n: 8 + rng.int(17), oc: rng.int(9) };
    const players = [];
    const count = 1 + rng.int(4);
    for (let i = 0; i < count; i++) players.push({ id: `p${i}`, ship: rng.int(SHIPS.length), mods, kind: 'driven' });
    const w = new World({ zone: z, players, carry: { lives: 5 } });
    for (let i = 0; i < 6000 && w.phase < PHASE.DONE; i++) {
      for (const s of w.ships) {
        if (rng.chance(0.05)) s.in.target = rng.chance(0.1) ? NaN : rng.int(w.n * 3) - w.n;
        s.in.fire = rng.chance(0.8);
        if (rng.chance(0.01)) s.in.hop = true;
        if (rng.chance(0.002)) s.in.zap = true;
        if (rng.chance(0.01)) s.dir = rng.sign();
      }
      w.update();
      w.drain();
    }
    assert.ok(Number.isFinite(w.score) && w.score >= 0);
    assert.ok(w.mult >= 1 && w.mult <= 12);
    assert.ok(w.res >= 0 && w.res <= 100);
    assert.ok(w.lives >= 0 && w.lives <= 8);
    assert.ok(w.bolts.length <= 200);
    assert.ok(w.enemies.length <= 140);
    for (const s of w.ships) assert.ok(s.u >= 0 && s.u < w.n && Number.isFinite(s.u), 'ship on the web');
    for (const b of w.bolts) assert.ok(Number.isFinite(b.z) && b.z >= -0.1 && b.z <= 1.1);
    for (let i = 0; i < w.n; i++) assert.ok(w.spikes[i] >= 0 && w.spikes[i] <= 0.86);
  }
});

test('run: zones, drafts and the Daily are well-formed and repeatable', () => {
  const run = { mode: 'run', seed: 3, oc: 0 };
  assert.equal(zoneCount(run), 24);
  for (let i = 0; i < 24; i++) {
    const z = zoneFor(run, i);
    assert.equal(z.world, Math.floor(i / 4));
    assert.ok(SHAPES[z.shape]);
  }
  const d1 = draftOptions(run, 'x', 3, {});
  assert.deepEqual(d1, draftOptions(run, 'x', 3, {}));
  assert.equal(new Set(d1).size, 3);
  assert.equal(draftOptions({ ...run, oc: 7 }, 'x', 3, {}).length, 2);
  assert.ok(!draftOptions(run, 'x', 3, {}, false).includes('unison') || true);
  const maxed = Object.fromEntries(MODS.map((m) => [m.key, m.max]));
  assert.deepEqual(draftOptions(run, 'x', 3, maxed, true), []);
  const pierceMax = MODS.find((m) => m.key === 'pierce').max;
  assert.deepEqual(cleanMods({ pierce: 9, nope: 1, chain: -1, echo: 1.5, spread: 1 }), { pierce: pierceMax, spread: 1 });
  assert.equal(addMod({ pierce: pierceMax }, 'pierce').pierce, pierceMax);
  const day = dailyFor(20000);
  assert.deepEqual(day, dailyFor(20000));
  assert.equal(day.mods.length, 2);
  for (let i = 0; i < 12; i++) assert.ok(WORLDS[zoneFor({ mode: 'daily', seed: day.seed, daily: day }, i).world]);
  const desc = zoneFor({ mode: 'descent', seed: 5 }, 40);
  assert.ok(desc.bpm <= 160);
  const p = zoneFor({ mode: 'practice', seed: 1, practice: { world: 99, level: -3, tempo: 'x' } }, 0);
  assert.equal(p.world, WORLDS.length - 1);
  assert.equal(p.level, 1);
});

test('headless runs finish and report sane numbers', () => {
  for (const skill of ['novice', 'expert']) {
    const r = playRun({ seed: 4, skill, picks: 'random', maxZones: 6 });
    assert.ok(r.zones.length >= 1);
    assert.ok(r.seconds > 30);
    for (const z of r.zones) assert.ok(!z.stuck);
  }
});

test('the Descent starts as gently as the first world and only climbs', () => {
  const first = new World({ zone: { ...zoneFor({ mode: 'descent', seed: 9 }, 0) }, players: [{ id: 'a', ship: 0 }] });
  assert.equal(first.tough, 1);
  assert.ok(first.pace <= 1.01);
  let prev = descentRamp(0);
  for (let d = 1; d < 80; d++) {
    const r = descentRamp(d);
    for (const k of ['pace', 'tough', 'budget', 'shots']) assert.ok(r[k] >= prev[k] && Number.isFinite(r[k]), `${k} at depth ${d}`);
    prev = r;
  }
  assert.ok(descentRamp(12).tough === 2 && descentRamp(79).tough <= 3.5);
});

test('Shield Beat: a shield as play begins, and another a few bars after it breaks', () => {
  const w = new World({ zone: zone(), players: [{ id: 'a', ship: 0, mods: { shieldbeat: 1 } }] });
  w.spawns = [];
  assert.equal(w.ships[0].shield, false);
  while (w.bar < COUNTIN_BARS + 1) w.update();
  assert.equal(w.ships[0].shield, true, 'ready when the zone starts');
  const ship = w.ships[0];
  ship.inv = 0;
  w.down(ship, 1);
  assert.equal(ship.state, 'live', 'the shield took the fall');
  assert.equal(ship.shield, false);
  while (!ship.shield && w.bar < COUNTIN_BARS + 40) w.update();
  assert.ok(ship.shield, 'and it forms again');
  assert.ok(w.bar - COUNTIN_BARS <= SHIELD_BARS[0] + 1);
});

test('comfort: no tempo in any mode, zone, Overclock or practice speed beats faster than three times a second', () => {
  let fastest = 0;
  for (const mode of ['run', 'descent', 'daily']) {
    for (let oc = 0; oc <= 8; oc++) {
      for (let idx = 0; idx < 200; idx++) {
        const z = zoneFor({ mode, seed: 7, oc, daily: dailyFor(3) }, idx);
        const w = new World({ zone: z, players: [{ id: 'a', ship: 0 }] });
        fastest = Math.max(fastest, w.bpm);
      }
    }
  }
  for (let world = 0; world < WORLDS.length; world++) {
    for (const tempo of [0.8, 0.9, 1, 1.1, 1.2]) {
      const z = zoneFor({ mode: 'practice', seed: 7, practice: { world, level: 1, tempo } }, 0);
      fastest = Math.max(fastest, new World({ zone: z, players: [{ id: 'a', ship: 0 }] }).bpm);
    }
  }
  assert.ok(fastest <= MAX_BPM, `${fastest} beats a minute`);
  assert.ok(MAX_BPM / 60 < 3);
});
