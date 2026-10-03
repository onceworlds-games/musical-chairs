// The save: every kind of stored value loads, runs fold in, unlocks follow milestones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, recordRun, defaults, shipUnlocked, ocAllowed, met, TINTS, VERSION } from '../game/src/sim/profile.js';
import { SHIPS } from '../game/src/sim/data.js';

test('missing, empty, corrupt, older and newer saves all load', () => {
  for (const raw of [null, undefined, '', 'garbage', 42, [], [1, 2], { v: 0 }, {}, { v: 99, best: 'lots', mods: 'pierce', hints: [1] }]) {
    const p = parseProfile(raw);
    assert.equal(p.v, VERSION);
    assert.ok(Number.isFinite(p.best) && p.best >= 0);
    assert.ok(Array.isArray(p.mods));
    assert.equal(typeof p.hints, 'object');
  }
  // Numbers are clamped and whole; unknown keys dropped; bad choices fall back.
  const p = parseProfile({ v: 1, best: 1e12, kills: -5, chords: 3.7, mods: ['pierce', 'nope', 'pierce', 7], ship: 5, tint: 99, calm: 'yes', hints: { move: 2, fire: 'x' } });
  assert.equal(p.best, 99_999_999);
  assert.equal(p.kills, 0);
  assert.equal(p.chords, 3);
  assert.deepEqual(p.mods, ['pierce']);
  assert.equal(p.ship, 0, 'a locked ship is not kept');
  assert.equal(p.tint, 0);
  assert.equal(p.calm, false);
  assert.equal(p.hints.move, 2);
  assert.equal(p.hints.fire, 0);
});

test('a newer save keeps what this build understands', () => {
  const p = parseProfile({ v: 7, best: 1234, futureThing: { a: 1 }, worldsCleared: 2 });
  assert.equal(p.best, 1234);
  assert.equal(p.worldsCleared, 2);
  assert.equal(p.futureThing, undefined);
});

test('runs fold in: bests, counters, unlocks', () => {
  let p = defaults();
  assert.ok(shipUnlocked(p, 0));
  assert.ok(!shipUnlocked(p, 1));
  const r1 = recordRun(p, { mode: 'run', score: 50000, depth: 4, worldsCleared: 1, reached: 2, cleared: false, oc: 0, kills: 300, chords: 3, perfect: 10, tether: 0, mods: ['pierce', 'echo'] });
  p = r1.profile;
  assert.equal(p.best, 50000);
  assert.equal(p.runs, 1);
  assert.equal(p.kills, 300);
  assert.ok(shipUnlocked(p, 1), 'beating the Hydra opens the Mallet');
  assert.ok(r1.unlocked.some((u) => u.includes('MALLET')));
  assert.ok(met(p, TINTS[1].need), 'and the mint tint');
  assert.equal(p.first, false);
  const r2 = recordRun(p, { mode: 'run', score: 20000, depth: 1, worldsCleared: 0, reached: 1 });
  assert.equal(r2.profile.best, 50000, 'a worse run does not lower the best');
  assert.deepEqual(r2.unlocked, []);
  // The whole run at Overclock 3 opens Overclock 4.
  const r3 = recordRun(p, { mode: 'run', score: 9e6, depth: 24, worldsCleared: 6, reached: 6, cleared: true, oc: 3 });
  assert.equal(ocAllowed(r3.profile), 4);
  assert.equal(r3.profile.cleared, 1);
  for (let i = 0; i < SHIPS.length; i++) if (i !== 4) assert.ok(shipUnlocked(r3.profile, i), `ship ${i}`);
});

test('the Daily and the Descent keep their own records', () => {
  let p = defaults();
  p = recordRun(p, { mode: 'daily', score: 7000, depth: 2, day: 20500 }).profile;
  assert.deepEqual(p.daily, { day: 20500, best: 7000, done: true });
  assert.equal(p.dailyDays, 1);
  p = recordRun(p, { mode: 'daily', score: 5000, depth: 1, day: 20500 }).profile;
  assert.equal(p.daily.best, 7000);
  assert.equal(p.dailyDays, 1);
  p = recordRun(p, { mode: 'daily', score: 100, depth: 0, day: 20501 }).profile;
  assert.equal(p.daily.day, 20501);
  assert.equal(p.daily.done, false);
  p = recordRun(p, { mode: 'descent', score: 88000, depth: 17 }).profile;
  assert.equal(p.bestDescent, 88000);
  assert.equal(p.deepest, 17);
  assert.equal(p.best, 0, 'the Descent does not count as a run score');
});

test('the old profile is never changed by recordRun', () => {
  const p = defaults();
  const copy = JSON.stringify(p);
  recordRun(p, { mode: 'run', score: 1000, depth: 1 });
  assert.equal(JSON.stringify(p), copy);
});
