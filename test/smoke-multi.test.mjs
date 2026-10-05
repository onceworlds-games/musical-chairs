// Two and three pages of main.js in node, joined to a fake server (latency, a host, a countdown, messages): the host's page
// runs the match, the other page sends its sits and bumps and draws from the room's record, a latecomer watches, and when
// the host leaves the other page carries on.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, newPage, runFrame, makeOw } from './fake-dom.mjs';
import { FakeServer } from './fake-room.mjs';

function pilot(page, room, skill = 1) {
  const held = new Set();
  const hold = (code, on) => {
    if (on && !held.has(code)) {
      held.add(code);
      page.pressKey(code);
    } else if (!on && held.has(code)) {
      held.delete(code);
      page.releaseKey(code);
    }
  };
  let n = 0;
  return {
    seated: 0,
    step(ts) {
      const g = room.state.g;
      const p = room.me.presence;
      if (!g || !p || room.closed) return;
      n++;
      let mx = 0;
      let my = 0;
      if (g.mid !== room.match.id) return;
      if (g.ph === 'race' && g.alive.includes(room.me.id) && !g.seats.includes(room.me.id)) {
        let best = null;
        let bd = 1e9;
        g.chairs.forEach((c, i) => {
          if (g.seats[i]) return;
          const d = Math.hypot(c[0] - p.x, c[1] - p.y);
          if (d < bd) {
            bd = d;
            best = c;
          }
        });
        if (best) {
          mx = best[0] - p.x;
          my = best[1] - p.y;
        }
        if (bd < 2.5 && n % 11 === 0) {
          page.pressKey('Space');
          page.releaseKey('Space');
        }
      } else if (g.ph === 'music') {
        mx = Math.sin(ts / 700 + skill);
        my = Math.cos(ts / 900 + skill);
      }
      if (g.seats.includes(room.me.id)) this.seated++;
      hold('KeyA', mx < -0.3);
      hold('KeyD', mx > 0.3);
      hold('KeyW', my < -0.3);
      hold('KeyS', my > 0.3);
      if (n % 37 === 0) {
        page.pressKey('Space');
        page.releaseKey('Space');
      }
    },
    release() {
      for (const c of [...held]) hold(c, false);
    },
  };
}

function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 2_000_000 });
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  installGlobals();
  let ts = 0;
  const pages = [];
  const frame = () => {
    ts += 17;
    mock.timers.tick(17);
    runFrame(ts);
    for (const pg of pages) assert.equal(pg.canvas.ctx.depth, 0, 'every save has its restore');
  };
  const frames = (ms, each) => {
    for (let i = 0; i < Math.round(ms / 17); i++) {
      frame();
      if (each) each();
    }
  };
  return {
    errors,
    pages,
    frame,
    frames,
    get ts() {
      return ts;
    },
    done() {
      console.error = origError;
      mock.timers.reset();
    },
  };
}

async function addPage(env, server, id, name, tag) {
  const room = server.join(id, name);
  const ow = makeOw(room);
  const page = newPage(ow);
  await import(`../game/main.js?${tag}`);
  env.pages.push(page);
  return { room, ow, page };
}

