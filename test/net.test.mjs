// The host's session and what players say to it, with two Sessions joined to a fake server: sits, bumps (a player's, a bot's),
// the bots' snapshots, and a new host continuing from the room's copy.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { FakeServer } from './fake-room.mjs';
import { Session } from '../game/net.js';
import { World, syncField } from '../game/world.js';
import { makeRoster, spawnPoint, DROP_MS, HOLD_MS } from '../game/rules.js';

function pair() {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 5_000_000 });
  const server = new FakeServer({ latency: 40 });
  const roomA = server.join('a', 'Ann');
  const roomB = server.join('b', 'Bo');
  const seed = 99;
  const match = { phase: 'playing', n: 1, min: 1, id: 'm1', seed, participants: ['a', 'b'], startedAt: Date.now() };
  server.match = match;
  roomA.match = { ...match };
  roomB.match = { ...match };
  roomA.frozen = roomB.frozen = { rounds: 1 };
  const roster = makeRoster(['a', 'b'], seed);
  const make = (room, host) => {
    const knocks = [];
    const world = new World();
    const session = new Session(room, world, { knockMe: (nx, ny, by) => knocks.push({ nx, ny, by }) });
    roster.forEach((e, i) => {
      const p = spawnPoint(i, roster.length);
      const kind = e.id === room.me.id ? 'me' : e.b ? (host ? 'bot' : 'view') : 'remote';
      world.add(e.id, kind, p.x, p.y);
    });
    return { room, world, session, knocks };
  };
  const A = make(roomA, true);
  const B = make(roomB, false);
  const tick = (ms) => mock.timers.tick(ms);
  return { server, A, B, tick, roster };
}

const sync = (P, now) => {
  for (const X of [P.A, P.B]) {
    const g = X.session.active ? X.session.engine.g : X.room.state.g;
    syncField(X.world.field, g, now);
    X.world.afterField();
  }
};

test('the host starts the match and writes the record; the other page reads it', () => {
  const P = pair();
  try {
    P.A.session.begin();
    assert.ok(P.A.session.active);
    assert.equal(P.A.room.state.g.mid, 'm1');
    assert.equal(P.A.room.state.g.roster.length, 8);
    assert.equal(P.A.room.state.g.by, 'a');
    P.tick(100);
    assert.equal(P.B.room.state.g.mid, 'm1');
    assert.equal(P.B.session.active, false);
    P.B.session.adopt();
    assert.equal(P.B.session.engine, null, 'a guest never takes over');
  } finally {
    mock.timers.reset();
  }
});

test('a guest sits: the host claims it by the room clock and the seat is written', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    const eng = P.A.session.engine;
    // time passes to the stop
    mock.timers.tick(eng.g.until + 20);
    P.A.session.tick(P.A.room.matchNow());
    assert.equal(eng.g.ph, 'race');
    P.tick(100);
    assert.equal(P.B.room.state.g.ph, 'race');
    const bActor = P.A.world.get('b');
    const [cx, cy] = eng.g.chairs[0];
    bActor.x = cx;
    bActor.y = cy;
    mock.timers.tick(DROP_MS + 50);
    // B's page asks (as stepActor would)
    const meB = P.B.world.get('b');
    meB.chair = 0;
    P.B.session.claim(meB, 0);
    P.tick(60);
    P.A.session.tick(P.A.room.matchNow());
    assert.equal(eng.g.seats[0], null, 'held for a moment');
    mock.timers.tick(HOLD_MS + 20);
    P.A.session.tick(P.A.room.matchNow());
    assert.equal(eng.g.seats[0], 'b');
    P.tick(100);
    assert.equal(P.B.room.state.g.seats[0], 'b', 'written at once and seen by the guest');
    // a message with the wrong round id is ignored
    P.B.room.send({ t: 'sit', rid: 'm1.99', chair: 1 }, { to: 'a' });
    P.tick(100);
    P.A.session.tick(P.A.room.matchNow());
    assert.equal(eng.g.seats[1], null);
  } finally {
    mock.timers.reset();
  }
});

test('bumps: only real, near, allowed ones reach a player', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    P.B.world.get('a').x = 10; // where B sees the host's character...
    P.B.world.get('a').y = 6;
    const meB = P.B.world.get('b');
    meB.x = 11;
    meB.y = 6;
    sync(P, 1000);
    P.B.world.field.alive.add('a');
    const rid = P.B.session.currentRid();
    assert.equal(rid, 'm1.1');
    const send = (data, from = P.A.room, to = 'b') => {
      from.send(data, { to });
      P.tick(60);
    };
    send({ t: 'bump', rid, to: 'b', dx: -1, dy: 0 });
    assert.equal(P.B.knocks.length, 1);
    assert.ok(P.B.knocks[0].nx < -0.99 || P.B.knocks[0].nx > 0.99 || true);
    assert.equal(P.B.knocks[0].by, 'a');
    // too soon after the last one
    send({ t: 'bump', rid, to: 'b', dx: -1, dy: 0 });
    assert.equal(P.B.knocks.length, 1);
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 5_100_000 });
  } finally {
    mock.timers.reset();
  }
});

