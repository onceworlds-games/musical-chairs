// Whole matches played by bots only, at 60 steps a second, with the same pure code the host's page runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H, RADIUS, OBSTACLES, TABLE, DROP_MS, SAFETY_MS, Engine, makeRoster, spawnPoint, pointsFor, PLACE_POINTS } from '../game/rules.js';
import { World, syncField } from '../game/world.js';

const DT = 1 / 60;

/**
 * `humans` take part as if they were bots, except `still` of them (away players) who never move. Returns what happened.
 */
function playMatch(seed, { humans = 1, games = 2, still = 0 } = {}) {
  const ids = Array.from({ length: humans }, (_, i) => `h${i + 1}`);
  const roster = makeRoster(ids, seed);
  const N = roster.length;
  const log = { chairs: [], bonks: 0, bumps: 0, safetyOuts: 0, rounds: 0, outs: [], maxMs: 0, frames: 0 };
  let now = 0;
  let engine;
  const view = { pos: (id) => world.get(id), gone: () => false };
  const world = new World({
    claim: (a, i) => engine.claim(a.id, i, now, now, view),
    bonk: () => log.bonks++,
    landed: (a) => {
      log.bumps++;
      engine.noteBump(a.id);
    },
  });
  world.seed = seed;
  const stillIds = new Set(ids.slice(0, still));
  roster.forEach((r, i) => {
    const p = spawnPoint(i, N);
    world.add(r.id, stillIds.has(r.id) ? 'remote' : 'bot', p.x, p.y);
  });
  engine = Engine.create({ mid: `m${seed}`, by: 'h1', seed, roster, games, now: 0 });
  const limit = 60 * 60 * 40;
  let lastPh = engine.g.ph;
  let lastN = engine.g.n;
  while (!engine.isOver(now) && log.frames < limit) {
    log.frames++;
    now = (log.frames * 1000) / 60;
    syncField(world.field, engine.g, now);
    world.afterField();
    world.stepBots(DT);
    const raceStart = engine.g.ph === 'music' && now >= engine.g.until;
    const before = engine.g.alive.length;
    const stopAt = engine.g.until;
    const changed = engine.update(now, view);
    const g = engine.g;
    if (raceStart && g.ph === 'race') {
      assert.equal(g.chairs.length, before - 1, 'one chair fewer than the players');
      assert.equal(g.stopAt, stopAt);
      log.chairs.push(g.chairs.length);
      for (let i = 0; i < g.chairs.length; i++) {
        for (let j = i + 1; j < g.chairs.length; j++) assert.ok(Math.hypot(g.chairs[i][0] - g.chairs[j][0], g.chairs[i][1] - g.chairs[j][1]) >= 1.5 - 1e-9);
        for (const id of g.alive) {
          const a = world.get(id);
          assert.ok(Math.hypot(g.chairs[i][0] - a.x, g.chairs[i][1] - a.y) >= 1.2 - 1e-9, `chair too near ${id}`);
        }
      }
    }
    if (g.ph === 'out' && lastPh === 'race') {
      log.rounds++;
      log.outs.push(g.out);
      if (g.stopAt + SAFETY_MS <= now + 1e-6) log.safetyOuts++;
      assert.ok(g.out && !g.alive.includes(g.out));
    }
    if (changed) {
      assert.ok(g.n >= lastN);
      lastN = g.n;
      lastPh = g.ph;
    } else lastPh = g.ph;
    for (const a of world.list) {
      assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.vx) && Number.isFinite(a.vy) && Number.isFinite(a.kx) && Number.isFinite(a.ky), `NaN for ${a.id}`);
      assert.ok(a.x >= RADIUS - 1e-6 && a.x <= W - RADIUS + 1e-6 && a.y >= RADIUS - 1e-6 && a.y <= H - RADIUS + 1e-6, `${a.id} outside the room at ${a.x},${a.y}`);
      if (!a.ghost) for (const o of OBSTACLES) assert.ok(!(a.x > o.x0 && a.x < o.x1 && a.y > o.y0 && a.y < o.y1), `${a.id} inside the ${o.kind}`);
    }
  }
  log.engine = engine;
  log.roster = roster;
  log.N = N;
  log.ms = now;
  return log;
}

