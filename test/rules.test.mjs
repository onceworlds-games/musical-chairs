import test from 'node:test';
import assert from 'node:assert/strict';
import {
  W, H, RADIUS, OBSTACLES, TABLE, BOT_NAMES, DIP_MS, DROP_MS, SAFETY_MS, HOLD_MS, OUT_MS,
  rng, mixSeed, makeRoster, spawnPoint, makeStops, musicState, sinceDip, musicRange, placeChairs, pointsFor, PLACE_POINTS,
  rankPlayers, awardsOf, sanitizeG, Engine,
} from '../game/rules.js';

test('points by place: 10, 7, 5, 4, 3, 2, then 1', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(pointsFor), [10, 7, 5, 4, 3, 2, 1, 1, 1, 1]);
  assert.deepEqual(PLACE_POINTS, [10, 7, 5, 4, 3, 2]);
});

test('roster: bots fill to the table of 8, 9 and 10 humans get no bots', () => {
  for (let humans = 1; humans <= 10; humans++) {
    const ids = Array.from({ length: humans }, (_, i) => `p${i}`);
    const roster = makeRoster(ids, 123 + humans);
    assert.equal(roster.length, Math.max(TABLE, humans));
    assert.equal(new Set(roster.map((r) => r.id)).size, roster.length);
    const bots = roster.filter((r) => r.b);
    assert.equal(bots.length, Math.max(0, TABLE - humans));
    for (const b of bots) {
      assert.match(b.id, /^bot\d+$/);
      assert.ok(BOT_NAMES.includes(b.n));
    }
    assert.equal(new Set(bots.map((b) => b.n)).size, bots.length, 'bot names are unique at one table');
    for (const id of ids) assert.ok(roster.some((r) => r.id === id && !r.b));
  }
});

test('roster is the same everywhere for the same inputs and different for another seed', () => {
  const a = makeRoster(['x', 'y'], 77);
  const b = makeRoster(['x', 'y'], 77);
  assert.deepEqual(a, b);
  const orders = new Set();
  for (let s = 0; s < 20; s++) orders.add(makeRoster(['x', 'y'], s).map((r) => r.id).join());
  assert.ok(orders.size > 5);
});

test('spawn points are inside the room and clear of the corners', () => {
  for (let n = 2; n <= 10; n++) {
    for (let i = 0; i < n; i++) {
      const p = spawnPoint(i, n);
      assert.ok(p.x > RADIUS && p.x < W - RADIUS && p.y > RADIUS && p.y < H - RADIUS);
      for (const o of OBSTACLES) assert.ok(!(p.x > o.x0 - RADIUS && p.x < o.x1 + RADIUS && p.y > o.y0 - RADIUS && p.y < o.y1 + RADIUS));
    }
  }
});

test('music: 5-12 s early on, 3-9 s later, fake-outs only from step 3, about 20% of stops, the last stop is real', () => {
  let fakes = 0;
  let firsts = 0;
  for (let s = 0; s < 3000; s++) {
    for (const step of [1, 2, 3, 6]) {
      const stops = makeStops(step, 1000, rng(mixSeed(s, step)));
      assert.ok(stops.length >= 1 && stops.length <= 3);
      assert.equal(stops[stops.length - 1][1], 0, 'the last stop is real');
      const [lo, hi] = musicRange(step);
      assert.ok(stops[0][0] - 1000 >= lo && stops[0][0] - 1000 <= hi, `first stop in range ${stops[0][0]}`);
      for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] - stops[i - 1][0] >= lo + DIP_MS - 1);
      if (step < 3) assert.ok(stops.every((st) => st[1] === 0), 'no fake-outs before step 3');
      else {
        firsts++;
        if (stops[0][1]) fakes++;
      }
    }
  }
  const rate = fakes / firsts;
  assert.ok(rate > 0.17 && rate < 0.23, `fake-out rate ${rate}`);
});