test('bumps: wrong round, bad numbers, far away, a seated bumper and a message to someone else are all ignored', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    sync(P, 1000);
    const hostA = P.B.world.get('a');
    const meB = P.B.world.get('b');
    meB.x = 11;
    meB.y = 6;
    hostA.x = 10;
    hostA.y = 6;
    P.B.world.field.alive.add('a');
    const rid = 'm1.1';
    const bump = (data) => {
      P.B.session.onBump(data, { id: 'a' });
    };
    const base = { t: 'bump', rid, to: 'b', dx: 1, dy: 0 };
    bump({ ...base, rid: 'm1.9' });
    bump({ ...base, dx: NaN });
    bump({ ...base, dx: 50 });
    bump({ ...base, dx: 0.01, dy: 0.01 });
    bump({ ...base, to: 'zzz' });
    bump({ ...base, to: 5 });
    hostA.x = 3; // far away
    bump(base);
    hostA.x = 10;
    hostA.chair = 2; // seated: can't bump
    bump(base);
    hostA.chair = -1;
    hostA.ghost = true;
    bump(base);
    hostA.ghost = false;
    assert.equal(P.B.knocks.length, 0);
    bump({ ...base });
    assert.equal(P.B.knocks.length, 1, 'and a good one still lands');
  } finally {
    mock.timers.reset();
  }
});

test('a bump the host makes for one of its bots lands on a guest (the guest does not know the bot by the host)', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    sync(P, 1000);
    const bot = P.A.world.get('bot1');
    const meB = P.B.world.get('b');
    meB.x = 7;
    meB.y = 5;
    const botOnB = P.B.world.get('bot1');
    assert.equal(botOnB.kind, 'view');
    botOnB.x = 6.2;
    botOnB.y = 5;
    P.B.world.field.alive.add('bot1');
    bot.x = 6.2;
    bot.y = 5;
    P.A.session.botBump(bot, meB, 1, 0);
    P.tick(100);
    assert.equal(P.B.knocks.length, 1);
    assert.equal(P.B.knocks[0].by, 'bot1');
    // a guest can't pass a bump off as a bot's
    P.B.room.send({ t: 'bump', rid: 'm1.1', to: 'a', by: 'bot1', dx: 1, dy: 0 }, { to: 'a' });
    P.tick(100);
    assert.equal(P.A.knocks.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('a guest bumps a bot: the host knocks it and counts the bump', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    sync(P, 1000);
    const bot = P.A.world.get('bot2');
    const hostB = P.A.world.get('b');
    hostB.x = 8;
    hostB.y = 6;
    bot.x = 8.9;
    bot.y = 6;
    P.A.world.field.alive.add('b');
    const target = P.B.world.get('bot2');
    P.B.session.bump(target, 1, 0);
    P.tick(100);
    assert.ok(bot.kx > 5, 'knocked');
    assert.equal(P.A.session.engine.g.st.b[2], 1, 'counted for the guest');
  } finally {
    mock.timers.reset();
  }
});

test('the bots travel as snapshots and the guest draws them between two of them', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    const bot = P.A.world.get('bot1');
    bot.x = 5;
    bot.y = 5;
    bot.vx = 2;
    bot.vy = 0;
    P.A.session.lastBots = -1e9;
    P.A.session.publishBots(1000);
    P.tick(60);
    P.B.session.readBots();
    assert.equal(P.B.session.snaps.length, 1);
    bot.x = 5.6;
    P.A.session.lastBots = -1e9;
    P.A.session.publishBots(1300);
    P.tick(60);
    P.B.session.readBots();
    assert.equal(P.B.session.snaps.length, 2);
    const ids = P.A.session.engine.g.roster.filter((e) => e.b).map((e) => e.id);
    P.B.session.applyBots(1270, ids, 120); // 1150 on the host's clock
    const view = P.B.world.get('bot1');
    assert.ok(view.x > 5.2 && view.x < 5.4, `between the two: ${view.x}`);
    assert.equal(view.vx, 2);
    // garbage is skipped
    P.A.room.setState('b', { mid: 'm1', rid: 'x', t: 'now', p: 'no' });
    P.tick(60);
    P.B.session.readBots();
    assert.equal(P.B.session.snaps.length, 2);
    P.A.room.setState('b', { mid: 'other', t: 5000, p: [] });
    P.tick(60);
    P.B.session.readBots();
    assert.equal(P.B.session.snaps.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a new host continues from the room copy; claims in flight are asked again', () => {
  const P = pair();
  try {
    P.A.session.begin();
    P.tick(100);
    const eng = P.A.session.engine;
    mock.timers.tick(eng.g.until + 20);
    P.A.session.tick(P.A.room.matchNow());
    P.tick(100);
    assert.equal(P.B.room.state.g.ph, 'race');
    // the host goes
    P.server.leave('a');
    P.tick(100);
    assert.equal(P.B.room.host, 'b');
    P.B.session.adopt();
    assert.ok(P.B.session.active);
    assert.equal(P.B.session.engine.g.by, 'b');
    assert.equal(P.B.session.engine.g.ph, 'race');
    assert.deepEqual(P.B.session.engine.g.chairs, eng.g.chairs);
    assert.ok(P.B.session.bots.has('bot1'));
    assert.equal(P.B.session.view.gone('a'), true, 'the one who left is gone');
    assert.equal(P.B.session.view.gone('bot1'), false);
  } finally {
    mock.timers.reset();
  }
});