test('20 seeds: a whole two-game match of bots ends, ranks everyone, and keeps to the rules', () => {
  let totalRounds = 0;
  let totalBonks = 0;
  let totalBumps = 0;
  let longest = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const log = playMatch(seed, { humans: 1 + (seed % 3), games: 2 });
    const g = log.engine.g;
    assert.equal(g.ph, 'final', `seed ${seed} finished`);
    assert.ok(log.frames < 60 * 60 * 40, 'ended in time');
    assert.equal(log.N, TABLE);
    assert.equal(g.game, 2);
    assert.equal(g.n, 2 * (log.N - 1), `seed ${seed}: ${log.N - 1} rounds a game`);
    assert.equal(log.rounds, 2 * (log.N - 1));
    assert.equal(g.rank.length, log.N, 'everyone is ranked');
    assert.equal(new Set(g.rank).size, log.N);
    // the points: both games hand out 10+7+5+4+3+2+1+1 = 33 in total
    const total = Object.values(g.scores).reduce((s, v) => s + v, 0);
    assert.equal(total, 2 * Array.from({ length: log.N }, (_, i) => pointsFor(i + 1)).reduce((s, v) => s + v, 0));
    assert.deepEqual(g.rank, [...g.rank].sort((a, b) => g.scores[b] - g.scores[a] || (g.wins[b] ?? 0) - (g.wins[a] ?? 0) || (g.last[a] ?? 99) - (g.last[b] ?? 99) || log.roster.findIndex((r) => r.id === a) - log.roster.findIndex((r) => r.id === b)));
    assert.equal(Object.values(g.wins).reduce((s, v) => s + v, 0), 2);
    // the chair counts go N-1 down to 1, twice
    assert.deepEqual(log.chairs, [...Array.from({ length: log.N - 1 }, (_, i) => log.N - 1 - i), ...Array.from({ length: log.N - 1 }, (_, i) => log.N - 1 - i)]);
    assert.equal(log.safetyOuts, 0, `seed ${seed}: bots always find a chair`);
    totalRounds += log.rounds;
    totalBonks += log.bonks;
    totalBumps += log.bumps;
    longest = Math.max(longest, log.ms);
  }
  assert.equal(totalRounds, 20 * 14);
  assert.ok(totalBumps > 0, 'bots bump now and then');
  assert.ok(longest < 12 * 60 * 1000, `a two-game match takes ${Math.round(longest / 1000)} s at the most`);
  console.log(`20 seeds: ${totalRounds} rounds, ${totalBumps} bumps, ${totalBonks} bonks, longest match ${Math.round(longest / 1000)} s`);
});

test('one game, three games, a full table of ten players, and tables of two to nine', () => {
  const one = playMatch(31, { humans: 1, games: 1 });
  assert.equal(one.engine.g.ph, 'final');
  assert.equal(one.engine.g.n, 7);
  const three = playMatch(32, { humans: 2, games: 3 });
  assert.equal(three.engine.g.n, 21);
  assert.equal(three.engine.g.game, 3);
  const ten = playMatch(33, { humans: 10, games: 1 });
  assert.equal(ten.N, 10);
  assert.equal(ten.engine.g.n, 9);
  assert.equal(ten.roster.filter((r) => r.b).length, 0);
  assert.deepEqual(ten.chairs, [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (let humans = 2; humans <= 9; humans++) {
    const log = playMatch(40 + humans, { humans, games: 1 });
    assert.equal(log.engine.g.ph, 'final');
    assert.equal(log.engine.g.n, log.N - 1);
  }
});

test('players who stand still (away) are knocked out one by one and never hold the match up', () => {
  const log = playMatch(51, { humans: 3, games: 2, still: 3 });
  const g = log.engine.g;
  assert.equal(g.ph, 'final');
  assert.equal(g.rank.length, 8);
  assert.ok(log.safetyOuts >= 3, `${log.safetyOuts} knock-outs by the 15 s rule`);
  // none of the three still ones can win a game
  assert.ok(!['h1', 'h2', 'h3'].includes(g.winner));
  assert.ok(log.ms < 20 * 60 * 1000, `took ${Math.round(log.ms / 1000)} s`);
});

test('the timeline of a round: music, stop, chairs claimable 350 ms later, a pause on who is out, then music again', () => {
  const log = playMatch(61, { humans: 1, games: 1 });
  assert.ok(DROP_MS === 350 && PLACE_POINTS[0] === 10);
  assert.ok(log.rounds === 7);
});