test('music state: play, dip, play again, stop', () => {
  const stops = [[1000, 1], [3000, 0]];
  assert.equal(musicState(stops, 0), 'play');
  assert.equal(musicState(stops, 999), 'play');
  assert.equal(musicState(stops, 1000), 'dip');
  assert.equal(musicState(stops, 1000 + DIP_MS - 1), 'dip');
  assert.equal(musicState(stops, 1000 + DIP_MS), 'play');
  assert.equal(musicState(stops, 2999), 'play');
  assert.equal(musicState(stops, 3000), 'stop');
  assert.equal(musicState(stops, 9999), 'stop');
  assert.equal(sinceDip(stops, 500), Infinity);
  assert.equal(sinceDip(stops, 1000 + DIP_MS + 50), 50);
});

test('chairs: n-1 spots, 1.5 apart, 1.2 from every player, inside the room, off the corners', () => {
  const r0 = rng(99);
  for (let trial = 0; trial < 400; trial++) {
    const n = 2 + (trial % 9); // 2..10 players
    const players = Array.from({ length: n }, () => ({ x: RADIUS + r0() * (W - 2 * RADIUS), y: RADIUS + r0() * (H - 2 * RADIUS), vx: (r0() - 0.5) * 11, vy: (r0() - 0.5) * 11 }));
    const chairs = placeChairs(n - 1, players, rng(trial));
    assert.equal(chairs.length, n - 1);
    for (let i = 0; i < chairs.length; i++) {
      const [x, y] = chairs[i];
      assert.ok(x >= 1.1 && x <= W - 1.1 && y >= 1.1 && y <= H - 1.1, `inside ${x},${y}`);
      for (const o of OBSTACLES) assert.ok(!(x > o.x0 - 0.9 && x < o.x1 + 0.9 && y > o.y0 - 0.9 && y < o.y1 + 0.9), 'off the corners');
      for (let j = i + 1; j < chairs.length; j++) assert.ok(Math.hypot(x - chairs[j][0], y - chairs[j][1]) >= 1.5 - 1e-9, 'chairs 1.5 apart');
      for (const p of players) {
        assert.ok(Math.hypot(x - p.x, y - p.y) >= 1.2 - 1e-9, 'chairs 1.2 from players');
        assert.ok(Math.hypot(x - (p.x + p.vx * 0.3), y - (p.y + p.vy * 0.3)) >= 1.2 - 1e-9, 'and from where they are heading');
      }
    }
  }
});

test('chairs are the same for the same seed', () => {
  const ps = [{ x: 5, y: 5, vx: 0, vy: 0 }];
  assert.deepEqual(placeChairs(6, ps, rng(5)), placeChairs(6, ps, rng(5)));
});

// ---------------------------------------------------------------- the engine

const view = (positions = {}, gone = []) => ({ pos: (id) => positions[id] ?? { x: 10, y: 6, vx: 0, vy: 0 }, gone: (id) => gone.includes(id) });
// a claim from a player who stands at the chair
const claim = (e, id, chair, mt, now = mt) => {
  const c = e.g.chairs[chair];
  return e.claim(id, chair, mt, now, view({ [id]: { x: c ? c[0] : 0, y: c ? c[1] : 0, vx: 0, vy: 0 } }));
};

function fourPlayers(games = 1) {
  const roster = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  return Engine.create({ mid: 'm', by: 'a', seed: 5, roster, games, now: 0 });
}

