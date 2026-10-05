// main.js, run in node against a fake browser and a one-player room: the title, the lobby, a whole match against bots
// (played by a little script that reads the room's record), the podium and the way back to the lobby.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, newPage, runFrame, makeOw } from './fake-dom.mjs';
import { SoloRoom } from '../game/net.js';

test('a solo page plays a whole match: title, lobby, countdown, rounds, podium, back to the lobby', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    installGlobals();
    const room = new SoloRoom();
    const ow = makeOw(room);
    const page = newPage(ow);
    await import('../game/main.js?solo');
    let ts = 0;
    const frame = () => {
      ts += 17;
      mock.timers.tick(17);
      runFrame(ts);
      assert.equal(page.canvas.ctx.depth, 0, 'every save has its restore');
    };
    const frames = (ms, each) => {
      for (let i = 0; i < Math.round(ms / 17); i++) {
        frame();
        if (each) each(i);
      }
    };
    assert.deepEqual(ow.calls.orientation, ['landscape']);

    // the title: arena behind it, no touch controls
    frames(1200);
    assert.equal(ow.calls.controls.at(-1), null);
    // a tap on PLAY
    page.pointer(422, 390 * 0.78);
    frames(400);
    const lobbyControls = ow.calls.controls.at(-1);
    assert.ok(lobbyControls && lobbyControls.stick === 'analog' && lobbyControls.buttons[0].label === 'Bump' && lobbyControls.buttons[0].key === ' ', 'touch controls in the lobby');
    assert.ok(room.me.presence && Number.isFinite(room.me.presence.x), 'my character is published');

    // walk around the lobby and try a bump and a settings chip (the host may change the games)
    page.pressKey('KeyD');
    frames(600);
    page.releaseKey('KeyD');
    page.pressKey('Space');
    frames(100);
    page.releaseKey('Space');
    page.pointer(422 + 64, 84); // the "3" chip
    frames(100);
    assert.equal(room.settings.rounds, 3);
    page.pointer(422, 84); // the "2" chip
    assert.equal(room.settings.rounds, 2);
    // practice: the lobby loop runs music, a stop and chairs
    frames(16000);

    // START (the stand-in for the platform's strip)
    page.pointer(422, 390 - 56);
    assert.equal(room.match.phase, 'starting');
    frames(1500);
    assert.equal(ow.calls.controls.at(-1).buttons[0].label, 'Bump');
    frames(1700);
    assert.equal(room.match.phase, 'playing');
    frames(200);
    assert.ok(room.state.g && room.state.g.mid === room.match.id, 'the host wrote the match record');
    assert.equal(room.state.g.roster.length, 8, 'seven bots and me');
    assert.equal(room.state.g.roster.filter((e) => e.b).length, 7);

    // play: dance, then run for the nearest chair when they drop; cheer once out
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
    let rounds = 0;
    let lastN = 0;
    let spaces = 0;
    const startedAt = ts;
    let safety = 0;
    while (room.match.phase !== 'lobby' && safety++ < 60 * 60 * 15) {
      frame();
      const g = room.state.g;
      const p = room.me.presence;
      if (!g || !p) continue;
      if (g.n !== lastN) {
        lastN = g.n;
        rounds++;
      }
      let mx = 0;
      let my = 0;
      if (g.ph === 'race' && g.alive.includes(room.me.id) && !g.seats.includes(room.me.id)) {
        let best = null;
        let bd = 1e9;
        g.chairs.forEach((c, i) => {
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
      } else if (g.ph === 'music') {
        mx = Math.sin(ts / 700);
        my = Math.cos(ts / 900);
      }
      hold('KeyA', mx < -0.3);
      hold('KeyD', mx > 0.3);
      hold('KeyW', my < -0.3);
      hold('KeyS', my > 0.3);
      if (safety % 40 === 0) {
        spaces++;
        page.pressKey('Space');
        page.releaseKey('Space');
      }
    }
    assert.equal(room.match.phase, 'lobby', 'the host ended the match');
    for (const code of [...held]) hold(code, false);
    const minutes = (ts - startedAt) / 60000;
    assert.ok(minutes < 12, `a match took ${minutes.toFixed(1)} minutes`);
    assert.equal(room.state.g.ph, 'final');
    assert.equal(room.state.g.n, 14, 'two games of seven rounds');
    assert.equal(room.state.g.game, 2);
    assert.equal(room.state.g.rank.length, 8);
    assert.equal(rounds, 14);
    assert.ok(spaces > 3);
    // the results card stays up in the lobby for a few seconds, then the lobby arena is back
    frames(3000);
    assert.equal(ow.calls.controls.at(-1), null, 'no touch controls over the results card');
    frames(6000);
    assert.equal(ow.calls.controls.at(-1).buttons[0].label, 'Bump');
    // saves, badges and the board
    assert.equal(ow.calls.saves.stats.matches, 1);
    assert.ok(ow.calls.badges.length >= 0);
    assert.deepEqual(errors, [], 'no errors in the console');
    console.log(`solo match: ${minutes.toFixed(1)} min, badges ${JSON.stringify(ow.calls.badges)}, stats ${JSON.stringify(ow.calls.saves.stats)}`);
  } finally {
    console.error = origError;
    mock.timers.reset();
  }
});
