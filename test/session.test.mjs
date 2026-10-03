// The run's lifecycle through the session, on the local room the game uses when it runs alone: a zone starts, plays,
// ends into the draft, the pick lands in the next zone, an outside end closes the run, the hub clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../game/src/net/session.js';
import { Bot } from '../game/src/sim/bot.js';
import { PHASE } from '../game/src/sim/world.js';
import { draftOptions } from '../game/src/sim/run.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function app() {
  const seen = { starts: 0, ends: 0 };
  return {
    seen,
    profile: { first: false },
    onZoneStart() {
      seen.starts++;
    },
    onZoneEnd() {
      seen.ends++;
    },
    onRemoteEvent() {},
    onMatchStart() {},
    onMatchEnd() {},
  };
}

/** Plays the session's zone with a bot until the world says it is over. */
function playOut(s) {
  const w = s.world;
  const bot = new Bot('expert', 5);
  w.lives = 99;
  for (let i = 0; i < 200 * 128 && w.phase !== PHASE.DONE && w.phase !== PHASE.OVER; i++) {
    bot.drive(w, w.ships[0]);
    w.update();
    w.drain();
  }
  return w.phase;
}

test('a run goes zone, draft, zone: picks land, records stay consistent', async () => {
  const a = app();
  const s = new Session(a);
  await s.connect();
  assert.ok(s.room);
  assert.equal(s.lobbyScreen(), 'hub');
  s.setHub({ mode: 'run' });
  s.myShip = 0;
  assert.ok(s.start());
  await tick();
  s.update();
  let run = s.run;
  assert.ok(run, 'the host wrote a run');
  assert.equal(run.status, 'play');
  assert.equal(run.idx, 0);
  assert.equal(run.mid, s.match.id);
  assert.ok(s.world && s.world.auth, 'the host runs the world');
  assert.equal(a.seen.starts, 1);
  // Play the zone out and end it.
  assert.equal(playOut(s), PHASE.DONE);
  s.finishZone();
  await tick();
  s.update();
  run = s.run;
  assert.equal(s.match.phase, 'lobby');
  assert.equal(run.status, 'draft');
  assert.equal(run.idx, 1);
  assert.equal(s.lobbyScreen(), 'draft');
  assert.equal(s.world, null);
  // Pick a mod; the next zone carries it.
  const options = draftOptions(run, s.room.me.id, 0, {}, false);
  assert.equal(options.length, 3);
  assert.ok(s.pickMod(options[1]));
  assert.ok(s.start());
  await tick();
  s.update();
  run = s.run;
  assert.equal(run.status, 'play');
  assert.equal(run.idx, 1);
  assert.equal(run.players[s.room.me.id].mods[options[1]], 1);
  assert.equal(s.world.ships[0].mods[options[1]], 1);
  // A match ended from outside the game's rules closes the run (and says so).
  s.room.endMatch();
  await tick();
  s.update();
  run = s.run;
  assert.equal(run.status, 'over');
  assert.equal(run.result.ended, true);
  assert.equal(s.lobbyScreen(), 'results');
  // Starting again makes a fresh run from the hub.
  assert.ok(s.start());
  await tick();
  s.update();
  assert.equal(s.run.idx, 0);
  assert.notEqual(s.run.rid, run.rid);
  s.room.endMatch();
  await tick();
  s.update();
  s.toHub();
  assert.equal(s.run, null);
  assert.equal(s.lobbyScreen(), 'hub');
});

test('a pick that was never offered is ignored', async () => {
  const s = new Session(app());
  await s.connect();
  s.start();
  await tick();
  s.update();
  playOut(s);
  s.finishZone();
  await tick();
  s.update();
  const run = s.run;
  const offered = draftOptions(run, s.room.me.id, 0, {}, false);
  const other = ['pierce', 'spread', 'echo', 'chain', 'tremolo'].find((k) => !offered.includes(k));
  s.pickMod(other);
  s.start();
  await tick();
  s.update();
  assert.deepEqual(s.run.players[s.room.me.id].mods, {});
});

test('a lost zone ends the run with its cause', async () => {
  const s = new Session(app());
  await s.connect();
  s.start();
  await tick();
  s.update();
  const w = s.world;
  w.spawns = [];
  while (w.phase === PHASE.COUNTIN) w.update();
  for (let k = 0; k < 3; k++) {
    const ship = w.ships[0];
    ship.state = 'live';
    ship.inv = 0;
    w.down(ship, 3);
  }
  assert.equal(w.phase, PHASE.OVER);
  s.finishZone();
  await tick();
  s.update();
  assert.equal(s.run.status, 'over');
  assert.equal(s.run.result.cleared, false);
  assert.equal(s.run.result.cause, 3);
});

test('a zone that just ended is not restarted while its match closes', async () => {
  const s = new Session(app());
  await s.connect();
  s.start();
  await tick();
  s.update();
  const w = s.world;
  w.spawns = [];
  while (w.phase === PHASE.COUNTIN) w.update();
  for (let k = 0; k < 3; k++) {
    const ship = w.ships[0];
    ship.state = 'live';
    ship.inv = 0;
    w.down(ship, 1);
  }
  // Hold the match open: the platform takes a moment to close it.
  const end = s.room.endMatch.bind(s.room);
  s.room.endMatch = () => {};
  s.finishZone();
  const rid = s.run.rid;
  for (let i = 0; i < 5; i++) s.update();
  assert.equal(s.run.rid, rid, 'the same run');
  assert.equal(s.run.status, 'over');
  assert.equal(s.run.result.ended, false);
  s.room.endMatch = end;
  s.room.endMatch();
  await tick();
  s.update();
  assert.equal(s.run.status, 'over');
  assert.equal(s.run.result.cause, 1);
});