test('engine: the stop drops one chair fewer than the players, then claims seat players', () => {
  const e = fourPlayers();
  assert.equal(e.g.ph, 'music');
  assert.equal(e.update(e.g.until - 1, view()), false);
  let t = e.g.until;
  assert.equal(e.update(t, view()), true);
  assert.equal(e.g.ph, 'race');
  assert.equal(e.g.chairs.length, 3);
  assert.deepEqual(e.g.seats, [null, null, null]);
  assert.equal(e.g.stopAt, t);
  // a claim before the chair has landed is refused
  assert.equal(e.claim('a', 0, t, t, view()), false);
  const land = t + DROP_MS;
  assert.equal(claim(e, 'a', 0, land + 10), true);
  assert.equal(e.update(land + 10, view()), false, 'held for a moment');
  assert.equal(e.update(land + 10 + HOLD_MS, view()), true);
  assert.equal(e.g.seats[0], 'a');
  assert.equal(e.g.sat.a, 10);
  // the same player can't take a second chair, nor can anyone take a taken one
  assert.equal(claim(e, 'a', 1, land + 200), false);
  assert.equal(claim(e, 'b', 0, land + 200), false);
  claim(e, 'b', 1, land + 300);
  claim(e, 'c', 2, land + 400);
  e.update(land + 600, view());
  assert.deepEqual(e.g.seats, ['a', 'b', 'c']);
  assert.equal(e.g.ph, 'out');
  assert.equal(e.g.out, 'd');
  assert.deepEqual(e.g.alive, ['a', 'b', 'c']);
  assert.deepEqual(e.g.elim, ['d']);
});

test('engine: the earliest claim on the match clock wins even when it arrives second', () => {
  const e = fourPlayers();
  const t = e.g.until;
  e.update(t, view());
  const land = t + DROP_MS;
  claim(e, 'b', 1, land + 40, land + 60); // arrived first, claimed later
  claim(e, 'c', 1, land + 20, land + 70); // arrived second, claimed earlier
  e.update(land + 70, view());
  assert.equal(e.g.seats[1], null, 'still held');
  e.update(land + 40 + HOLD_MS + 5, view());
  assert.equal(e.g.seats[1], 'c');
  assert.equal(claim(e, 'b', 1, land + 300), false);
});

test('engine: a claim from across the room is refused', () => {
  const e = fourPlayers();
  e.update(e.g.until, view());
  const [cx, cy] = e.g.chairs[0];
  const far = { x: cx + 6, y: cy, vx: 0, vy: 0 };
  const t = e.g.stopAt + DROP_MS + 50;
  assert.equal(e.claim('a', 0, t, t, view({ a: far })), false);
});

test('engine: nobody sits for 15 s and the one farthest from the free chairs is out', () => {
  const e = fourPlayers();
  e.update(e.g.until, view());
  const [c0, c1, c2] = e.g.chairs;
  const pos = { a: { x: c0[0], y: c0[1], vx: 0, vy: 0 }, b: { x: c1[0], y: c1[1], vx: 0, vy: 0 }, c: { x: c2[0], y: c2[1], vx: 0, vy: 0 }, d: { x: 19, y: 11, vx: 0, vy: 0 } };
  assert.equal(e.update(e.g.stopAt + SAFETY_MS - 1, view(pos)), false);
  assert.equal(e.update(e.g.stopAt + SAFETY_MS, view(pos)), true);
  assert.equal(e.g.ph, 'out');
  assert.equal(e.g.out, 'd');
  assert.equal(e.g.alive.length, 3);
});

test('engine: players who left for good are out at the next stop', () => {
  const e = fourPlayers();
  e.update(e.g.until, view({}, ['c']));
  assert.deepEqual(e.g.elim, ['c']);
  assert.equal(e.g.chairs.length, 2, 'three left, two chairs');
});

test('engine: a whole game down to one winner, points by elimination order, then the next game and the final', () => {
  const e = fourPlayers(2);
  let now = 0;
  const order = [];
  const guard = 400;
  for (let i = 0; i < guard && e.g.ph !== 'final'; i++) {
    const g = e.g;
    if (g.ph === 'music') now = g.until;
    else if (g.ph === 'race') {
      // everyone but the last alive player claims in order
      const land = g.stopAt + DROP_MS;
      const seated = g.alive.slice(0, g.alive.length - 1);
      seated.forEach((id, k) => claim(e, id, k, land + 50 * k + 50));
      now = land + 50 * seated.length + 200;
      e.update(now, view());
      order.push(e.g.out);
      continue;
    } else now = g.until;
    e.update(now, view());
  }
  assert.equal(e.g.ph, 'final');
  assert.equal(e.g.game, 2);
  assert.equal(e.g.n, 6, '3 steps a game, 2 games');
  assert.equal(order.length, 6);
  // each game the last in the alive order went out first: d, c, b and winner a
  assert.deepEqual(order.slice(0, 3), ['d', 'c', 'b']);
  assert.equal(e.g.wins.a, 2);
  assert.equal(e.g.scores.a, 20);
  assert.equal(e.g.scores.b, 14, '2nd place twice');
  assert.equal(e.g.scores.c, 10, '3rd place twice');
  assert.equal(e.g.scores.d, 8, '4th place twice');
  assert.deepEqual(e.g.rank, ['a', 'b', 'c', 'd']);
  assert.equal(e.isOver(e.g.until - 1), false);
  assert.equal(e.isOver(e.g.until), true);
});