test('host and guest play a whole match together; a latecomer watches', async () => {
  const env = setup();
  try {
    const server = new FakeServer({ latency: 40 });
    const A = await addPage(env, server, 'a', 'Ann', 'ma');
    const B = await addPage(env, server, 'b', 'Bo', 'mb');
    env.frames(800);
    A.page.pointer(422, 390 * 0.78);
    B.page.pointer(422, 390 * 0.78);
    env.frames(1500);
    // each sees the other in the lobby arena
    assert.ok(A.room.players.get('b').presence && Number.isFinite(A.room.players.get('b').presence.x));
    assert.ok(B.room.players.get('a').presence && Number.isFinite(B.room.players.get('a').presence.x));
    // the host picks 3 games; the guest sees it (and can't change it)
    A.page.pointer(422 + 64, 84);
    B.page.pointer(422 - 64, 84);
    env.frames(300);
    assert.equal(A.room.settings.rounds, 3);
    assert.equal(B.room.settings.rounds, 3);
    A.page.pointer(422, 84);
    env.frames(300);
    assert.equal(B.room.settings.rounds, 2);
    // ready up (the platform's strip does this): the server counts down and starts
    A.room.setReady(true);
    B.room.setReady(true);
    env.frames(2000);
    assert.equal(A.room.match.phase, 'starting');
    assert.equal(B.room.match.phase, 'starting');
    env.frames(1800);
    assert.equal(A.room.match.phase, 'playing');
    assert.equal(B.room.match.phase, 'playing');
    env.frames(400);
    assert.ok(A.room.state.g && B.room.state.g, 'both have the match record');
    assert.equal(B.room.state.g.by, 'a', 'the host runs it');
    assert.equal(B.room.state.g.roster.length, 8);
    assert.equal(B.room.state.g.roster.filter((e) => !e.b).length, 2);
    assert.ok(B.room.state.b && Array.isArray(B.room.state.b.p), 'the host shares its bots');
    assert.equal(A.ow.calls.controls.at(-1).buttons[0].label, 'Bump');

    const pa = pilot(A.page, A.room, 1);
    const pb = pilot(B.page, B.room, 2);
    let late = null;
    let lateAt = 0;
    let watched = false;
    let lastN = 0;
    let guard = 0;
    const gSeen = new Set();
    while (A.room.match.phase !== 'lobby' && guard++ < 60 * 60 * 15) {
      env.frame();
      pa.step(env.ts);
      pb.step(env.ts);
      const g = A.room.state.g;
      if (g) {
        gSeen.add(g.ph);
        if (g.n !== lastN) lastN = g.n;
      }
      if (!late && g && g.n >= 3) {
        late = await addPage(env, server, 'c', 'Cy', 'mc');
        late.page.pointer(422, 390 * 0.78); // taps PLAY on the title: the room is mid-match
        assert.ok(late.room.spectating);
        lateAt = env.ts;
      }
      if (late && !watched && env.ts - lateAt > 4000) {
        watched = true;
        assert.ok(late.room.spectating);
        assert.equal(late.room.me.presence, null, 'a watcher publishes nothing');
        assert.equal(late.ow.calls.controls.at(-1), null, 'and gets no touch controls');
      }
    }
    pa.release();
    pb.release();
    assert.equal(A.room.match.phase, 'lobby');
    assert.equal(B.room.match.phase, 'lobby');
    const g = B.room.state.g;
    assert.equal(g.ph, 'final');
    assert.equal(g.n, 14);
    assert.equal(g.game, 2);
    assert.equal(g.rank.length, 8);
    assert.ok(['music', 'race', 'out', 'over', 'between', 'final'].every((p) => gSeen.has(p)), `phases seen: ${[...gSeen]}`);
    assert.ok(pb.seated > 3, 'the guest sat on chairs: the host confirmed its sits');
    assert.ok(pa.seated > 3);
    assert.equal(A.ow.calls.saves.stats.matches, 1);
    assert.equal(B.ow.calls.saves.stats.matches, 1);
    // the latecomer only watched
    assert.ok(watched);
    assert.equal(late.ow.calls.saves.stats, undefined);
    assert.ok(B.room.sent.messages > 5);
    // back in the lobby arena
    env.frames(9000);
    assert.equal(B.ow.calls.controls.at(-1).buttons[0].label, 'Bump');
    assert.deepEqual(env.errors, []);
    console.log(`two pages: ${(env.ts / 60000).toFixed(1)} min of play, guest messages ${B.room.sent.messages}, badges A ${JSON.stringify([...new Set(A.ow.calls.badges)])} B ${JSON.stringify([...new Set(B.ow.calls.badges)])}`);
  } finally {
    env.done();
  }
});

test('the host leaves in the middle of a game: the other page takes over and finishes the match', async () => {
  const env = setup();
  try {
    const server = new FakeServer({ latency: 40, seed: 4242 });
    const A = await addPage(env, server, 'a', 'Ann', 'na');
    const B = await addPage(env, server, 'b', 'Bo', 'nb');
    env.frames(500);
    A.page.pointer(422, 390 * 0.78);
    B.page.pointer(422, 390 * 0.78);
    env.frames(800);
    A.page.pointer(422 - 64, 84); // one game
    env.frames(300);
    assert.equal(B.room.settings.rounds, 1);
    A.room.setReady(true);
    B.room.setReady(true);
    env.frames(3400);
    assert.equal(B.room.match.phase, 'playing');
    const pa = pilot(A.page, A.room, 1);
    const pb = pilot(B.page, B.room, 2);
    let left = false;
    let guard = 0;
    let takeoverN = 0;
    while (B.room.match.phase !== 'lobby' && guard++ < 60 * 60 * 15) {
      env.frame();
      pa.step(env.ts);
      pb.step(env.ts);
      const g = B.room.state.g;
      if (!left && g && g.n >= 3 && g.ph === 'music') {
        takeoverN = g.n;
        pa.release();
        A.room.leave();
        left = true;
      }
    }
    pb.release();
    assert.ok(left);
    assert.equal(B.room.match.phase, 'lobby', 'the match ended (the new host called endMatch)');
    const g = B.room.state.g;
    assert.equal(g.ph, 'final');
    assert.equal(g.by, 'b', 'the new host wrote the record');
    assert.equal(g.game, 1);
    assert.ok(g.n >= takeoverN && g.n <= 7);
    assert.ok(g.elim.includes('a'), 'the one who left is out at the next stop');
    assert.equal(g.rank.length, 8);
    assert.equal(B.ow.calls.saves.stats.matches, 1);
    assert.deepEqual(env.errors, []);
  } finally {
    env.done();
  }
});