test('ranking: points, then game wins, then the last game, then roster order', () => {
  const g = { roster: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], scores: { a: 10, b: 10, c: 10, d: 10 }, wins: { a: 0, b: 1, c: 1, d: 0 }, last: { a: 2, b: 2, c: 1, d: 3 } };
  assert.deepEqual(rankPlayers(g), ['c', 'b', 'a', 'd']);
  g.wins = {};
  g.last = {};
  assert.deepEqual(rankPlayers(g), ['a', 'b', 'c', 'd']);
});

test('awards: fastest average sit and most landed bumps', () => {
  const g = { roster: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], st: { a: [3, 3000, 0], b: [2, 1000, 4], c: [1, 100, 4] } };
  const aw = awardsOf(g);
  assert.equal(aw.speedy.id, 'b', 'one sit is not enough to be speedy');
  assert.equal(aw.bumper.id, 'b', 'first of equals');
  assert.deepEqual(awardsOf({ roster: [{ id: 'a' }], st: {} }), { speedy: null, bumper: null });
});

test('the record survives a trip through the room and a new host continues from it', () => {
  const e = fourPlayers(2);
  e.update(e.g.until, view());
  const wire = JSON.parse(JSON.stringify(e.g));
  const g = sanitizeG(wire, 'm');
  assert.ok(g);
  assert.deepEqual(g.chairs, e.g.chairs);
  assert.deepEqual(g.seats, e.g.seats);
  assert.deepEqual(g.alive, e.g.alive);
  assert.equal(g.ph, 'race');
  const e2 = Engine.adopt(wire, 'm', 'b');
  assert.equal(e2.g.by, 'b');
  const land = e2.g.stopAt + DROP_MS;
  const c0 = e2.g.chairs[0];
  e2.claim('a', 0, land + 20, land + 20, view({ a: { x: c0[0], y: c0[1], vx: 0, vy: 0 } }));
  e2.update(land + 200, view());
  assert.equal(e2.g.seats[0], 'a');
});

test('the record is refused when it is another match, or garbage', () => {
  const e = fourPlayers();
  const wire = JSON.parse(JSON.stringify(e.g));
  assert.equal(sanitizeG(wire, 'other'), null);
  assert.equal(sanitizeG(null, 'm'), null);
  assert.equal(sanitizeG('x', 'm'), null);
  assert.equal(sanitizeG({ ...wire, ph: 'nope' }, 'm'), null);
  assert.equal(sanitizeG({ ...wire, roster: 5 }, 'm'), null);
  assert.equal(sanitizeG({ ...wire, roster: [{ id: 'a' }, { id: 'a' }] }, 'm'), null);
  assert.equal(sanitizeG({ ...wire, stops: [] }, 'm'), null);
  const messy = sanitizeG({ ...wire, ph: 'race', chairs: [[1e9, NaN], 'x', [3, 3]], seats: ['zzz', 'a'], alive: ['a', 'nobody', 5], scores: { a: 'many', b: 1e12 } }, 'm');
  assert.ok(messy);
  assert.equal(messy.chairs.length, 2);
  assert.ok(messy.chairs.every((c) => c.every(Number.isFinite)));
  assert.deepEqual(messy.seats, [null, 'a']);
  assert.deepEqual(messy.alive, ['a']);
  assert.equal(messy.scores.a, undefined);
  assert.equal(messy.scores.b, 99999);
});
